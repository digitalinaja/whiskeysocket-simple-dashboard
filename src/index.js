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
const JOBS_ROOT = path.join(__dirname, "..", "jobs");
const DEFAULT_SESSION_ID = "default";
const sessions = new Map();
const broadcastJobs = new Map();

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_ROOT)) {
  fs.mkdirSync(JOBS_ROOT, { recursive: true });
}

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

// Save job to JSON file
function saveJobToFile(job) {
  try {
    console.log(`[SAVE JOB] Attempting to save job ${job.id}...`);
    console.log(`[SAVE JOB] JOBS_ROOT: ${JOBS_ROOT}`);
    console.log(`[SAVE JOB] Directory exists: ${fs.existsSync(JOBS_ROOT)}`);

    const filename = `${job.id}.json`;
    const filepath = path.join(JOBS_ROOT, filename);

    // Ensure directory exists
    if (!fs.existsSync(JOBS_ROOT)) {
      console.log(`[SAVE JOB] Creating jobs directory...`);
      fs.mkdirSync(JOBS_ROOT, { recursive: true });
    }

    const jobJson = JSON.stringify(job, null, 2);
    console.log(`[SAVE JOB] Job JSON length: ${jobJson.length} chars`);

    fs.writeFileSync(filepath, jobJson);
    console.log(`[SAVE JOB] ✓ Job saved successfully to: ${filepath}`);
  } catch (err) {
    console.error("[SAVE JOB] ✗ Failed to save job to file:", err);
  }
}

// Create a tracking job for personalized broadcasts
function createPersonalizedJob(sessionId, numbers, messageTemplate, csvData) {
  const id = randomUUID();
  const job = {
    id,
    sessionId,
    status: "running",
    requestedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    totals: { sent: 0, skipped: 0, failed: 0, total: csvData.length },
    processed: 0,
    phase: "running",
    results: [],
    config: {
      personalized: true,
      messageTemplate,
    },
    message: messageTemplate,
    csvData: csvData, // Store original CSV data
  };

  broadcastJobs.set(id, job);
  emitBroadcastUpdate(sessionId, job);

  return job;
}

// Load existing jobs from files
function loadExistingJobs() {
  try {
    const files = fs.readdirSync(JOBS_ROOT);
    const jobFiles = files.filter(f => f.endsWith('.json'));

    jobFiles.forEach(file => {
      try {
        const filepath = path.join(JOBS_ROOT, file);
        const jobData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        broadcastJobs.set(jobData.id, jobData);
        console.log(`Loaded job ${jobData.id}`);
      } catch (err) {
        console.error(`Failed to load job from ${file}:`, err);
      }
    });

    console.log(`Loaded ${jobFiles.length} jobs from disk`);
  } catch (err) {
    console.error("Failed to load existing jobs", err);
  }
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
    console.log(`[JOB COMPLETE] Job ${job.id} completed. Sent: ${job.totals.sent}, Failed: ${job.totals.failed}`);
    emitBroadcastUpdate(sessionId, job);
    saveJobToFile(job); // Auto-save when completed
  };

  // kick off async, but don't await inside request
  setImmediate(() => {
    run().catch((err) => {
      console.error("Broadcast job crashed", err);
      job.status = "failed";
      job.completedAt = Date.now();
      emitBroadcastUpdate(sessionId, job);
      saveJobToFile(job); // Also save on failure
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

// Personalized broadcast endpoint
app.post("/sessions/:id/broadcast-personalized", async (req, res) => {
  const { id } = req.params;
  const session = getSessionOrError(id, res);
  if (!session) return;

  const {
    csvData = [],
    messageTemplate,
    delayMinMs = 3000,
    delayMaxMs = 8000,
    cooldownAfter = 30,
    cooldownMinMs = 120000,
    cooldownMaxMs = 300000,
  } = req.body;

  if (!session.sock) return res.status(500).json({ error: "WA not connected" });
  if (session.status.state !== "open") return res.status(503).json({ error: "WA not ready" });
  if (!Array.isArray(csvData) || csvData.length === 0) {
    return res.status(400).json({ error: "csvData array required" });
  }

  // Create tracking job
  const job = createPersonalizedJob(id, csvData.map(d => d.phone), messageTemplate, csvData);

  // Send messages asynchronously
  const runPersonalized = async () => {
    let sent = 0;
    let failed = 0;

    for (const contact of csvData) {
      const personalizedMessage = messageTemplate.replace(/\{name\}/gi, contact.name || '');
      const normalized = normalizeNumber(contact.phone);

      if (!normalized) {
        job.results.push({ number: contact.phone, status: "skipped", reason: "invalid number" });
        job.totals.skipped += 1;
        job.processed += 1;
        emitBroadcastUpdate(id, job);
        continue;
      }

      const exists = await ensureWhatsAppNumber(session.sock, normalized);
      if (!exists) {
        job.results.push({ number: normalized, status: "skipped", reason: "not on WhatsApp" });
        job.totals.skipped += 1;
        job.processed += 1;
        emitBroadcastUpdate(id, job);
        continue;
      }

      try {
        const delay = randomBetween(delayMinMs, delayMaxMs);
        await sleep(delay);
        await session.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: personalizedMessage });
        job.results.push({ number: normalized, status: "sent", name: contact.name });
        job.totals.sent += 1;
        sent++;
      } catch (err) {
        console.error("Personalized send failed", err);
        job.results.push({
          number: normalized,
          status: "failed",
          error: err?.message || "Failed to send",
          name: contact.name
        });
        job.totals.failed += 1;
        failed++;
      }

      job.processed += 1;
      emitBroadcastUpdate(id, job);

      // Cooldown
      if (job.processed > 0 && job.processed % cooldownAfter === 0) {
        const wait = randomBetween(cooldownMinMs, cooldownMaxMs);
        job.phase = "cooldown";
        job.nextResumeAt = Date.now() + wait;
        emitBroadcastUpdate(id, job);
        await sleep(wait);
        job.phase = "running";
        job.nextResumeAt = null;
        emitBroadcastUpdate(id, job);
      }
    }

    job.status = "completed";
    job.completedAt = Date.now();
    job.phase = "completed";
    console.log(`[PERSONALIZED JOB COMPLETE] Job ${job.id}. Sent: ${sent}, Failed: ${failed}`);
    emitBroadcastUpdate(id, job);
    saveJobToFile(job);
  };

  setImmediate(() => {
    runPersonalized().catch((err) => {
      console.error("Personalized broadcast job crashed", err);
      job.status = "failed";
      job.completedAt = Date.now();
      emitBroadcastUpdate(id, job);
      saveJobToFile(job);
    });
  });

  res.json({
    status: "queued",
    jobId: job.id,
    totals: job.totals,
    message: "Personalized broadcast started",
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

// Get all jobs with optional date filter
app.get("/jobs", (req, res) => {
  const { startDate, endDate, limit = 100 } = req.query;

  let jobs = Array.from(broadcastJobs.values());

  // Filter by date range
  if (startDate) {
    const start = new Date(startDate).getTime();
    jobs = jobs.filter(j => (j.completedAt || j.requestedAt) >= start);
  }
  if (endDate) {
    const end = new Date(endDate).getTime();
    jobs = jobs.filter(j => (j.completedAt || j.requestedAt) <= end);
  }

  // Sort by date (newest first)
  jobs.sort((a, b) => (b.completedAt || b.requestedAt) - (a.completedAt || a.requestedAt));

  // Apply limit
  if (limit) {
    jobs = jobs.slice(0, parseInt(limit));
  }

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
  loadExistingJobs(); // Load saved jobs from disk
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
