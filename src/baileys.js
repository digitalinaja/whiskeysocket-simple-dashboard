import qrcode from "qrcode-terminal";

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

    sock.ev.on("creds.update", saveCreds);

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
