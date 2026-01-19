import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import session from 'express-session';
import { fileURLToPath } from "url";
import startWA from "./baileys.js";
import initSocket from "./socket.js";
import { initDatabase, testConnection, createDefaultLeadStatuses } from "./database.js";
import * as chatHandlers from "./chatHandlers.js";
import * as googleContacts from "./googleContacts.js";
import crmRoutes from "./crmRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = initSocket(server);

const AUTH_ROOT = path.join(__dirname, "..", "auth");
const JOBS_ROOT = path.join(__dirname, "..", "jobs");
const DEFAULT_SESSION_ID = "default";
const sessions = new Map();
const broadcastJobs = new Map();

// Store sessions in app for access by routes
app.set('sessions', sessions);

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
// Serve media folder for downloaded media files
app.use('/media', express.static(path.join(__dirname, "..", "media")));

// Session middleware for Google OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'whiskeysocket_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Mount CRM API routes
app.use('/api', crmRoutes);

// Google OAuth routes
app.get('/auth/google', (req, res) => {
  const authUrl = googleContacts.getAuthUrl();
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Authorization failed: No code received');
  }

  try {
    const sessionId = state || 'default';
    await googleContacts.handleOAuthCallback(code, sessionId);
    res.redirect('/#contacts');
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

// Google sync API routes
app.get('/api/google/sync-status', async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connected = await googleContacts.isConnected(sessionId);
    res.json({ connected });
  } catch (error) {
    console.error('Error checking Google sync status:', error);
    res.status(500).json({ error: 'Failed to check sync status' });
  }
});

app.post('/api/google/sync-contacts', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await googleContacts.syncContactsFromGoogle(sessionId);

    // Emit Socket.io event for real-time update
    io.emit('google.contactsSynced', { sessionId, count: result.synced + result.merged });

    res.json({ success: true, synced: result.synced, merged: result.merged, total: result.total });
  } catch (error) {
    console.error('Error syncing Google contacts:', error);
    res.status(500).json({ error: 'Failed to sync contacts', details: error.message });
  }
});

app.post('/api/google/disconnect', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    await googleContacts.disconnectGoogle(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Google:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// WhatsApp contacts sync route
app.post('/api/whatsapp/sync-contacts', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = sessions.get(sessionId);
    if (!session || !session.sock) {
      return res.status(404).json({ error: 'Session not found or not connected' });
    }

    const result = await chatHandlers.syncContactsFromWhatsApp(sessionId, session.sock);

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error syncing WhatsApp contacts:', error);
    res.status(500).json({ error: 'Failed to sync contacts' });
  }
});

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
    onStatusChange: async (status) => {
      session.status = { ...session.status, ...status };
      if (status.state === "open" && session.sock) {
        session.user = session.sock.user || session.user;
        session.lastQR = null;

        // Create default lead statuses for new sessions
        try {
          await createDefaultLeadStatuses(sessionId);
        } catch (err) {
          console.error(`Failed to create default lead statuses for ${sessionId}:`, err);
        }
      }
      broadcastStatus(sessionId);
    },
    onQR: (qr) => {
      session.lastQR = qr;
      session.status = { ...session.status, hasQR: true };
      broadcastStatus(sessionId);
    },
    onMessage: async (sessionId, message, messageType = 'notify', sock) => {
      // Handle incoming messages from WhatsApp (both real-time and history sync)
      try {
        await chatHandlers.handleIncomingMessage(sessionId, message, sock, io, messageType);
      } catch (error) {
        console.error('Error handling incoming message:', error);
      }
    },
    onHistorySync: async (sessionId, data, sock) => {
      // Handle history sync from WhatsApp (messages from other devices)
      try {
        const result = await chatHandlers.handleHistorySync(sessionId, data, sock, io);
        console.log(`✓ History sync completed for session ${sessionId}:`, result);
      } catch (error) {
        console.error('Error handling history sync:', error);
      }
    }
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

  // Only load sessions that already exist (no auto-creation)
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

    // Convert Sets to Arrays for JSON serialization
    const jobForSave = {
      ...job,
      processedNumbers: Array.from(job.processedNumbers || []),
      skippedNumbers: Array.from(job.skippedNumbers || []),
    };

    const jobJson = JSON.stringify(jobForSave, null, 2);
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
    lastProcessedIndex: -1,
    processedNumbers: new Set(),
    skippedNumbers: new Set(),
    phase: "running",
    results: [],
    lastSaveTime: 0,
    config: {
      personalized: true,
      messageTemplate,
      saveInterval: 5,
    },
    message: messageTemplate,
    csvData: csvData,
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
    const jobsNeedingResume = [];

    jobFiles.forEach(file => {
      try {
        const filepath = path.join(JOBS_ROOT, file);
        const jobData = JSON.parse(fs.readFileSync(filepath, 'utf8'));

        // Restore Sets from Arrays
        jobData.processedNumbers = new Set(jobData.processedNumbers || []);
        jobData.skippedNumbers = new Set(jobData.skippedNumbers || []);

        broadcastJobs.set(jobData.id, jobData);
        console.log(`Loaded job ${jobData.id} (status: ${jobData.status})`);

        // Check if job needs resume
        if (jobData.status === 'running' || jobData.status === 'resuming') {
          jobsNeedingResume.push(jobData);
        }
      } catch (err) {
        console.error(`Failed to load job from ${file}:`, err);
      }
    });

    console.log(`Loaded ${jobFiles.length} jobs from disk`);

    // Resume jobs that were interrupted
    if (jobsNeedingResume.length > 0) {
      console.log(`Found ${jobsNeedingResume.length} jobs needing resume...`);

      // Wait for sessions to connect, then resume
      setTimeout(() => {
        jobsNeedingResume.forEach(job => {
          console.log(`[RESUME ATTEMPT] Attempting to resume job ${job.id} (session: ${job.sessionId})`);
          resumeJob(job);
        });
      }, 5000); // Wait 5 seconds for sessions to connect
    }
  } catch (err) {
    console.error("Failed to load existing jobs", err);
  }
}

// Resume a job that was interrupted
function resumeJob(job) {
  const session = sessions.get(job.sessionId);
  if (!session || !session.sock || session.status.state !== 'open') {
    console.log(`[RESUME SKIP] Job ${job.id} cannot resume - session not ready`);
    job.status = "failed";
    job.completedAt = Date.now();
    job.phase = "failed";
    job.totals.failed += 1;
    saveJobToFile(job);
    return;
  }

  // Check if job was in cooldown
  const wasInCooldown = job.phase === "cooldown" && job.nextResumeAt;

  job.status = "resuming";
  console.log(`[RESUME START] Job ${job.id} resuming from index ${job.lastProcessedIndex + 1} ${wasInCooldown ? '(was in cooldown)' : ''}`);
  emitBroadcastUpdate(job.sessionId, job);

  // Re-create the job run logic with the saved state
  const run = async () => {
    job.status = "running";
    job.phase = "running";
    emitBroadcastUpdate(job.sessionId, job);

    const startIndex = job.lastProcessedIndex + 1;
    console.log(`[RESUME] Job ${job.id} continuing from index ${startIndex} of ${job.numbers.length}`);

    // If was in cooldown and nextResumeAt is in future, wait
    if (wasInCooldown && job.nextResumeAt) {
      const now = Date.now();
      if (job.nextResumeAt > now) {
        const waitTime = job.nextResumeAt - now;
        console.log(`[RESUME COOLDOWN] Job ${job.id} was in cooldown, waiting ${waitTime}ms before continuing`);
        job.phase = "cooldown";
        emitBroadcastUpdate(job.sessionId, job);
        await sleep(waitTime);
        job.phase = "running";
        job.nextResumeAt = null;
        emitBroadcastUpdate(job.sessionId, job);
      } else {
        // Cooldown already passed, clear it
        console.log(`[RESUME COOLDOWN] Job ${job.id} cooldown already passed, continuing`);
        job.nextResumeAt = null;
      }
    }

    for (let i = startIndex; i < job.numbers.length; i++) {
      const number = job.numbers[i];
      const normalized = normalizeNumber(number);

      // Skip if already processed
      if (job.processedNumbers.has(normalized) || job.skippedNumbers.has(normalized)) {
        console.log(`[RESUME SKIP] Already processed: ${normalized}, skipping`);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        continue;
      }

      if (!normalized) {
        job.results.push({ number, status: "skipped", reason: "invalid number" });
        job.totals.skipped += 1;
        job.skippedNumbers.add(number);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        emitBroadcastUpdate(job.sessionId, job);
        continue;
      }

      const exists = await ensureWhatsAppNumber(session.sock, normalized);
      if (!exists) {
        job.results.push({ number: normalized, status: "skipped", reason: "not on WhatsApp" });
        job.totals.skipped += 1;
        job.skippedNumbers.add(normalized);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        emitBroadcastUpdate(job.sessionId, job);
        continue;
      }

      try {
        const delay = randomBetween(job.config.delayMinMs, job.config.delayMaxMs);
        await sleep(delay);
        await session.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: job.message });
        job.results.push({ number: normalized, status: "sent" });
        job.totals.sent += 1;
        job.processedNumbers.add(normalized);
      } catch (err) {
        console.error("[RESUME] Send failed", err);
        job.results.push({
          number: normalized,
          status: "failed",
          error: err?.message || "Failed to send",
        });
        job.totals.failed += 1;
      }

      job.processed = i + 1;
      job.lastProcessedIndex = i;
      emitBroadcastUpdate(job.sessionId, job);

      // Periodic save
      if (job.totals.sent % job.config.saveInterval === 0) {
        job.lastSaveTime = Date.now();
        saveJobToFile(job);
        console.log(`[RESUME SAVE] Job ${job.id} saved at index ${i} (${job.totals.sent} sent)`);
      }

      // Cooldown
      const shouldCooldown =
        job.config.cooldownAfter > 0 &&
        job.processed > 0 &&
        job.processed % job.config.cooldownAfter === 0;

      if (shouldCooldown) {
        const wait = randomBetween(job.config.cooldownMinMs, job.config.cooldownMaxMs);
        job.phase = "cooldown";
        job.nextResumeAt = Date.now() + wait;
        saveJobToFile(job);
        console.log(`[RESUME COOLDOWN] Job ${job.id} entering cooldown for ${wait}ms`);
        emitBroadcastUpdate(job.sessionId, job);
        await sleep(wait);
        job.phase = "running";
        job.nextResumeAt = null;
        emitBroadcastUpdate(job.sessionId, job);
      }
    }

    job.status = "completed";
    job.completedAt = Date.now();
    job.phase = "completed";
    console.log(`[RESUME COMPLETE] Job ${job.id} completed. Sent: ${job.totals.sent}, Failed: ${job.totals.failed}, Skipped: ${job.totals.skipped}`);
    emitBroadcastUpdate(job.sessionId, job);
    saveJobToFile(job);
  };

  setImmediate(() => {
    run().catch((err) => {
      console.error("[RESUME] Job crashed", err);
      job.status = "failed";
      job.completedAt = Date.now();
      job.phase = "failed"; // Make sure phase is updated
      emitBroadcastUpdate(job.sessionId, job);
      saveJobToFile(job);
    });
  });
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
    status: "queued", // queued | running | completed | failed | cancelled | resuming
    requestedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    totals: { sent: 0, skipped: 0, failed: 0, total: numbers.length },
    processed: 0,
    lastProcessedIndex: -1, // Track last processed index for resume
    processedNumbers: new Set(), // Track successfully sent numbers
    skippedNumbers: new Set(), // Track skipped numbers
    phase: "queued", // queued | running | cooldown
    nextResumeAt: null,
    lastSaveTime: 0, // Track last save for throttling
    results: [],
    numbers: numbers, // Store original numbers array for resume
    config: {
      delayMinMs,
      delayMaxMs,
      cooldownAfter,
      cooldownMinMs,
      cooldownMaxMs,
      saveInterval: 5, // Save every 5 messages
    },
    message,
  };
  broadcastJobs.set(id, job);
  const session = sessions.get(sessionId);

  const run = async (startIndex = 0) => {
    job.status = job.status === "resuming" ? "resuming" : "running";
    job.phase = "running";
    if (!job.startedAt) job.startedAt = Date.now();

    console.log(`[JOB START] Job ${job.id} starting from index ${startIndex}`);
    emitBroadcastUpdate(sessionId, job);

    for (let i = startIndex; i < numbers.length; i++) {
      const number = numbers[i];
      const normalized = normalizeNumber(number);

      // Skip if already processed (resume scenario)
      if (job.processedNumbers.has(normalized) || job.skippedNumbers.has(normalized)) {
        console.log(`[JOB SKIP] Already processed: ${normalized}, skipping`);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        continue;
      }

      if (!normalized) {
        job.results.push({ number, status: "skipped", reason: "invalid number" });
        job.totals.skipped += 1;
        job.skippedNumbers.add(number);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        emitBroadcastUpdate(sessionId, job);
        continue;
      }

      const exists = await ensureWhatsAppNumber(session.sock, normalized);
      if (!exists) {
        job.results.push({ number: normalized, status: "skipped", reason: "not on WhatsApp" });
        job.totals.skipped += 1;
        job.skippedNumbers.add(normalized);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        emitBroadcastUpdate(sessionId, job);
        continue;
      }

      try {
        const delay = randomBetween(job.config.delayMinMs, job.config.delayMaxMs);
        await sleep(delay);
        await session.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: message });
        job.results.push({ number: normalized, status: "sent" });
        job.totals.sent += 1;
        job.processedNumbers.add(normalized);
      } catch (err) {
        console.error("Broadcast send failed", err);
        job.results.push({
          number: normalized,
          status: "failed",
          error: err?.message || "Failed to send",
        });
        job.totals.failed += 1;
      }

      job.processed = i + 1;
      job.lastProcessedIndex = i;
      emitBroadcastUpdate(sessionId, job);

      // Periodic save every N messages
      if (job.totals.sent % job.config.saveInterval === 0) {
        job.lastSaveTime = Date.now();
        saveJobToFile(job);
        console.log(`[PERIODIC SAVE] Job ${job.id} saved at index ${i} (${job.totals.sent} sent)`);
      }

      const shouldCooldown =
        job.config.cooldownAfter > 0 &&
        job.processed > 0 &&
        job.processed % job.config.cooldownAfter === 0;

      if (shouldCooldown) {
        const wait = randomBetween(job.config.cooldownMinMs, job.config.cooldownMaxMs);
        job.phase = "cooldown";
        job.nextResumeAt = Date.now() + wait;
        saveJobToFile(job); // Save before cooldown
        console.log(`[COOLDOWN] Job ${job.id} entering cooldown for ${wait}ms`);
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
    console.log(`[JOB COMPLETE] Job ${job.id} completed. Sent: ${job.totals.sent}, Failed: ${job.totals.failed}, Skipped: ${job.totals.skipped}`);
    emitBroadcastUpdate(sessionId, job);
    saveJobToFile(job); // Final save when completed
  };

  // kick off async, but don't await inside request
  setImmediate(() => {
    run().catch((err) => {
      console.error("Broadcast job crashed", err);
      job.status = "failed";
      job.completedAt = Date.now();
      emitBroadcastUpdate(sessionId, job);
      saveJobToFile(job); // Save on failure
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

  // Create tracking job with proper resume support
  const jobId = randomUUID();
  const job = {
    id: jobId,
    sessionId: id,
    status: "running",
    requestedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    totals: { sent: 0, skipped: 0, failed: 0, total: csvData.length },
    processed: 0,
    lastProcessedIndex: -1,
    processedNumbers: new Set(),
    skippedNumbers: new Set(),
    phase: "running",
    results: [],
    lastSaveTime: 0,
    config: {
      personalized: true,
      messageTemplate,
      delayMinMs,
      delayMaxMs,
      cooldownAfter,
      cooldownMinMs,
      cooldownMaxMs,
      saveInterval: 5,
    },
    message: messageTemplate,
    csvData: csvData, // Store for resume
  };

  broadcastJobs.set(jobId, job);
  emitBroadcastUpdate(id, job);

  // Send messages asynchronously with proper tracking
  const runPersonalized = async () => {
    console.log(`[PERSONALIZED JOB START] Job ${jobId} starting`);

    for (let i = 0; i < csvData.length; i++) {
      const contact = csvData[i];
      const personalizedMessage = messageTemplate.replace(/\{name\}/gi, contact.name || '');
      const normalized = normalizeNumber(contact.phone);

      // Skip if already processed (resume scenario)
      if (job.processedNumbers.has(normalized) || job.skippedNumbers.has(normalized)) {
        console.log(`[PERSONALIZED SKIP] Already processed: ${normalized}, skipping`);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        continue;
      }

      if (!normalized) {
        job.results.push({ number: contact.phone, status: "skipped", reason: "invalid number", name: contact.name });
        job.totals.skipped += 1;
        job.skippedNumbers.add(contact.phone);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        emitBroadcastUpdate(id, job);
        continue;
      }

      const exists = await ensureWhatsAppNumber(session.sock, normalized);
      if (!exists) {
        job.results.push({ number: normalized, status: "skipped", reason: "not on WhatsApp", name: contact.name });
        job.totals.skipped += 1;
        job.skippedNumbers.add(normalized);
        job.processed = i + 1;
        job.lastProcessedIndex = i;
        emitBroadcastUpdate(id, job);
        continue;
      }

      try {
        const delay = randomBetween(delayMinMs, delayMaxMs);
        await sleep(delay);
        await session.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: personalizedMessage });
        job.results.push({ number: normalized, status: "sent", name: contact.name });
        job.totals.sent += 1;
        job.processedNumbers.add(normalized);
      } catch (err) {
        console.error("Personalized send failed", err);
        job.results.push({
          number: normalized,
          status: "failed",
          error: err?.message || "Failed to send",
          name: contact.name
        });
        job.totals.failed += 1;
      }

      job.processed = i + 1;
      job.lastProcessedIndex = i;
      emitBroadcastUpdate(id, job);

      // Periodic save
      if (job.totals.sent % job.config.saveInterval === 0) {
        job.lastSaveTime = Date.now();
        saveJobToFile(job);
        console.log(`[PERSONALIZED SAVE] Job ${jobId} saved at index ${i} (${job.totals.sent} sent)`);
      }

      // Cooldown
      if (job.processed > 0 && job.processed % cooldownAfter === 0) {
        const wait = randomBetween(cooldownMinMs, cooldownMaxMs);
        job.phase = "cooldown";
        job.nextResumeAt = Date.now() + wait;
        saveJobToFile(job);
        console.log(`[PERSONALIZED COOLDOWN] Job ${jobId} entering cooldown for ${wait}ms`);
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
    console.log(`[PERSONALIZED COMPLETE] Job ${jobId}. Sent: ${job.totals.sent}, Failed: ${job.totals.failed}, Skipped: ${job.totals.skipped}`);
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
    jobId: jobId,
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

  // Initialize database
  try {
    console.log('Initializing database...');
    await initDatabase();
    await testConnection();
    console.log('✓ Database initialized successfully');
  } catch (err) {
    console.error('✗ Database initialization failed:', err);
    console.log('Server will continue but database features will not work');
  }

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
