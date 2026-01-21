# WhatsApp Groups Feature - Implementation Plan

## 📋 Current Application Structure

### Existing Menu Structure
```
Main
├─ 📊 Dashboard
└─ 📱 Sessions

Messaging
├─ 💬 Chat (Private chat saat ini)
├─ 📤 Send Message
└─ 📢 Broadcast

CRM
└─ 👥 Contacts (Leads & Customers management)

Monitoring
└─ 📋 Broadcast Jobs
```

---

## 🎯 Proposed Groups Integration

### Option A: Add New Menu "Groups" (RECOMMENDED ⭐)
```
Messaging
├─ 💬 Chat          (Private chats only)
├─ 👥 Groups        (NEW - Group chats)
├─ 📤 Send Message
└─ 📢 Broadcast

CRM
└─ 👥 Contacts     (Leads & Customers - private only)
```

**Rationale:**
- Clean separation between private & group messaging
- Contacts menu tetap fokus ke CRM/Leads
- Groups menu untuk semua jenis grup (business, internal, personal)

### Option B: Tabs inside Chat Menu
```
Messaging
├─ 💬 Chat
│   ├─ [Chats] [Groups] tabs
├─ 📤 Send Message
└─ 📢 Broadcast
```

**Rationale:**
- Tetap satu menu "Chat"
- Tabs untuk switch antara private & group

---

## 🎨 UI Design - Option A (Recommended)

### 1. Navigation Menu Update

#### Update `index.html` Navigation Section
```html
<div class="nav-section">
  <div class="nav-section-title">Messaging</div>
  <a href="#chat" class="nav-item" data-view="chat">
    <span class="icon">💬</span>
    <span>Chat</span>
  </a>
  <!-- NEW: Groups Menu -->
  <a href="#groups" class="nav-item" data-view="groups">
    <span class="icon">👥</span>
    <span>Groups</span>
    <span class="badge" id="groupsUnreadBadge">0</span>
  </a>
  <a href="#send-message" class="nav-item" data-view="send-message">
    <span class="icon">📤</span>
    <span>Send Message</span>
  </a>
  <a href="#broadcast" class="nav-item" data-view="broadcast">
    <span class="icon">📢</span>
    <span>Broadcast</span>
  </a>
</div>
```

---

### 2. Groups View Structure

#### New HTML View: `#view-groups`
```html
<!-- Groups View -->
<div id="view-groups" class="view view-flex">
  <div class="groups-container">
    <!-- Groups Sidebar -->
    <div class="groups-sidebar">
      <div class="groups-header">
        <div class="session-selector">
          <select id="groupsSessionSelect">
            <option value="">Select Session...</option>
          </select>
        </div>
        <div class="search-box">
          <input type="text" id="groupsSearchInput" placeholder="Search groups...">
        </div>
      </div>

      <!-- Category Tabs -->
      <div class="category-tabs">
        <button class="category-tab active" data-category="all">
          💼 All (0)
        </button>
        <button class="category-tab" data-category="business">
          💼 Business (0)
        </button>
        <button class="category-tab" data-category="internal">
          👔 Internal (0)
        </button>
        <button class="category-tab" data-category="personal">
          🏠 Personal (0)
        </button>
      </div>

      <!-- Groups List -->
      <div class="groups-list" id="groupsList">
        <div class="loading-groups">Loading groups...</div>
      </div>
    </div>

    <!-- Group Chat Window -->
    <div class="group-chat-window">
      <!-- Welcome State -->
      <div id="groupChatWelcome" class="chat-welcome">
        <div class="welcome-icon">👥</div>
        <h3>Welcome to Groups</h3>
        <p>Select a group to start messaging</p>
        <div class="quick-stats">
          <div class="stat-item">
            <span class="stat-value" id="totalGroupsCount">0</span>
            <span class="stat-label">Total Groups</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" id="businessGroupsCount">0</span>
            <span class="stat-label">Business</span>
          </div>
          <div class="stat-item">
            <span class="stat-value" id="unreadGroupsCount">0</span>
            <span class="stat-label">Unread</span>
          </div>
        </div>
      </div>

      <!-- Group Conversation -->
      <div id="groupConversation" class="chat-conversation" style="display: none;">
        <!-- Group Chat Header -->
        <div class="chat-window-header group-header">
          <div class="group-info">
            <div class="group-avatar" id="groupChatAvatar">👥</div>
            <div class="group-details">
              <div class="group-name" id="groupChatName">-</div>
              <div class="group-meta">
                <span class="participant-count" id="groupParticipantCount">👤 0 members</span>
                <span class="category-badge" id="groupCategoryBadge">💼 Business</span>
              </div>
            </div>
          </div>
          <div class="chat-actions">
            <button class="btn-icon" id="viewParticipantsBtn" title="View Participants">👥</button>
            <button class="btn-icon" id="groupSettingsBtn" title="Group Settings">⚙️</button>
            <button class="btn-icon" id="leaveGroupBtn" title="Leave Group">🚪</button>
          </div>
        </div>

        <!-- Messages Container -->
        <div class="messages-container" id="groupMessagesContainer">
          <!-- Group messages will be rendered here -->
        </div>

        <!-- Message Input -->
        <div class="message-input-area">
          <div class="message-input-wrapper">
            <button type="button" id="attachGroupMediaBtn" class="btn-icon attach-media-btn" title="Attach image or video">📎</button>
            <textarea id="groupMessageInput" placeholder="Type a message to group..." rows="1"></textarea>
            <button type="button" id="sendGroupMessageBtn" class="btn-send">➤</button>
          </div>
          <input type="file" id="groupMediaInput" accept="image/*,video/*" hidden>
        </div>
      </div>
    </div>
  </div>
</div>
```

---

### 3. Group Card Design

#### HTML Structure for Group Card
```html
<div class="group-card" data-group-id="abc123" data-category="business">
  <div class="group-avatar-wrapper">
    <div class="group-avatar">👥</div>
    <span class="unread-badge" style="display: none;">5</span>
    <span class="mute-indicator" style="display: none;">🔕</span>
  </div>

  <div class="group-info">
    <div class="group-header-row">
      <div class="group-name">Komunitas Pelanggan ABC</div>
      <div class="group-category-badge">💼 Business</div>
    </div>

    <div class="group-meta">
      <span class="participant-count">👤 156 members</span>
      <span class="last-message-time">10:30 AM</span>
    </div>

    <div class="last-message">
      <span class="sender-name">Alice:</span>
      <span class="message-preview">Promo diskon 50% untuk semua produk...</span>
    </div>
  </div>

  <div class="group-actions">
    <button class="btn-icon btn-mute" title="Mute/Unmute">🔕</button>
    <button class="btn-icon btn-more" title="More options">⋮</button>
  </div>
</div>
```

#### CSS Styling for Group Card
```css
.group-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
  border-left: 3px solid transparent;
}

.group-card:hover {
  background-color: var(--hover-bg);
}

.group-card.active {
  background-color: var(--active-bg);
  border-left-color: var(--primary);
}

.group-avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}

.group-avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
}

.unread-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  background: #ef4444;
  color: white;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 600;
}

.mute-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  font-size: 12px;
  background: var(--card-bg);
  border-radius: 50%;
}

.group-info {
  flex: 1;
  min-width: 0;
}

.group-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.group-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-category-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--tag-bg);
  color: var(--tag-text);
  flex-shrink: 0;
}

.group-meta {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}

.last-message {
  display: flex;
  gap: 4px;
  font-size: 13px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sender-name {
  font-weight: 600;
  color: var(--text);
  flex-shrink: 0;
}

.message-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
```

---

### 4. Group Message Bubble

#### HTML Structure for Group Message
```html
<div class="message incoming group-message" data-message-id="abc123">
  <div class="message-sender">
    <span class="sender-name">Alice Johnson</span>
    <span class="sender-avatar">A</span>
  </div>

  <div class="message-content-wrapper">
    <div class="message-content">
      Promo diskon 50% untuk semua produk hari ini saja!
    </div>
    <div class="message-media">
      <img src="/media/abc123.jpg" alt="Product image">
    </div>
  </div>

  <div class="message-meta">
    <span class="message-time">10:30 AM</span>
    <span class="message-status">✓✓</span>
  </div>
</div>

<div class="message outgoing group-message" data-message-id="def456">
  <div class="message-sender">
    <span class="sender-name">You</span>
    <span class="sender-avatar">Y</span>
  </div>

  <div class="message-content-wrapper">
    <div class="message-content">
      Info lengkapnya ada dimana ya?
    </div>
  </div>

  <div class="message-meta">
    <span class="message-time">10:31 AM</span>
    <span class="message-status">📤</span>
  </div>
</div>
```

#### CSS for Group Messages
```css
.message.group-message {
  max-width: 75%;
  margin-bottom: 16px;
}

.message.group-message .message-sender {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.message.group-message .sender-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.message.group-message .sender-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
}

.message.group-message.incoming {
  align-self: flex-start;
}

.message.group-message.incoming .sender-name {
  color: #6366f1;
}

.message.group-message.outgoing {
  align-self: flex-end;
}

.message.group-message.outgoing .message-sender {
  flex-direction: row-reverse;
}

.message.group-message.outgoing .sender-name {
  color: #8b5cf6;
}
```

---

### 5. Category Tabs Design

```html
<div class="category-tabs">
  <button class="category-tab active" data-category="all">
    <span class="tab-icon">📚</span>
    <span class="tab-label">All</span>
    <span class="tab-count">15</span>
  </button>
  <button class="category-tab" data-category="business">
    <span class="tab-icon">💼</span>
    <span class="tab-label">Business</span>
    <span class="tab-count">8</span>
  </button>
  <button class="category-tab" data-category="internal">
    <span class="tab-icon">👔</span>
    <span class="tab-label">Internal</span>
    <span class="tab-count">3</span>
  </button>
  <button class="category-tab" data-category="personal">
    <span class="tab-icon">🏠</span>
    <span class="tab-label">Personal</span>
    <span class="tab-count">4</span>
  </button>
</div>
```

```css
.category-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.category-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  flex-shrink: 0;
}

.category-tab:hover {
  background: var(--hover-bg);
  color: var(--text);
}

.category-tab.active {
  background: var(--primary);
  color: white;
}

.tab-icon {
  font-size: 16px;
}

.tab-label {
  font-size: 13px;
  font-weight: 500;
}

.tab-count {
  font-size: 11px;
  background: rgba(0, 0, 0, 0.2);
  padding: 2px 6px;
  border-radius: 10px;
}
```

---

## 📁 File Structure Changes

### New Files to Create
```
public/
├── js/
│   └── groups.js          (NEW - Groups logic)
```

### Files to Update
```
public/
├── index.html             (UPDATE - Add groups view & menu)
├── css/
│   └── style.css          (UPDATE - Add groups styles)
└── js/
    ├── state.js           (UPDATE - Add groups state)
    ├── navigation.js      (UPDATE - Add groups route)
    └── app.js             (UPDATE - Initialize groups)
```

---

## 🔧 Backend API Endpoints

### Groups Management
```javascript
// Get all groups
GET /api/groups?sessionId=x&category=business
Response: {
  groups: [{
    id: 123,
    groupId: "abc123@g.us",
    subject: "Komunitas Pelanggan",
    participantCount: 156,
    category: "business",
    lastMessage: {
      content: "Promo diskon...",
      senderName: "Alice",
      timestamp: "2025-01-17T10:30:00Z"
    },
    unreadCount: 5,
    isMuted: false
  }]
}

// Get group details
GET /api/groups/:id
Response: {
  group: {
    id: 123,
    groupId: "abc123@g.us",
    subject: "Komunitas Pelanggan",
    description: "Group untuk komunitas...",
    participantCount: 156,
    ownerId: "6281234567890@s.whatsapp.net",
    createdAt: "2024-01-01T00:00:00Z",
    category: "business"
  },
  participants: [{
    jid: "6281234567890@s.whatsapp.net",
    name: "Alice Johnson",
    isAdmin: true
  }]
}

// Update group category
PATCH /api/groups/:id/category
Request: { category: "business" }
Response: { success: true }

// Leave group
POST /api/groups/:id/leave
Response: { success: true }
```

### Group Messages
```javascript
// Get group messages
GET /api/groups/:id/messages?sessionId=x&limit=50
Response: {
  messages: [{
    id: 123,
    messageId: "abc123",
    content: "Hello everyone!",
    senderName: "Alice Johnson",
    senderJid: "6281234567890@s.whatsapp.net",
    timestamp: "2025-01-17T10:30:00Z",
    direction: "incoming",
    type: "text"
  }]
}

// Send message to group
POST /api/groups/:id/messages
Request: {
  sessionId: "alhikmah",
  content: "Hello group!",
  type: "text",
  media: null
}
Response: {
  success: true,
  message: { id, content, timestamp }
}

// Sync group history
POST /api/groups/:id/sync-history
Request: { sessionId: "alhikmah" }
Response: {
  success: true,
  synced: 45,
  total: 50
}
```

---

## 🗄️ Database Schema

### Update `contacts` Table
```sql
ALTER TABLE contacts
  ADD COLUMN is_group BOOLEAN DEFAULT FALSE AFTER is_blocked,
  ADD COLUMN group_subject VARCHAR(255) NULL AFTER is_group,
  ADD INDEX idx_is_group (is_group);

-- Notes:
// - is_group: flag untuk membedakan private vs group
// - group_subject: nama grup (hanya untuk group)
```

### New `whatsapp_groups` Table
```sql
CREATE TABLE whatsapp_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(100) NOT NULL UNIQUE,  -- JID tanpa @g.us
  subject VARCHAR(255),
  description TEXT,
  profile_pic_url TEXT,
  owner_jid VARCHAR(255),
  participant_count INT DEFAULT 0,
  is_broadcast BOOLEAN DEFAULT FALSE,
  category ENUM('business', 'internal', 'personal') DEFAULT 'business',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_interaction_at TIMESTAMP NULL,
  INDEX idx_session_group (session_id, group_id),
  INDEX idx_session_category (session_id, category),
  INDEX idx_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### New `group_participants` Table
```sql
CREATE TABLE group_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  participant_jid VARCHAR(255) NOT NULL,
  participant_name VARCHAR(255),
  is_admin BOOLEAN DEFAULT FALSE,
  is_superadmin BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  INDEX idx_group_id (group_id),
  INDEX idx_participant_jid (participant_jid),
  UNIQUE KEY unique_participant (group_id, participant_jid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Update `messages` Table
```sql
ALTER TABLE messages
  ADD COLUMN is_group_message BOOLEAN DEFAULT FALSE,
  ADD COLUMN group_id INT NULL,
  ADD COLUMN participant_jid VARCHAR(255) NULL,
  ADD COLUMN participant_name VARCHAR(255) NULL,
  ADD FOREIGN KEY (group_id) REFERENCES whatsapp_groups(id) ON DELETE SET NULL,
  ADD INDEX idx_is_group_message (is_group_message),
  ADD INDEX idx_group_id (group_id);
```

---

## 🚀 Implementation Phases

### Phase 1: UI Foundation (Week 1)
**Objective:** Create UI structure for Groups

#### Tasks:
- [ ] Add "Groups" menu item to navigation
- [ ] Create `#view-groups` HTML structure
- [ ] Implement category tabs component
- [ ] Design group card component
- [ ] Design group chat window
- [ ] Design group message bubble with sender name

#### Deliverables:
- ✅ Groups view visible in navigation
- ✅ Category tabs working (switch active state)
- ✅ Group cards displaying with mock data
- ✅ Group chat window with welcome state

---

### Phase 2: Backend - Database & Basic API (Week 1-2)
**Objective:** Prepare database and basic API endpoints

#### Tasks:
- [ ] Update database schema (migrations)
- [ ] Create `groupHandlers.js` file
- [ ] Remove `@g.us` filter from `chatHandlers.js`
- [ ] Implement `upsertGroup()` function
- [ ] Implement `syncGroupParticipants()` function
- [ ] Implement `getGroupsByCategory()` function
- [ ] Create API endpoints: GET /api/groups, GET /api/groups/:id
- [ ] Handle incoming group messages (store to DB)

#### Deliverables:
- ✅ Database tables created
- ✅ API endpoints working
- ✅ Group messages stored in database

---

### Phase 3: Frontend - Fetch & Display (Week 2)
**Objective:** Connect UI with backend

#### Tasks:
- [ ] Create `js/groups.js` file
- [ ] Implement `fetchGroups()` function
- [ ] Implement `renderGroupsList()` function
- [ ] Implement category filtering logic
- [ ] Implement group search functionality
- [ ] Implement Socket.io listeners for group events
- [ ] Display unread count badge
- [ ] Handle group selection (open chat)

#### Deliverables:
- ✅ Groups loaded from API
- ✅ Category tabs filtering works
- ✅ Search working
- ✅ Real-time updates via Socket.io

---

### Phase 4: Group Messaging (Week 2-3)
**Objective:** Send/receive group messages

#### Tasks:
- [ ] Implement `fetchGroupMessages()` function
- [ ] Implement `renderGroupMessages()` function
- [ ] Display sender name for each message
- [ ] Implement `sendGroupMessage()` function
- [ ] Handle media upload for groups
- [ ] Auto-scroll to latest message
- [ ] Message status indicators

#### Deliverables:
- ✅ Can view group message history
- ✅ Can send message to group
- ✅ Can send media to group
- ✅ Real-time incoming group messages

---

### Phase 5: Advanced Features (Week 3-4)
**Objective:** Enhance group functionality

#### Tasks:
- [ ] Participant list modal
- [ ] Group metadata sync (subject, description)
- [ ] Mute/unmute group notifications
- [ ] Update group category
- [ ] Leave group functionality
- [ ] Group settings modal

#### Deliverables:
- ✅ Full group management working
- ✅ User can manage group preferences

---

## 📊 UI Mockups

### Groups List View
```
┌─────────────────────────────────────────────────────────┐
│ 👥 Groups                              [Session: ▼]       │
├─────────────────────────────────────────────────────────┤
│ 🔍 Search groups...                                    │
├─────────────────────────────────────────────────────────┤
│ [📚 All 15] [💼 Business 8] [👔 Internal 3] [🏠 Personal 4] │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 👥💬                       📵  ⋮                   │ │
│ │ Komunitas Pelanggan ABC      💼 Business           │ │
│ │ 👤 156 members • 10:30 AM                         │ │
│ │ Alice: Promo diskon 50% untuk semua...             │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 👥    5                    ⋮                        │ │
│ │ Tim Sales                 👔 Internal               │ │
│ │ 👤 12 members • 09:15 AM                          │ │
│ │ Boss: Target bulan ini...                          │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 👥                         🔕  ⋮                   │ │
│ │ Family Group              🏠 Personal               │ │
│ │ 👤 8 members • Yesterday                           │ │
│ │ Mom: Jangan lupa makan siang                        │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Group Chat View
```
┌─────────────────────────────────────────────────────────┐
│ 👥 Komunitas Pelanggan ABC          [👥 Participants ⋮] │
│ 👤 156 members • 💼 Business                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Alice Johnson                        [A]  10:30 AM     │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Promo diskon 50% untuk semua produk hari ini       │ │
│ │ saja! Jangan sampai terlewat...                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ [Product Image]                                        │
│                                                         │
│ Bob Smith                             [B]  10:31 AM     │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Wah menarik, info lengkapnya ada dimana ya?         │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ You                                   [Y]  10:32 AM     │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Cek di catalog ya kak, semua produk ada detailnya  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│                                                         │
│ ┌───────────────────────┬─────────────────────────────┐ │
│ │ 📎   [Type message...]  [➤]                         │ │
│ └───────────────────────┴─────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Participants Modal
```
┌─────────────────────────────────────────────────────────┐
│ 👥 Group Participants                      [✕]        │
│ Komunitas Pelanggan ABC • 156 members                  │
├─────────────────────────────────────────────────────────┤
│ 🔍 Search participants...                               │
│                                                         │
│ 👑 Admins (2)                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 👤 6281234567890     👑 Admin                      │ │
│ │ Alice Johnson                                       │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 👤 6289876543210     👑 Admin                      │ │
│ │ Bob Smith                                          │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 👥 Members (154)                                       │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 👤 6285555555555                                  │ │
│ │ Carol Davis                                        │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 👤 6287777777777                                  │ │
│ │ David Wilson                                       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│                                    [Load more...]       │
└─────────────────────────────────────────────────────────┘
```

---

## ⚠️ Important Considerations

### 1. Group vs Private Chat Distinction
- **Private Chat (Contacts menu):** CRM focused, lead management, one-to-one
- **Group Chat (Groups menu):** Communication focused, multi-participant

### 2. Auto-Categorization Strategy
Option A: **Manual tagging by user** (Simple, recommended for Phase 1)
- User manually set category via settings
- Default: "business"

Option B: **Auto-detect based on composition** (Advanced)
- If owner + all admins = internal team → "internal"
- If has customer keywords → "business"
- If has family keywords → "personal"

### 3. What Groups Need CRM Features?
**Business Groups:**
- ✅ Notes (important discussions)
- ✅ Tags (VIP customers, hot prospects)
- ❌ Lead status (group bukan lead)
- ❌ Pipeline (group bukan sales stage)

**Internal/Personal Groups:**
- ❌ No CRM features
- Pure communication only

### 4. Performance Considerations
- Groups can have many participants (500+)
- Participant list should be paginated
- Message history should be lazy loaded
- Consider caching group metadata

---

## ✅ Checklist Before Implementation

### UI/UX
- [ ] Group category colors defined
- [ ] Avatar placeholder for groups defined
- [ ] Empty state design approved
- [ ] Loading state design approved
- [ ] Error state design approved

### Backend
- [ ] Database schema reviewed
- [ ] API endpoints approved
- [ ] Socket.io events defined
- [ ] Error handling strategy defined

### Data Flow
- [ ] How group metadata is synced from WhatsApp?
- [ ] How participant changes are detected?
- [ ] How to handle group name changes?
- [ ] How to handle participant left/joined events?

---

## 📞 Questions for Review

1. **Category Auto-Detection:**
   - Should groups be auto-categorized or manual?
   - What rules for auto-detection?

2. **CRM Features for Groups:**
   - Do business groups need notes/tags?
   - Or pure communication only?

3. **Group Actions:**
   - Can users create new groups from UI?
   - Can users add/remove participants?
   - Or read-only access?

4. **Personal Groups:**
   - Should personal groups be hidden by default?
   - Or shown but separated?

5. **Priority:**
   - Is Phase 1-5 prioritization correct?
   - Any feature should be added/removed?

---

**Status: 📝 PLANNING - AWAITING CONFIRMATION**

**Next Step:** Once approved, proceed with Phase 1 implementation
