const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const startWA = require("./baileys");
const initSocket = require("./socket");

const app = express();
const server = http.createServer(app);
const io = initSocket(server);

const AUTH_ROOT = path.join(__dirname, "..", "auth");
const DEFAULT_SESSION_ID = "default";
const sessions = new Map();

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
  const { numbers = [], message } = req.body;
  if (!session.sock) return res.status(500).json({ error: "WA not connected" });
  if (session.status.state !== "open") return res.status(503).json({ error: "WA not ready" });

  const results = [];

  try {
    for (const number of numbers) {
      const normalized = normalizeNumber(number);
      if (!normalized) {
        results.push({ number, status: "skipped", reason: "invalid number" });
        continue;
      }

      const exists = await ensureWhatsAppNumber(session.sock, normalized);
      if (!exists) {
        results.push({ number: normalized, status: "skipped", reason: "not on WhatsApp" });
        continue;
      }

      try {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay between messages
        await session.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: message });
        results.push({ number: normalized, status: "sent" });
      } catch (err) {
        console.error("Broadcast send failed", err);
        results.push({
          number: normalized,
          status: "failed",
          error: err?.message || "Failed to send",
        });
      }
    }

    res.json({ status: "broadcast complete", results });
  } catch (err) {
    console.error("Broadcast failed", err);
    res.status(500).json({ error: err?.message || "Broadcast failed" });
  }
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

server.listen(3000, async () => {
  console.log("Server running on port 3000");
  await createSession(DEFAULT_SESSION_ID);
});

io.on("connection", (socket) => {
  for (const session of sessions.values()) {
    socket.emit("status", { sessionId: session.id, ...session.status, user: session.user });
    if (session.lastQR) {
      socket.emit("qr", { sessionId: session.id, qr: session.lastQR });
    }
  }
});
