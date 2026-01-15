# WhatsApp Web-like Chat UI with CRM Features - Implementation Plan

## Overview
Add a real-time chat interface and lead management (CRM) system to the existing WhatsApp dashboard, integrating with TiDB Cloud for data persistence.

## Requirements

### Chat Features
- Contact list with recent messages
- Real-time messaging (send/receive)
- Message history

### CRM Features
- Lead tagging system (custom tags)
- Lead status/pipeline tracking
- Notes per contact
- Search and filter leads
- **Google Contacts sync** - Import contacts from Google Contacts

### Technical Specifications
- **Database**: TiDB Cloud (MySQL-compatible with SSL)
- **Layout**: 2-column (contacts sidebar + chat window)
- **Real-time**: Socket.io for instant updates
- **Responsive**: Mobile-friendly, matching existing dark theme
- **Google Integration**: Google People API + OAuth 2.0

---

## Implementation Plan

### Phase 1: Database Foundation

#### 1.1 Install Dependencies
**File**: `package.json`
- Add `mysql2`: `^3.6.0` for TiDB Cloud connection
- Add `googleapis`: `^140.0.0` for Google People API
- Add `express-session`: `^1.17.3` for OAuth session management

#### 1.2 Create Database Module
**File**: `src/database.js` (NEW - ~200 lines)

Key functions:
- `getPool()` - MySQL connection pool with SSL configuration
- `initDatabase()` - Create tables on startup

Database tables to create:
- `contacts` - Store contacts from WhatsApp and Google (with source tracking)
- `messages` - Message history
- `tags` - Custom tags for leads
- `contact_tags` - Tag associations (junction table)
- `lead_statuses` - Pipeline stages (new, contacted, qualified, etc.)
- `notes` - Notes per contact
- `google_tokens` - Store OAuth tokens for Google API access

#### 1.3 Environment Variables
Create `.env` file:
```
TIDB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
TIDB_PORT=4000
TIDB_USER=your_username
TIDB_PASSWORD=your_password
TIDB_DATABASE=whiskeysocket_crm

# Google OAuth (get from Google Cloud Console)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=your_random_session_secret
```

---

### Phase 2: Backend Message Handling

#### 2.1 Modify Baileys Wrapper
**File**: `src/baileys.js` (MODIFY)

Add `onMessage` callback parameter:
```javascript
async function startWA({ onMessage, ... } = {}) {
  // Add event handler for incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type === 'notify' && onMessage) {
      for (const msg of messages) {
        await onMessage(sessionId, msg);
      }
    }
  });
}
```

#### 2.2 Create Chat Handlers Module
**File**: `src/chatHandlers.js` (NEW - ~400 lines)

Key functions:
- `handleIncomingMessage(sessionId, message)` - Process incoming WhatsApp messages, save to DB, emit Socket.io events
- `syncContactsFromWhatsApp(sessionId, sock)` - Fetch and store contacts from WhatsApp
- `sendMessage(sessionId, phone, content)` - Send message via Baileys, save to DB
- `getContactsWithRecentMessages(sessionId, search, limit)` - Get contacts list for sidebar
- `getContactHistory(sessionId, contactPhone, limit)` - Get message history

#### 2.3 Modify Main Server
**File**: `src/index.js` (MODIFY - add ~150 lines)

Changes:
- Import database and chat handlers modules
- Initialize database on server startup
- Update `createSession()` to include `onMessage` callback
- Mount CRM routes

---

### Phase 3: Backend CRM API

#### 3.1 Create CRM Routes Module
**File**: `src/crmRoutes.js` (NEW - ~300 lines)

API endpoints to implement:

**Contacts:**
- `GET /api/contacts?sessionId=x&search=y&limit=20&statusId=z&tagId=w` - List contacts with filters
- `GET /api/contacts/:contactId?sessionId=x` - Get contact details with tags, notes, status
- `GET /api/contacts/:contactId/messages?sessionId=x&limit=50` - Get message history

**Tags:**
- `GET /api/tags?sessionId=x` - List all tags
- `POST /api/tags` - Create new tag
- `POST /api/contacts/:contactId/tags` - Add tag to contact
- `DELETE /api/contacts/:contactId/tags/:tagId` - Remove tag

**Lead Statuses:**
- `GET /api/lead-statuses?sessionId=x` - List all statuses
- `POST /api/lead-statuses` - Create new status
- `PUT /api/contacts/:contactId/status` - Update lead status

**Notes:**
- `GET /api/contacts/:contactId/notes?sessionId=x` - Get notes
- `POST /api/contacts/:contactId/notes` - Add note
- `PUT /api/notes/:noteId` - Update note
- `DELETE /api/notes/:noteId` - Delete note

**Chat:**
- `POST /api/chat/send` - Send message from chat UI

**Google Sync:**
- `GET /auth/google` - Initiate Google OAuth flow
- `GET /auth/google/callback` - OAuth callback handler
- `GET /api/google/sync-status` - Check if Google is connected
- `POST /api/google/sync-contacts` - Trigger contacts sync from Google
- `POST /api/google/disconnect` - Disconnect Google account

---

### Phase 3.5: Google Contacts Integration

#### 3.5.1 Database Schema Update
**File**: `src/database.js` - Update `contacts` table schema

Add `source` column to track contact origin:
```sql
ALTER TABLE contacts ADD COLUMN source ENUM('whatsapp', 'google', 'both') DEFAULT 'whatsapp';
ALTER TABLE contacts ADD COLUMN google_contact_id VARCHAR(255) NULL;
ALTER TABLE contacts ADD INDEX idx_google_contact (google_contact_id);
```

Create `google_tokens` table:
```sql
CREATE TABLE google_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  expiry_date TIMESTAMP NULL,
  scope TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 3.5.2 Create Google Contacts Module
**File**: `src/googleContacts.js` (NEW - ~300 lines)

Key functions:
- `getAuthUrl(sessionId)` - Generate Google OAuth URL
- `handleOAuthCallback(code, sessionId)` - Exchange code for tokens
- `getGoogleClient(sessionId)` - Get authenticated Google client
- `syncContactsFromGoogle(sessionId)` - Fetch contacts from Google People API
- `mergeContactsWithWhatsApp(contacts, sessionId)` - Smart merge logic:
  - Match by phone number if available
  - Match by name similarity
  - Update existing contact's source to 'both'
  - Create new contacts for unmatched entries
- `disconnectGoogle(sessionId)` - Remove tokens and disconnect

Contact sync logic:
```javascript
async function syncContactsFromGoogle(sessionId) {
  const client = await getGoogleClient(sessionId);
  const response = await client.people.people.connections.list({
    resourceName: 'people/me',
    personFields: 'names,phoneNumbers,emailAddresses,organizations',
    pageSize: 1000
  });

  const googleContacts = response.data.connections || [];
  const mergedContacts = [];

  for (const gc of googleContacts) {
    const name = gc.names?.[0]?.displayName || 'Unknown';
    const phone = gc.phoneNumbers?.[0]?.value?.replace(/\D/g, '') || null;

    // Check if contact exists by phone
    let existingContact = await findContactByPhone(sessionId, phone);

    if (existingContact) {
      // Update to 'both' source
      await updateContactSource(existingContact.id, 'both', gc.resourceName);
      mergedContacts.push({ ...existingContact, source: 'both' });
    } else {
      // Create new contact with source='google'
      const newContact = await createContact({
        sessionId,
        name,
        phone,
        source: 'google',
        googleContactId: gc.resourceName
      });
      mergedContacts.push(newContact);
    }
  }

  return mergedContacts;
}
```

#### 3.5.3 Update Main Server
**File**: `src/index.js` (MODIFY - add ~80 lines)

Add Google OAuth routes:
```javascript
const googleContacts = require('./googleContacts');

// OAuth routes
app.get('/auth/google', (req, res) => {
  const authUrl = googleContacts.getAuthUrl();
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  await googleContacts.handleOAuthCallback(code);
  res.redirect('/#settings'); // Redirect to settings page
});

// Google sync endpoints
app.get('/api/google/sync-status', async (req, res) => {
  const { sessionId } = req.query;
  const isConnected = await googleContacts.isConnected(sessionId);
  res.json({ connected: isConnected });
});

app.post('/api/google/sync-contacts', async (req, res) => {
  const { sessionId } = req.body;
  const contacts = await googleContacts.syncContactsFromGoogle(sessionId);
  // Emit Socket.io event for real-time update
  io.emit('google.contactsSynced', { sessionId, count: contacts.length });
  res.json({ success: true, synced: contacts.length });
});

app.post('/api/google/disconnect', async (req, res) => {
  const { sessionId } = req.body;
  await googleContacts.disconnectGoogle(sessionId);
  res.json({ success: true });
});
```

---

### Phase 4: Frontend Chat UI

#### 4.1 Update Navigation
**File**: `public/index.html` - Sidebar section (MODIFY around line 571-603)

Add new navigation items:
```html
<a href="#chat" class="nav-item" data-view="chat">💬 Chat</a>
<a href="#contacts" class="nav-item" data-view="contacts">👥 Contacts</a>
```

#### 4.2 Add Chat View HTML
**File**: `public/index.html` - After existing views (MODIFY - add ~150 lines)

Structure:
```html
<div id="view-chat" class="view">
  <div class="chat-container">
    <!-- Contacts Sidebar -->
    <div class="chat-contacts-sidebar">
      <div class="chat-header">
        <select id="chatSessionSelect"></select>
        <input id="chatSearchInput" placeholder="Search contacts...">
      </div>
      <div class="contacts-list" id="chatContactsList"></div>
    </div>

    <!-- Chat Window -->
    <div class="chat-window">
      <div id="chatWelcome">Select a contact to start messaging</div>
      <div id="chatConversation" style="display: none;">
        <div class="chat-window-header">Contact info, actions</div>
        <div class="messages-container" id="messagesContainer"></div>
        <div class="message-input-area">
          <div class="crm-quick-actions">Status, Tag, Note buttons</div>
          <div class="message-input-wrapper">
            <textarea id="messageInput" placeholder="Type a message..."></textarea>
            <button id="sendMessageBtn">➤</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

#### 4.3 Add Chat CSS Styles
**File**: `public/index.html` - `<style>` section (ADD ~400 lines)

Key styles:
- `.chat-container` - 2-column grid layout (320px sidebar + 1fr chat)
- `.contact-item` - Contact list items with hover/active states
- `.message` - Message bubbles (incoming/outgoing styles)
- `.message-input-area` - Input with quick action buttons
- `.chat-window-header` - Contact info display
- Responsive design for mobile (hide sidebar when chat open)

#### 4.4 Add Chat JavaScript
**File**: `public/index.html` - `<script>` section (ADD ~600 lines)

Key functions:
- `loadChatContacts(sessionId, search)` - Fetch and render contacts list
- `openChatContact(contactId)` - Open chat with specific contact
- `loadContactMessages(contactId)` - Fetch message history
- `renderMessages()` - Render messages in chat window
- `sendMessage()` - Send message via API
- Socket.io event handlers for `chat.newMessage` and `chat.messageStatus`

---

### Phase 5: Frontend CRM UI

#### 5.1 Add Contacts View HTML
**File**: `public/index.html` (MODIFY - add ~100 lines)

Structure:
```html
<div id="view-contacts" class="view">
  <div class="crm-container">
    <!-- Filters Sidebar -->
    <div class="crm-filters-sidebar">
      <select id="crmSessionSelect"></select>
      <input id="crmSearchInput" placeholder="Search...">
      <select id="crmStatusFilter">All Statuses</select>
      <div id="crmTagsFilter" class="tags-checkboxes"></div>
    </div>

    <!-- Contacts Grid -->
    <div class="crm-contacts-grid">
      <div class="crm-toolbar">
        <div id="crmContactCount">0 contacts</div>
        <div class="sync-buttons">
          <button id="syncWhatsAppBtn">🔄 Sync WhatsApp</button>
          <button id="syncGoogleBtn">🔄 Sync Google Contacts</button>
        </div>
      </div>
      <div id="googleStatus" class="google-status" style="display: none;">
        <span id="googleConnectionStatus">✅ Connected to Google</span>
        <button id="disconnectGoogleBtn" class="btn-ghost btn-sm">Disconnect</button>
      </div>
      <div id="googleNotConnected" class="google-notice" style="display: none;">
        <span>📇 Google Contacts not connected</span>
        <button id="connectGoogleBtn" class="btn-sm btn-primary">Connect Google</button>
      </div>
      <div class="contacts-cards" id="crmContactsCards"></div>
    </div>
  </div>
</div>
```

#### 5.2 Add Contact Detail Modal
**File**: `public/index.html` (MODIFY - add ~50 lines)

Modal with:
- Contact info (name, phone, avatar)
- Lead status dropdown
- Tags management (add/remove)
- Notes list and add note form
- "Open Chat" button

#### 5.3 Add CRM CSS Styles
**File**: `public/index.html` - `<style>` section (ADD ~200 lines)

Key styles:
- `.crm-container` - Grid layout (280px filters + 1fr content)
- `.contact-card` - Card with avatar, name, tags, stats
- `.tag-badge` - Small pill-shaped tags
- `.lead-status-badge` - Status indicators
- `.modal` - Centered overlay modal

#### 5.4 Add CRM JavaScript
**File**: `public/index.html` - `<script>` section (ADD ~400 lines)

Key functions:
- `loadCRMData(sessionId)` - Load contacts, tags, statuses
- `loadCRMContacts(filters)` - Fetch and filter contacts
- `renderCRMContacts()` - Render contact cards
- `showContactDetailModal(contactId)` - Show and populate modal
- `updateContactStatus()`, `addTagToContact()`, `addNoteToContact()`
- `checkGoogleConnection()` - Check if Google is connected
- `syncGoogleContacts()` - Trigger Google sync
- `connectGoogle()` - Redirect to Google OAuth

**Google Sync JavaScript:**
```javascript
// Check Google connection status on page load
async function checkGoogleConnection() {
  const sessionId = document.getElementById('crmSessionSelect').value;
  const res = await fetch(`/api/google/sync-status?sessionId=${sessionId}`);
  const data = await res.json();

  if (data.connected) {
    document.getElementById('googleStatus').style.display = 'flex';
    document.getElementById('googleNotConnected').style.display = 'none';
  } else {
    document.getElementById('googleStatus').style.display = 'none';
    document.getElementById('googleNotConnected').style.display = 'flex';
  }
}

// Connect to Google
document.getElementById('connectGoogleBtn')?.addEventListener('click', () => {
  window.location.href = '/auth/google';
});

// Disconnect Google
document.getElementById('disconnectGoogleBtn')?.addEventListener('click', async () => {
  const sessionId = document.getElementById('crmSessionSelect').value;
  await fetch('/api/google/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  });
  checkGoogleConnection();
});

// Sync Google Contacts
document.getElementById('syncGoogleBtn')?.addEventListener('click', async () => {
  const sessionId = document.getElementById('crmSessionSelect').value;
  const btn = document.getElementById('syncGoogleBtn');
  btn.disabled = true;
  btn.textContent = '🔄 Syncing...';

  try {
    const res = await fetch('/api/google/sync-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    const data = await res.json();

    if (data.success) {
      alert(`Successfully synced ${data.synced} contacts from Google!`);
      await loadCRMContacts(sessionId);
    }
  } catch (err) {
    alert('Failed to sync Google contacts: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Sync Google Contacts';
  }
});

// Socket.io event for Google sync completion
socket.on('google.contactsSynced', (data) => {
  console.log(`Synced ${data.count} contacts from Google`);
  loadCRMContacts(data.sessionId);
});
```

---

### Phase 6: Integration & Polish

#### 6.1 Socket.io Events
**File**: `src/socket.js` (DOCUMENT events)

New events to emit:
- `chat.newMessage` - New incoming message
- `chat.messageStatus` - Message status update (delivered/read)
- `chat.contactUpdated` - Contact info updated
- `crm.tagAdded` - Tag added to contact
- `crm.statusUpdated` - Lead status changed

#### 6.2 Update Dashboard Stats
**File**: `public/index.html` - Dashboard view (MODIFY)

Add new stat cards:
- Total Contacts
- Messages Today

#### 6.3 Session Selector Integration
**File**: `public/index.html` - JavaScript (MODIFY)

Update `updateAllSessionSelects()` to include:
- `chatSessionSelect`
- `crmSessionSelect`

---

## Critical Files Summary

### New Files to Create
1. **`src/database.js`** - TiDB Cloud connection, table creation, DB initialization
2. **`src/chatHandlers.js`** - Message handling, contact syncing, chat operations
3. **`src/crmRoutes.js`** - All CRM and chat API endpoints
4. **`src/googleContacts.js`** - Google OAuth and People API integration

### Files to Modify
1. **`src/baileys.js`** - Add `onMessage` callback for incoming messages
2. **`src/index.js`** - Database initialization, mount CRM routes, Google OAuth routes, update session creation
3. **`public/index.html`** - Add chat/CRM views (~1800 lines: HTML, CSS, JavaScript)
4. **`package.json`** - Add mysql2, googleapis, express-session dependencies

---

## Implementation Order

### Step 1: Database Setup
1. Run `npm install mysql2 googleapis express-session`
2. Create Google Cloud project and enable People API
3. Get OAuth credentials from Google Cloud Console
4. Create `.env` with TiDB Cloud and Google credentials
5. Create `src/database.js` with connection and schema
6. Test database connection and table creation

### Step 2: Backend Foundation
5. Modify `src/baileys.js` to add message callback
6. Create `src/chatHandlers.js` with core functions
7. Modify `src/index.js` to integrate database and message handling
8. Test incoming message processing with real WhatsApp message

### Step 3: API Development
9. Create `src/crmRoutes.js` with all endpoints
10. Test endpoints with Postman/curl
11. Implement contact syncing from WhatsApp

### Step 3.5: Google Integration
12. Create `src/googleContacts.js` with OAuth and sync logic
13. Add Google OAuth routes to `src/index.js`
14. Test OAuth flow (authorize, callback, token storage)
15. Test Google People API contact sync
16. Test contact merging logic (WhatsApp + Google)

### Step 4: Chat UI
17. Add chat view HTML structure
18. Add chat CSS styles
19. Implement chat JavaScript functions
20. Test sending and receiving messages

### Step 5: CRM UI
21. Add contacts view HTML structure
22. Add CRM CSS styles
23. Implement CRM JavaScript functions
24. Test tag/status/notes functionality
25. Add Google sync UI (connect button, sync button, status indicator)
26. Test Google sync from UI

### Step 6: Integration
27. Update navigation and routing
28. Add dashboard stats
29. Integrate with existing session system
30. Test multi-session scenarios
31. Test contact merging across WhatsApp and Google sources

### Step 7: Testing & Polish
32. Test all features end-to-end
33. Fix bugs and optimize performance
34. Test on mobile devices
35. Add error handling and loading states
36. Test Google sync with large contact lists
37. Test token refresh and re-authentication flow

---

## Verification Steps

### Database Verification
```bash
# After setup, check tables exist
mysql -h HOST -u USER -p DATABASE -e "SHOW TABLES;"

# Expected output:
# contacts, messages, tags, contact_tags, lead_statuses, notes
```

### Backend Verification
```bash
# Test API endpoints
curl http://localhost:3000/api/contacts?sessionId=default
curl http://localhost:3000/api/tags?sessionId=default
curl http://localhost:3000/api/lead-statuses?sessionId=default

# Send test message via API
curl -X POST http://localhost:3000/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"default","phone":"1234567890","content":"Test"}'
```

### Frontend Verification
1. Open http://localhost:3000
2. Navigate to Chat view
3. Select a session from dropdown
4. Contacts sidebar should load
5. Click contact to open chat
6. Send message and verify it appears
7. Test receiving message from another phone
8. Navigate to Contacts view
9. Test filters (search, status, tags)
10. Click contact card to open detail modal
11. Update status, add tag, add note
12. Verify changes persist

### Real-time Verification
1. Open dashboard in two browser windows
2. Send message in one window
3. Verify message appears in both windows instantly
4. Update contact status in one window
5. Verify change reflects in both windows

### Database Verification
```bash
# Check messages were saved
mysql -h HOST -u USER -p DATABASE -e "SELECT COUNT(*) FROM messages;"

# Check contacts with tags
mysql -h HOST -u USER -p DATABASE -e "SELECT c.name, t.name FROM contacts c JOIN contact_tags ct ON c.id = ct.contact_id JOIN tags t ON ct.tag_id = t.id;"

# Check contact sources (WhatsApp, Google, or Both)
mysql -h HOST -u USER -p DATABASE -e "SELECT source, COUNT(*) as count FROM contacts GROUP BY source;"

# Check Google tokens stored
mysql -h HOST -u USER -p DATABASE -e "SELECT session_id, created_at FROM google_tokens;"
```

### Google Contacts Verification
1. Navigate to Contacts view
2. Click "Connect Google" button
3. Should redirect to Google OAuth consent screen
4. Authorize the application
5. Should redirect back to app with success message
6. Check "Connected to Google" status appears
7. Click "Sync Google Contacts" button
8. Verify contacts from Google appear in CRM
9. Check console for sync completion message
10. Verify contacts with matching phone numbers show source="both"
11. Test disconnect and reconnect flow

---

## Notes

- **Default Lead Statuses**: Will be auto-created when new session starts (New Lead, Contacted, Qualified, Proposal Sent, Closed Won, Closed Lost)
- **Contact Syncing**:
  - Manual sync from WhatsApp via "Sync WhatsApp" button
  - Manual sync from Google via "Sync Google Contacts" button
  - Can be automated with cron jobs if needed
- **Contact Sources**: Contacts can come from WhatsApp, Google, or both (matched by phone number)
- **Message Status**: Baileys provides delivery receipts, will be tracked and displayed
- **Multi-Session**: Each session maintains separate contacts, messages, tags, statuses, and Google connections
- **Performance**: Database indexes on frequently queried columns (phone, timestamp, session_id, google_contact_id)
- **Security**: Parameterized queries prevent SQL injection; SSL connection to TiDB Cloud; OAuth 2.0 for Google
- **Google API Quotas**: People API has daily limits (default: 10,000 requests per day for free tier)
- **Token Refresh**: Google access tokens expire after 1 hour; refresh tokens will be used automatically

---

## Time Estimate

- **Phase 1**: 1-2 days (Database setup)
- **Phase 2**: 2-3 days (Backend message handling)
- **Phase 3**: 2-3 days (CRM API)
- **Phase 3.5**: 2-3 days (Google Contacts integration + OAuth setup)
- **Phase 4**: 2-3 days (Chat UI)
- **Phase 5**: 2-3 days (CRM UI + Google sync UI)
- **Phase 6**: 2-3 days (Integration & polish)

**Total**: 13-20 days for complete implementation with Google Contacts sync
