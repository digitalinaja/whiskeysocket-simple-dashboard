const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const startWA = require("./baileys");
const initSocket = require("./socket");

const app = express();
const server = http.createServer(app);
const io = initSocket(server);

const AUTH_ROOT = path.join(__dirname, "..", "auth");
const DEFAULT_SESSION_ID = "default";
const sessions = new Map();
const broadcastJobs = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function normalizeNumber(input) {
  const digits = String(input || "").replace(/\D/g, "");
  // Basic sanity: WhatsApp expects country code + subscriber number (8-15 digits is a common safe window)
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

async function ensureWhatsAppNumber(sock, number) {
  try {
    const jid = `${number}@s.whatsapp.net`;
    const result = await sock.onWhatsApp(jid);
    return Array.isArray(result) && result[0]?.exists;
  } catch (err) {
    console.error("WA lookup failed", err);
    return false;
  }
}

function getAuthPath(sessionId) {
  return path.join(AUTH_ROOT, sessionId);
}

function broadcastStatus(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const payload = { sessionId, ...session.status, user: session.user };
  io.emit("status", payload);
}

async function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  const authPath = getAuthPath(sessionId);
  fs.mkdirSync(authPath, { recursive: true });

  const session = {
    id: sessionId,
    authPath,
    sock: null,
    status: { state: "starting", hasQR: false },
    user: null,
    lastQR: null,
  };
  sessions.set(sessionId, session);

  session.sock = await startWA({
    io,
    sessionId,
    authPath,
    onSockUpdate: (newSock) => {
      session.sock = newSock;
      session.user = newSock?.user || session.user;
    },
    onStatusChange: (status) => {
      session.status = { ...session.status, ...status };
      if (status.state === "open" && session.sock) {
        session.user = session.sock.user || session.user;
        session.lastQR = null;
      }
      broadcastStatus(sessionId);
    },
    onQR: (qr) => {
      session.lastQR = qr;
      session.status = { ...session.status, hasQR: true };
      broadcastStatus(sessionId);
    },
  });

  broadcastStatus(sessionId);
  return session;
}

function getSessionOrError(sessionId, res) {
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return session;
}

async function loadExistingSessions() {
  if (!fs.existsSync(AUTH_ROOT)) {
    fs.mkdirSync(AUTH_ROOT, { recursive: true });
  }
  const entries = fs.readdirSync(AUTH_ROOT, { withFileTypes: true });
  const sessionIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  // Ensure default always exists
  if (!sessionIds.includes(DEFAULT_SESSION_ID)) {
    sessionIds.push(DEFAULT_SESSION_ID);
  }
  for (const id of sessionIds) {
    try {
      await createSession(id);
    } catch (err) {
      console.error(`Failed to load session ${id}`, err);
    }
  }
}

function emitBroadcastUpdate(sessionId, job) {
  io.emit("broadcastUpdate", { sessionId, job });
}

function createBroadcastJob(
  sessionId,
  numbers,
  message,
  {
    delayMinMs = 1000,
    delayMaxMs = 5000,
    cooldownAfter = 20,
    cooldownMinMs = 60000,
    cooldownMaxMs = 180000,
  } = {}
) {
  const id = randomUUID();
  const job = {
    id,
    sessionId,
    status: "queued", // queued | running | completed | failed | cancelled
    requestedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    totals: { sent: 0, skipped: 0, failed: 0, total: numbers.length },
    processed: 0,
    phase: "queued", // queued | running | cooldown
    nextResumeAt: null,
    results: [],
    config: {
      delayMinMs,
      delayMaxMs,
      cooldownAfter,
      cooldownMinMs,
      cooldownMaxMs,
    },
    message,
  };
  broadcastJobs.set(id, job);
  const session = sessions.get(sessionId);

  const run = async () => {
    job.status = "running";
    job.phase = "running";
    job.startedAt = Date.now();
    emitBroadcastUpdate(sessionId, job);

    for (const number of numbers) {
      const normalized = normalizeNumber(number);
      if (!normalized) {
        job.results.push({ number, status: "skipped", reason: "invalid number" });
        job.totals.skipped += 1;
        emitBroadcastUpdate(sessionId, job);
        continue;
      }

      const exists = await ensureWhatsAppNumber(session.sock, normalized);
      if (!exists) {
        job.results.push({ number: normalized, status: "skipped", reason: "not on WhatsApp" });
        job.totals.skipped += 1;
        emitBroadcastUpdate(sessionId, job);
        continue;
      }

      try {
        const delay = randomBetween(job.config.delayMinMs, job.config.delayMaxMs);
        await sleep(delay);
        await session.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: message });
        job.results.push({ number: normalized, status: "sent" });
        job.totals.sent += 1;
      } catch (err) {
        console.error("Broadcast send failed", err);
        job.results.push({
          number: normalized,
          status: "failed",
          error: err?.message || "Failed to send",
        });
        job.totals.failed += 1;
      }

      job.processed += 1;
      emitBroadcastUpdate(sessionId, job);

      const shouldCooldown =
        job.config.cooldownAfter > 0 &&
        job.processed > 0 &&
        job.processed % job.config.cooldownAfter === 0;

      if (shouldCooldown) {
        const wait = randomBetween(job.config.cooldownMinMs, job.config.cooldownMaxMs);
        job.phase = "cooldown";
        job.nextResumeAt = Date.now() + wait;
        emitBroadcastUpdate(sessionId, job);
        await sleep(wait);
        job.phase = "running";
        job.nextResumeAt = null;
        emitBroadcastUpdate(sessionId, job);
      }
    }

    job.status = "completed";
    job.completedAt = Date.now();
    job.phase = "completed";
    emitBroadcastUpdate(sessionId, job);
  };

  // kick off async, but don't await inside request
  setImmediate(() => {
    run().catch((err) => {
      console.error("Broadcast job crashed", err);
      job.status = "failed";
      job.completedAt = Date.now();
      emitBroadcastUpdate(sessionId, job);
    });
  });

  return job;
}

app.get("/sessions", (req, res) => {
  const list = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    state: s.status.state,
    hasQR: s.status.hasQR,
    user: s.user,
  }));
  res.json({ sessions: list });
});

app.post("/sessions", async (req, res) => {
  const { id } = req.body;
  const sessionId = String(id || "").trim();
  if (!sessionId) return res.status(400).json({ error: "Session id required" });
  if (sessions.has(sessionId)) return res.status(400).json({ error: "Session already exists" });

  try {
    await createSession(sessionId);
    res.json({ status: "created", sessionId });
  } catch (err) {
    console.error("Create session failed", err);
    res.status(500).json({ error: err?.message || "Failed to create session" });
  }
});

app.get("/sessions/:id/status", (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ sessionId: id, ...session.status, user: session.user });
});

app.post("/sessions/:id/send", async (req, res) => {
  const { id } = req.params;
  const session = getSessionOrError(id, res);
  if (!session) return;
  const { number, message } = req.body;

  if (!session.sock) return res.status(500).json({ error: "WA not connected" });
  if (session.status.state !== "open") return res.status(503).json({ error: "WA not ready" });
  const normalized = normalizeNumber(number);
  if (!normalized) return res.status(400).json({ error: "Invalid number format" });
  const exists = await ensureWhatsAppNumber(session.sock, normalized);
  if (!exists) return res.status(400).json({ error: "Number is not on WhatsApp" });

  try {
    await session.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: message });
    res.json({ status: "sent" });
  } catch (err) {
    console.error("Send failed", err);
    res.status(500).json({ error: err?.message || "Failed to send" });
  }
});

app.post("/sessions/:id/broadcast", async (req, res) => {
  const { id } = req.params;
  const session = getSessionOrError(id, res);
  if (!session) return;
  const {
    numbers = [],
    message,
    delayMinMs = 800,
    delayMaxMs = 1500,
    cooldownAfter = 20,
    cooldownMinMs = 60000,
    cooldownMaxMs = 180000,
  } = req.body;
  if (!session.sock) return res.status(500).json({ error: "WA not connected" });
  if (session.status.state !== "open") return res.status(503).json({ error: "WA not ready" });

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: "numbers array required" });
  }
  const minDelay = Number.isFinite(delayMinMs) && delayMinMs >= 0 ? delayMinMs : 800;
  const maxDelay = Number.isFinite(delayMaxMs) && delayMaxMs >= minDelay ? delayMaxMs : minDelay + 700;
  const safeCooldownAfter =
    Number.isFinite(cooldownAfter) && cooldownAfter > 0 ? Math.floor(cooldownAfter) : 20;
  const safeCooldownMin = Number.isFinite(cooldownMinMs) && cooldownMinMs > 0 ? cooldownMinMs : 60000;
  const safeCooldownMax =
    Number.isFinite(cooldownMaxMs) && cooldownMaxMs >= safeCooldownMin ? cooldownMaxMs : safeCooldownMin + 120000;

  const job = createBroadcastJob(id, numbers, message, {
    delayMinMs: minDelay,
    delayMaxMs: Math.min(maxDelay, 20000),
    cooldownAfter: safeCooldownAfter,
    cooldownMinMs: safeCooldownMin,
    cooldownMaxMs: Math.min(safeCooldownMax, 300000),
  });
  res.json({
    status: "queued",
    jobId: job.id,
    totals: job.totals,
    delayMinMs: job.config.delayMinMs,
    delayMaxMs: job.config.delayMaxMs,
    cooldownAfter: job.config.cooldownAfter,
    cooldownMinMs: job.config.cooldownMinMs,
    cooldownMaxMs: job.config.cooldownMaxMs,
  });
});

app.get("/sessions/:id/broadcast/:jobId", (req, res) => {
  const { id, jobId } = req.params;
  const job = broadcastJobs.get(jobId);
  if (!job || job.sessionId !== id) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json({ job });
});

app.get("/sessions/:id/broadcast", (req, res) => {
  const { id } = req.params;
  const jobs = Array.from(broadcastJobs.values())
    .filter((j) => j.sessionId === id)
    .sort((a, b) => (b.startedAt || b.requestedAt) - (a.startedAt || a.requestedAt));
  res.json({ jobs });
});

function resetAuthDir(sessionId) {
  const authPath = getAuthPath(sessionId);
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Failed clearing auth dir", err);
  }
}

function clearSessionJobs(sessionId) {
  for (const [id, job] of broadcastJobs.entries()) {
    if (job.sessionId === sessionId) {
      broadcastJobs.delete(id);
    }
  }
}

app.post("/sessions/:id/logout", async (req, res) => {
  const { id } = req.params;
  const session = getSessionOrError(id, res);
  if (!session) return;
  try {
    if (session.sock) {
      await session.sock.logout();
    }
    resetAuthDir(id);
    // restart session to force new QR
    sessions.delete(id);
    await createSession(id);
    res.json({ status: "logged out" });
  } catch (err) {
    console.error("Logout failed", err);
    res.status(500).json({ error: err?.message || "Logout failed" });
  }
});

app.delete("/sessions/:id", async (req, res) => {
  const { id } = req.params;
  const session = getSessionOrError(id, res);
  if (!session) return;
  try {
    if (session.sock) {
      try {
        await session.sock.logout();
      } catch (err) {
        console.error("Logout during delete failed", err);
      }
    }
    sessions.delete(id);
    clearSessionJobs(id);
    resetAuthDir(id);
    io.emit("sessionRemoved", { sessionId: id });
    res.json({ status: "deleted" });
  } catch (err) {
    console.error("Delete session failed", err);
    res.status(500).json({ error: err?.message || "Delete failed" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await loadExistingSessions();
});

io.on("connection", (socket) => {
  for (const session of sessions.values()) {
    socket.emit("status", { sessionId: session.id, ...session.status, user: session.user });
    if (session.lastQR) {
      socket.emit("qr", { sessionId: session.id, qr: session.lastQR });
    }
  }
});
