# WhiskeySockets Simple Dashboard

A simple WhatsApp dashboard built with Baileys for managing WhatsApp connections.

## Features

- WhatsApp Multi-Device (MD) support
- **MD Codex 5.3 History Sync** - Full chat history synchronization enabled
- Real-time messaging
- CRM functionality
- Google Contacts integration
- Session management

## MD Codex 5.3 (Multi-Device History Sync)

This dashboard now supports **WhatsApp MD Codex 5.3**, which enables full chat history synchronization from WhatsApp servers.

### What is MD Codex 5.3?

MD Codex 5.3 refers to WhatsApp's Multi-Device protocol for history synchronization. It allows:
- **Full history sync** on first connection or device pairing
- **Recent message sync** on reconnection
- Better desktop app emulation for increased history limits

### Configuration

The following options are now enabled in `src/baileys.js`:

```javascript
sock = makeWASocket({
  auth: state,
  browser: Browsers.macOS('Desktop'),  // Desktop emulation for better history sync
  syncFullHistory: true,                 // Enable full history synchronization
  // ... other options
});
```

### Benefits

- **Desktop Emulation**: Using `Browsers.macOS('Desktop')` allows WhatsApp servers to provide more complete chat history compared to web browser sessions
- **Full History Sync**: `syncFullHistory: true` instructs the client to fetch as much history as WhatsApp allows
- **History Events**: The application can now handle `messaging-history.set` events that provide bulk chat history

### How It Works

When you scan the QR code:
1. The socket connects with desktop browser emulation
2. WhatsApp servers recognize it as a desktop client
3. Full history sync is initiated automatically
4. History is delivered via `messaging-history.set` events
5. The `onHistorySync` callback processes chats, contacts, and messages

## Installation

```bash
npm install
```

## Running

```bash
npm start
```

The server will start on port 3000 (or the port specified in your .env file).

## Environment Variables

Create a `.env` file based on `.env.example`:

```env
PORT=3000
```

## Requirements

- Node.js 18 or higher
- @whiskeysockets/baileys 7.0.0 or higher

## License

ISC
