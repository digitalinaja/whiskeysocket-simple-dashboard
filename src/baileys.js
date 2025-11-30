const qrcode = require("qrcode-terminal");

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

    return sock;
  };

  return startSock();
}

module.exports = startWA;
