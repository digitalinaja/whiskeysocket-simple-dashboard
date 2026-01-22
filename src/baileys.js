import qrcode from "qrcode-terminal";
import * as sessionStorage from "./sessionStorage.js";
import fs from "fs";
import path from "path";

let baileysPromise;
function getBaileys() {
  if (!baileysPromise) {
    baileysPromise = import("@whiskeysockets/baileys");
  }
  return baileysPromise;
}

async function startWA({
  io,
  sessionId = "default",
  authPath = "./auth",
  onSockUpdate,
  onStatusChange,
  onQR,
  onMessage,
  onMessageStatus,
  onHistorySync,
} = {}) {
  const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
  } = await getBaileys();
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  let sock;

  const startSock = () => {
    if (onStatusChange) onStatusChange({ state: "connecting", hasQR: false });

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
    });

    if (onSockUpdate) onSockUpdate(sock);

    sock.ev.on("connection.update", (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        qrcode.generate(qr, { small: true });
        io.emit("qr", { sessionId, qr });
        if (onQR) onQR(qr);
        if (onStatusChange) onStatusChange({ state: "qr", hasQR: true });
      }

      if (connection === "open") {
        io.emit("ready", { sessionId, message: "WhatsApp connected!" });
        if (onStatusChange) onStatusChange({ state: "open", hasQR: false });
      }

      if (connection === "close") {
        io.emit("close", { sessionId, message: "WhatsApp disconnected!" });
        if (onStatusChange) onStatusChange({ state: "close", hasQR: false });

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          setTimeout(startSock, 2000); // simple backoff before reconnect
        }
      }
    });

    sock.ev.on("creds.update", async () => {
      // Save locally first
      await saveCreds();
      
      // Then sync to cloud
      try {
        // Read the latest session files from disk
        const credsPath = path.join(authPath, 'creds.json');
        const appStatePath = path.join(authPath, 'app-state-sync-key-undefined.json');
        
        if (fs.existsSync(credsPath)) {
          const sessionData = {
            creds: JSON.parse(fs.readFileSync(credsPath, 'utf8')),
            timestamp: Date.now()
          };
          
          // Try to read app state if exists
          if (fs.existsSync(appStatePath)) {
            try {
              sessionData.appState = JSON.parse(fs.readFileSync(appStatePath, 'utf8'));
            } catch (err) {
              console.warn('Could not read app state:', err.message);
            }
          }
          
          // Save to cloud with error handling
          try {
            await sessionStorage.saveSessionToCloud(sessionId, sessionData);
            console.log(`☁️ Session ${sessionId} synced to cloud`);
          } catch (cloudErr) {
            // Log error but don't crash - local session still works
            console.error(`⚠️ Failed to sync session ${sessionId} to cloud:`, cloudErr.message);
          }
        }
      } catch (err) {
        console.error('Error during cloud sync:', err);
        // Continue operation even if cloud sync fails
      }
    });

    // Handle incoming messages (both real-time and history sync)
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (onMessage) {
        for (const msg of messages) {
          try {
            // Process both "notify" (real-time) and "append" (history sync)
            // The callback will handle the logic differently based on context
            await onMessage(sessionId, msg, type, sock);
          } catch (error) {
            console.error("Error handling message:", error);
          }
        }
      }
    });

    // Handle history sync (chats, contacts, messages from other devices)
    sock.ev.on("messaging-history.set", async ({ chats, contacts, messages, syncType }) => {
      console.log(`📚 History sync received: ${messages?.length || 0} messages, ${chats?.length || 0} chats, ${contacts?.length || 0} contacts (syncType: ${syncType})`);

      if (onHistorySync) {
        try {
          await onHistorySync(sessionId, { chats, contacts, messages, syncType }, sock);
        } catch (error) {
          console.error("Error handling history sync:", error);
        }
      }
    });

    // Handle message status updates (delivered, read, etc.)
    sock.ev.on("message.update", (updates) => {
      if (onMessageStatus) {
        for (const update of updates) {
          try {
            onMessageStatus(sessionId, update);
          } catch (error) {
            console.error("Error handling message status update:", error);
          }
        }
      }
    });

    return sock;
  };

  return startSock();
}

export default startWA;
