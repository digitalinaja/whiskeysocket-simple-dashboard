const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const startWA = require("./baileys");
const initSocket = require("./socket");

const app = express();
const server = http.createServer(app);
const io = initSocket(server);

let sock;
let waStatus = { state: "starting", hasQR: false };
const AUTH_DIR = path.join(__dirname, "..", "auth");

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

app.post("/send", async (req, res) => {
  const { number, message } = req.body;

  if (!sock) return res.status(500).json({ error: "WA not connected" });
  if (waStatus.state !== "open") return res.status(503).json({ error: "WA not ready" });
  const normalized = normalizeNumber(number);
  if (!normalized) return res.status(400).json({ error: "Invalid number format" });
  const exists = await ensureWhatsAppNumber(sock, normalized);
  if (!exists) return res.status(400).json({ error: "Number is not on WhatsApp" });

  try {
    await sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: message });
    res.json({ status: "sent" });
  } catch (err) {
    console.error("Send failed", err);
    res.status(500).json({ error: err?.message || "Failed to send" });
  }
});

app.post("/broadcast", async (req, res) => {
  const { numbers = [], message } = req.body;
  if (!sock) return res.status(500).json({ error: "WA not connected" });
  if (waStatus.state !== "open") return res.status(503).json({ error: "WA not ready" });
  const results = [];

  try {
    for (const number of numbers) {
      const normalized = normalizeNumber(number);
      if (!normalized) {
        results.push({ number, status: "skipped", reason: "invalid number" });
        continue;
      }

      const exists = await ensureWhatsAppNumber(sock, normalized);
      if (!exists) {
        results.push({ number: normalized, status: "skipped", reason: "not on WhatsApp" });
        continue;
      }

      try {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay between messages
        await sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: message });
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

app.get("/status", (req, res) => {
  res.json({
    state: waStatus.state,
    hasQR: waStatus.hasQR,
    user: sock?.user,
  });
});

function resetAuthDir() {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    console.error("Failed clearing auth dir", err);
  }
}

app.post("/logout", async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }
    resetAuthDir();
    sock = await startWA(io, {
      onSockUpdate: (newSock) => {
        sock = newSock;
      },
      onStatusChange: (status) => {
        waStatus = { ...waStatus, ...status };
        io.emit("status", waStatus);
      },
    });
    res.json({ status: "logged out" });
  } catch (err) {
    console.error("Logout failed", err);
    res.status(500).json({ error: err?.message || "Logout failed" });
  }
});

server.listen(3000, async () => {
  console.log("Server running on port 3000");

  sock = await startWA(io, {
    onSockUpdate: (newSock) => {
      sock = newSock;
    },
    onStatusChange: (status) => {
      waStatus = { ...waStatus, ...status };
      io.emit("status", waStatus);
    },
  });
});

io.on("connection", (socket) => {
  socket.emit("status", waStatus);
});
