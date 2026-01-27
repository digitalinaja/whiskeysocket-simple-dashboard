import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from "url";
import startWA from "./baileys.js";
import initSocket from "./socket.js";
import { initDatabase, testConnection, createDefaultLeadStatuses } from "./database.js";
import * as chatHandlers from "./chatHandlers.js";
import * as googleContacts from "./googleContacts.js";
import * as outlookContacts from "./outlookContacts.js";
import * as sessionStorage from "./sessionStorage.js";
import crmRoutes from "./crmRoutes.js";
import { authenticateToken, checkAuthStatus } from "./authMiddleware.js";
import jwt from "jsonwebtoken";

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

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || '123';
const JWT_COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'sso_token';

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

// Cookie parser middleware for JWT token
app.use(cookieParser());

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

// Authentication check endpoint (public - for frontend to verify login status)
// Must be defined before /api routes to avoid authentication requirement
app.get('/api/auth/check', checkAuthStatus, (req, res) => {
  res.json({
    authenticated: req.isAuthenticated || false,
    user: req.user || null
  });
});

// App configuration endpoint (public)
app.get('/api/config', (req, res) => {
  res.json({
    appName: process.env.APP_NAME || 'Webaloka CRM',
    appVersion: '1.0.0'
  });
});

// ============================================
// TEST LOGIN ENDPOINT (HANYA UNTUK TESTING!)
// ============================================
// HAPUS endpoint ini di production!

// Serve login page
app.get('/test-login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'test-login.html'));
});

// API endpoint untuk test login
app.post('/api/test-login', (req, res) => {
  // Create test user data
  const testUser = {
    user_id: 'test-user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin'
  };

  // Generate JWT token
  const token = jwt.sign(testUser, JWT_SECRET, { expiresIn: '24h' });

  // Set cookie
  res.cookie(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: false,  // Set to true if using HTTPS
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000  // 24 hours
  });

  // Send response dengan token info (untuk testing)
  res.json({
    success: true,
    message: 'Test login successful! You are now logged in.',
    user: testUser,
    token: token,  // Hanya untuk testing - jangan kirim token di response di production!
    cookieName: JWT_COOKIE_NAME,
    expiresIn: '24 hours'
  });
});

// Test logout endpoint
app.get('/test-logout', (req, res) => {
  res.clearCookie(JWT_COOKIE_NAME);
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// Mount CRM API routes with authentication
app.use('/api', authenticateToken, crmRoutes);

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

// Google sync API routes (protected)
app.get('/api/google/sync-status', authenticateToken, async (req, res) => {
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

app.post('/api/google/sync-contacts', authenticateToken, async (req, res) => {
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

app.post('/api/google/disconnect', authenticateToken, async (req, res) => {
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

// Microsoft/Outlook OAuth routes
app.get('/auth/microsoft', (req, res) => {
  const { session } = req.query;
  const authUrl = outlookContacts.getAuthUrl(session || 'default');
  res.redirect(authUrl);
});

app.get('/auth/microsoft/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Authorization failed: No code received');
  }

  try {
    const sessionId = state || 'default';

    if (!sessionId || sessionId === 'undefined') {
      console.error('Invalid sessionId from OAuth state:', state);
      return res.status(400).send('Authorization failed: Invalid session');
    }

    await outlookContacts.handleOAuthCallback(code, sessionId);
    res.redirect('/#contacts');
  } catch (error) {
    console.error('Microsoft OAuth callback error:', error);
    res.status(500).send('Authentication failed: ' + error.message);
  }
});

// Microsoft/Outlook sync API routes (protected)
app.get('/api/outlook/sync-status', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connected = await outlookContacts.isConnected(sessionId);
    res.json({ connected });
  } catch (error) {
    console.error('Error checking Outlook sync status:', error);
    res.status(500).json({ error: 'Failed to check sync status' });
  }
});

app.post('/api/outlook/sync-contacts', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await outlookContacts.syncContactsFromOutlook(sessionId);

    // Emit Socket.io event for real-time update
    io.emit('outlook.contactsSynced', { sessionId, count: result.synced + result.merged + result.updated });

    res.json({
      success: true,
      synced: result.synced,
      updated: result.updated,
      merged: result.merged,
      skipped: result.skipped,
      total: result.total
    });
  } catch (error) {
    console.error('Error syncing Outlook contacts:', error);
    res.status(500).json({ error: 'Failed to sync contacts', details: error.message });
  }
});

app.post('/api/outlook/disconnect', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    await outlookContacts.disconnectMicrosoft(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Outlook:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// WhatsApp contacts sync route (protected)
app.post('/api/whatsapp/sync-contacts', authenticateToken, async (req, res) => {
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

  // Try to restore session from cloud if local files don't exist
  const hasLocalCreds = fs.existsSync(path.join(authPath, 'creds.json'));
  if (!hasLocalCreds) {
    try {
      console.log(`Attempting to restore session ${sessionId} from cloud...`);
      const cloudSession = await sessionStorage.loadSessionFromCloud(sessionId);
      
      if (cloudSession) {
        // Restore credentials from cloud
        if (cloudSession.creds) {
          fs.writeFileSync(
            path.join(authPath, 'creds.json'),
            JSON.stringify(cloudSession.creds, null, 2)
          );
          console.log(`✓ Restored credentials for ${sessionId} from cloud`);
        }
        
        // Restore app state if exists
        if (cloudSession.appState) {
          fs.writeFileSync(
            path.join(authPath, 'app-state-sync-key-undefined.json'),
            JSON.stringify(cloudSession.appState, null, 2)
          );
          console.log(`✓ Restored app state for ${sessionId} from cloud`);
        }
      }
    } catch (err) {
      console.warn(`Could not restore session ${sessionId} from cloud (this is normal for new sessions):`, err.message);
      // Continue - this is normal for new sessions
    }
  }

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

app.get("/sessions", authenticateToken, (req, res) => {
  const list = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    state: s.status.state,
    hasQR: s.status.hasQR,
    user: s.user,
  }));
  res.json({ sessions: list });
});

app.post("/sessions", authenticateToken, async (req, res) => {
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

app.get("/sessions/:id/status", authenticateToken, (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ sessionId: id, ...session.status, user: session.user });
});

app.post("/sessions/:id/send", authenticateToken, async (req, res) => {
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

app.post("/sessions/:id/broadcast", authenticateToken, async (req, res) => {
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

// Personalized broadcast endpoint (protected)
app.post("/sessions/:id/broadcast-personalized", authenticateToken, async (req, res) => {
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

app.get("/sessions/:id/broadcast/:jobId", authenticateToken, (req, res) => {
  const { id, jobId } = req.params;
  const job = broadcastJobs.get(jobId);
  if (!job || job.sessionId !== id) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json({ job });
});

app.get("/sessions/:id/broadcast", authenticateToken, (req, res) => {
  const { id } = req.params;
  const jobs = Array.from(broadcastJobs.values())
    .filter((j) => j.sessionId === id)
    .sort((a, b) => (b.startedAt || b.requestedAt) - (a.startedAt || a.requestedAt));
  res.json({ jobs });
});

// Get all jobs with optional date filter (protected)
app.get("/jobs", authenticateToken, (req, res) => {
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

app.post("/sessions/:id/logout", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const session = getSessionOrError(id, res);
  if (!session) return;
  try {
    if (session.sock) {
      try {
        await session.sock.logout();
      } catch (logoutErr) {
        // "Intentional Logout" error from Baileys is expected and can be ignored
        if (!logoutErr.message.includes('Intentional Logout')) {
          console.error("Unexpected error during logout:", logoutErr);
        }
      }
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

// Cloud session management endpoints
// List all sessions in cloud
app.get("/cloud/sessions", authenticateToken, async (req, res) => {
  try {
    const sessions = await sessionStorage.listSessionsFromCloud();
    res.json({ sessions });
  } catch (error) {
    console.error('Error listing cloud sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Get session sync status
app.get("/cloud/sessions/:id/status", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const sessions = await sessionStorage.listSessionsFromCloud();
    const session = sessions.find(s => s.session_id === id);
    
    if (!session) {
      return res.status(404).json({ error: "Session not found in cloud" });
    }
    
    res.json({
      sessionId: id,
      lastSynced: session.last_synced_at,
      createdAt: session.created_at,
      updatedAt: session.updated_at
    });
  } catch (error) {
    console.error('Error getting session status:', error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// Delete session from cloud
app.delete("/cloud/sessions/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    // Delete from cloud storage
    await sessionStorage.deleteSessionFromCloud(id);

    // Also delete from database cloud_sessions table
    try {
      const connection = (await import('./database.js')).getPool();
      await connection.query(
        `DELETE FROM cloud_sessions WHERE session_id = ?`,
        [id]
      );
      console.log(`✓ Deleted cloud session record from database: ${id}`);
    } catch (dbErr) {
      // Table might not exist, ignore
      if (!dbErr.message.includes("doesn't exist")) {
        console.warn(`Could not delete cloud session from database: ${dbErr.message}`);
      }
    }

    res.json({ status: "deleted from cloud", sessionId: id });
  } catch (error) {
    console.error('Error deleting cloud session:', error);
    res.status(500).json({ error: 'Failed to delete session from cloud' });
  }
});

// Force sync session to cloud
app.post("/cloud/sessions/:id/sync", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const session = sessions.get(id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    const authPath = getAuthPath(id);
    const credsPath = path.join(authPath, 'creds.json');
    
    if (!fs.existsSync(credsPath)) {
      return res.status(400).json({ error: "No credentials found for this session" });
    }
    
    // Read and sync to cloud
    const sessionData = {
      creds: JSON.parse(fs.readFileSync(credsPath, 'utf8')),
      timestamp: Date.now()
    };
    
    const appStatePath = path.join(authPath, 'app-state-sync-key-undefined.json');
    if (fs.existsSync(appStatePath)) {
      try {
        sessionData.appState = JSON.parse(fs.readFileSync(appStatePath, 'utf8'));
      } catch (err) {
        console.warn('Could not read app state');
      }
    }
    
    await sessionStorage.saveSessionToCloud(id, sessionData);
    res.json({ status: "synced to cloud", sessionId: id });
  } catch (error) {
    console.error('Error syncing session to cloud:', error);
    res.status(500).json({ error: 'Failed to sync to cloud' });
  }
});

// Restore session from cloud
app.post("/cloud/sessions/:id/restore", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const cloudSession = await sessionStorage.loadSessionFromCloud(id);
    
    if (!cloudSession) {
      return res.status(404).json({ error: "Session not found in cloud" });
    }
    
    const authPath = getAuthPath(id);
    fs.mkdirSync(authPath, { recursive: true });
    
    // Restore credentials
    if (cloudSession.creds) {
      fs.writeFileSync(
        path.join(authPath, 'creds.json'),
        JSON.stringify(cloudSession.creds, null, 2)
      );
    }
    
    // Restore app state if exists
    if (cloudSession.appState) {
      fs.writeFileSync(
        path.join(authPath, 'app-state-sync-key-undefined.json'),
        JSON.stringify(cloudSession.appState, null, 2)
      );
    }
    
    // Reload session
    sessions.delete(id);
    await createSession(id);
    
    res.json({ status: "restored from cloud", sessionId: id });
  } catch (error) {
    console.error('Error restoring session from cloud:', error);
    res.status(500).json({ error: 'Failed to restore from cloud' });
  }
});

// Get deletion summary for session
app.get("/sessions/:id/delete-summary", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const connection = (await import('./database.js')).getPool();

    // Helper function to safely get count
    const safeGetCount = async (query, params) => {
      try {
        const [result] = await connection.query(query, params);
        return result[0]?.count || 0;
      } catch (err) {
        // Table might not exist or other error, return 0
        console.warn(`Query failed (table might not exist): ${query.substring(0, 50)}... - ${err.message}`);
        return 0;
      }
    };

    // Get counts for each data type (with error handling for missing tables)
    const summary = {};

    // Group participants
    summary.groupParticipants = await safeGetCount(
      `SELECT COUNT(DISTINCT gp.id) as count
       FROM group_participants gp
       INNER JOIN whatsapp_groups wg ON gp.group_id = wg.id
       WHERE wg.session_id = ?`,
      [id]
    );

    // Group messages
    summary.groupMessages = await safeGetCount(
      `SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND is_group_message = TRUE`,
      [id]
    );

    // Groups
    summary.groups = await safeGetCount(
      `SELECT COUNT(*) as count FROM whatsapp_groups WHERE session_id = ?`,
      [id]
    );

    // Activities
    summary.activities = await safeGetCount(
      `SELECT COUNT(*) as count FROM activities WHERE session_id = ?`,
      [id]
    );

    // Messages
    summary.messages = await safeGetCount(
      `SELECT COUNT(*) as count FROM messages WHERE session_id = ?`,
      [id]
    );

    // Contacts
    summary.contacts = await safeGetCount(
      `SELECT COUNT(*) as count FROM contacts WHERE session_id = ?`,
      [id]
    );

    // Lead statuses
    summary.leadStatuses = await safeGetCount(
      `SELECT COUNT(*) as count FROM lead_statuses WHERE session_id = ?`,
      [id]
    );

    // Cloud sessions (table might not exist)
    summary.cloudSession = await safeGetCount(
      `SELECT COUNT(*) as count FROM cloud_sessions WHERE session_id = ?`,
      [id]
    );

    // WhatsApp sessions (session credentials)
    summary.whatsappSession = await safeGetCount(
      `SELECT COUNT(*) as count FROM whatsapp_sessions WHERE session_id = ?`,
      [id]
    );

    console.log(`📊 Delete summary for session ${id}:`, summary);

    res.json({
      sessionId: id,
      summary
    });
  } catch (error) {
    console.error('Error getting delete summary:', error);
    res.status(500).json({ error: 'Failed to get delete summary', details: error.message });
  }
});

app.delete("/sessions/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { deleteOptions } = req.body; // { groupParticipants: true, groups: true, etc. }

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

    // Delete session data from database based on options
    try {
      const connection = (await import('./database.js')).getPool();

      console.log(`🗑️ Deleting database records for session: ${id}`);
      console.log(`   Delete options:`, deleteOptions);

      const options = deleteOptions || {
        groupParticipants: true,
        groupMessages: true,
        groups: true,
        activities: true,
        messages: true,
        contacts: true,
        leadStatuses: true,
        cloudSession: true,
        whatsappSession: true
      };

      let deletedItems = [];

      // Delete group participants
      if (options.groupParticipants) {
        const [groupsResult] = await connection.query(
          `SELECT id FROM whatsapp_groups WHERE session_id = ?`,
          [id]
        );

        const groupIds = groupsResult.map(g => g.id);
        if (groupIds.length > 0) {
          await connection.query(
            `DELETE FROM group_participants WHERE group_id IN (${groupIds.map(() => '?').join(',')})`,
            groupIds
          );
          deletedItems.push(`✓ Deleted group participants for ${groupIds.length} groups`);
        }
      }

      // Delete group messages
      if (options.groupMessages) {
        const [result] = await connection.query(
          `DELETE FROM messages WHERE session_id = ? AND is_group_message = TRUE`,
          [id]
        );
        deletedItems.push(`✓ Deleted ${result.affectedRows} group messages`);
      }

      // Delete groups
      if (options.groups) {
        const [result] = await connection.query(
          `DELETE FROM whatsapp_groups WHERE session_id = ?`,
          [id]
        );
        deletedItems.push(`✓ Deleted ${result.affectedRows} groups`);
      }

      // Delete activities
      if (options.activities) {
        const [result] = await connection.query(
          `DELETE FROM activities WHERE session_id = ?`,
          [id]
        );
        deletedItems.push(`✓ Deleted ${result.affectedRows} activities`);
      }

      // Delete messages
      if (options.messages) {
        const [result] = await connection.query(
          `DELETE FROM messages WHERE session_id = ?`,
          [id]
        );
        deletedItems.push(`✓ Deleted ${result.affectedRows} messages`);
      }

      // Delete contacts
      if (options.contacts) {
        const [result] = await connection.query(
          `DELETE FROM contacts WHERE session_id = ?`,
          [id]
        );
        deletedItems.push(`✓ Deleted ${result.affectedRows} contacts`);
      }

      // Delete lead statuses
      if (options.leadStatuses) {
        const [result] = await connection.query(
          `DELETE FROM lead_statuses WHERE session_id = ?`,
          [id]
        );
        deletedItems.push(`✓ Deleted ${result.affectedRows} lead statuses`);
      }

      // Delete from cloud sessions
      if (options.cloudSession) {
        try {
          const [result] = await connection.query(
            `DELETE FROM cloud_sessions WHERE session_id = ?`,
            [id]
          );
          if (result.affectedRows > 0) {
            deletedItems.push(`✓ Deleted cloud session record`);
          }
        } catch (cloudErr) {
          if (!cloudErr.message.includes("doesn't exist")) {
            console.warn(`  ⚠️ Could not delete cloud session: ${cloudErr.message}`);
          }
        }
      }

      // Delete from whatsapp_sessions (session credentials)
      if (options.whatsappSession) {
        try {
          const [result] = await connection.query(
            `DELETE FROM whatsapp_sessions WHERE session_id = ?`,
            [id]
          );
          if (result.affectedRows > 0) {
            deletedItems.push(`✓ Deleted WhatsApp session record`);
          }
        } catch (waSessionErr) {
          if (!waSessionErr.message.includes("doesn't exist")) {
            console.warn(`  ⚠️ Could not delete WhatsApp session: ${waSessionErr.message}`);
          }
        }
      }

      deletedItems.forEach(item => console.log(`  ${item}`));
      console.log(`✓ Database cleanup complete for session: ${id}`);
    } catch (dbErr) {
      console.error("Failed to delete session data from database:", dbErr);
      // Continue anyway - session is already deleted from memory/files
    }

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

  // Initialize database with schema validation/migration
  const force = process.env.FORCE_DB_MIGRATION === 'true';
  try {
    console.log('Initializing and validating database schema...');
    if (force) {
      console.log('FORCE_DB_MIGRATION is enabled: will drop extra columns if found.');
    }
    await initDatabase({ force, backup: false });
    await testConnection();
    console.log('✓ Database initialized and validated successfully');
  } catch (err) {
    console.error('✗ Database initialization/validation failed:', err);
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
