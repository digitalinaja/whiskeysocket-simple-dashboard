# Integrasi Student Database dengan WhatsApp CRM Dashboard

## Overview

Mengintegrasikan **Student Database App** dengan **WhatsApp CRM Dashboard** untuk menghubungkan kontak orangtua dengan data siswa (kelas, asrama, info lengkap).

**Metode:** Periodic Sync (Cron Job) - API read-only
**Priority:** Student Database Linking (Phase 1)

---

## Arsitektur Integrasi

```
┌─────────────────────────────────────────────────────────────────┐
│                  WhatsApp CRM Dashboard                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Contacts   │  │   Activities │  │  WhatsApp Groups     │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────────┘  │
│         │                                                     │
│         │ linked to                                          │
│         ↓                                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Student Cache Layer                         │  │
│  │  - students_cache table (local cache)                    │  │
│  │  - contact_group_links (auto-linking)                    │  │
│  └──────────────────────┬──────────────────────────────────┘  │
└─────────────────────────┼─────────────────────────────────────┘
                          │
                          │ Periodic API Call (Cron every 6 hours)
                          ↓
                  ┌───────────────┐
                  │ Student DB    │
                  │ App (External)│
                  └───────────────┘
```

---

## Alur Kerja Integrasi

### 1. Initial Sync (One-time)
```
Cron Job (every 6 hours)
    ↓
Fetch all students from Student DB API
    ↓
Batch insert/update to students_cache table
    ↓
Match parent phone numbers with existing contacts
    ↓
Auto-link contacts to students
    ↓
Auto-link contacts to relevant WA groups (by class/dormitory)
```

### 2. Ongoing Sync
```
Scheduled: Every 6 hours (configurable)
    ↓
GET /api/students?updated_since={last_sync}
    ↓
Update students_cache with changed records
    ↓
Re-link contacts if student info changed
```

---

## Database Schema

### New Tables

**students_cache** (cache dari Student DB App):
```sql
CREATE TABLE students_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  external_student_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  nis VARCHAR(50) COMMENT 'Nomor Induk Siswa',
  class VARCHAR(50) COMMENT 'Kelas: 10A, 11B, etc',
  dormitory VARCHAR(50) COMMENT 'Asrama: Putri 1, Putra 2, etc',
  dormitory_room VARCHAR(20) COMMENT 'Kamar asrama',
  academic_year VARCHAR(20) COMMENT '2024/2025',
  parent_name VARCHAR(255),
  parent_phone VARCHAR(20),
  parent_email VARCHAR(100),
  parent_address TEXT,
  enrollment_status ENUM('active', 'alumni', 'transferred') DEFAULT 'active',
  raw_data JSON COMMENT 'Full data dari external API',

  -- Sync tracking
  last_sync_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY unique_session_student (session_id, external_student_id),
  INDEX idx_session (session_id),
  INDEX idx_external_student_id (external_student_id),
  INDEX idx_parent_phone (parent_phone),
  INDEX idx_class (class),
  INDEX idx_dormitory (dormitory),
  INDEX idx_academic_year (academic_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**contact_group_links** (hubungan contact dengan WA groups):
```sql
CREATE TABLE contact_group_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  contact_id INT NOT NULL,
  group_id INT NOT NULL,

  -- Link type & metadata
  link_type ENUM('class', 'dormitory', 'manual', 'auto') DEFAULT 'manual',
  link_reason VARCHAR(255) COMMENT 'Alasa linking: Siswa dian, Kelas 10A',

  -- Student reference
  student_external_id VARCHAR(100) COMMENT 'ID siswa yang trigger linking',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(100) DEFAULT 'system',

  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  UNIQUE KEY unique_contact_group (session_id, contact_id, group_id),
  INDEX idx_session (session_id),
  INDEX idx_contact (contact_id),
  INDEX idx_group (group_id),
  INDEX idx_link_type (link_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Modify Existing Tables

**contacts** - add student linking fields:
```sql
ALTER TABLE contacts
ADD COLUMN cached_student_ids JSON NULL COMMENT 'Array of student IDs from cache' AFTER external_student_ids,
ADD COLUMN student_data_source ENUM('student_db_app', 'manual') DEFAULT 'student_db_app' AFTER cached_student_ids,
ADD COLUMN last_student_sync_at TIMESTAMP NULL COMMENT 'Terakhir sync data student' AFTER student_data_source;
```

---

## Files to Create

### Backend (7 files)

**1. src/studentDbClient.js**
```javascript
// API Client untuk Student DB App
// - Fetch students (with pagination)
// - Fetch by external_id
// - Search by phone/name
// - Retry logic & error handling
// - Response caching
```

**2. src/studentDbSync.js**
```javascript
// Sync Service dengan Cron Job
// - Full sync (initial)
// - Incremental sync (updated_since)
// - Batch processing (100 students per batch)
// - Link contacts to students
// - Auto-link to groups
// - Error logging & recovery
```

**3. src/studentDbRoutes.js**
```javascript
// API Endpoints
// - GET /api/student-cache - list cached students
// - GET /api/student-cache/:id - get student detail
// - POST /api/student-cache/sync - trigger manual sync
// - POST /api/student-cache/link - manual link contact to student
// - DELETE /api/student-cache/:contactId - unlink student
```

**4. src/groupLinkingService.js**
```javascript
// Auto-Linking Service
// - Match student class/dormitory to WA groups
// - Auto create contact_group_links
// - Pattern matching: "Kelas 10A", "Asrama Putri 1"
// - Manual link/unlink
```

**5. src/contactStudentService.js**
```javascript
// Contact-Student Relationship Service
// - Link contact to student(s)
// - Unlink contact from student
// - Get all students for a contact (siblings)
// - Match contacts by phone number
```

**6. public/js/studentLinking.js**
```javascript
// Frontend: Student Linking UI
// - Student search & selection modal
// - Display linked students in contact view
// - Link/unlink actions
// - Student detail view
```

**7. scripts/migrations/004-add-student-integration.js**
```javascript
// Database Migration
// - Create students_cache table
// - Create contact_group_links table
// - Modify contacts table
// - Backfill existing data if needed
```

---

## Files to Modify

### Backend

**1. src/schemaDefinitions.js**
- Add `students_cache` table definition
- Add `contact_group_links` table definition
- Modify `contacts` table with new fields

**2. src/index.js**
- Register `studentDbRoutes`
- Setup cron job for student sync (every 6 hours)
- Initialize sync on startup if never synced

**3. src/crmRoutes.js**
- Add student info to contact detail response:
  ```javascript
  {
    ...contact,
    students: [{ id, name, class, dormitory }],
    linked_groups: [{ id, name, link_type }],
  }
  ```

**4. src/chatHandlers.js**
- Auto-detect student when new chat arrives:
  ```javascript
  // When receiving message from new number
  // 1. Check if phone matches any parent_phone in students_cache
  // 2. If match, auto-link contact to student
  // 3. Auto-link to relevant groups
  ```

### Frontend

**5. public/index.html**
- Add navigation item: "Student Database"
- Add modal templates for student linking

**6. public/js/crm.js**
- Display student info in contact view
- Add student linking button
- Show linked groups
- Quick action: "Message Class Group", "Message Dormitory Group"

**7. public/js/app.js**
- Register `studentLinking` module
- Add student cache refresh interval

---

## Environment Variables

Add to `.env`:
```env
# Student Database Integration
STUDENT_DB_API_URL=http://localhost:3001/api
STUDENT_DB_API_KEY=your_api_key_here
STUDENT_DB_API_TIMEOUT=30000
STUDENT_DB_SYNC_ENABLED=true
STUDENT_DB_SYNC_INTERVAL_HOURS=6
STUDENT_DB_BATCH_SIZE=100

# Group Linking
GROUP_AUTO_LINKING_ENABLED=true
GROUP_NAME_CLASS_PREFIX=Kelas
GROUP_NAME_DORMITORY_PREFIX=Asrama
GROUP_AUTO_LINK_NEW_CHATS=true
```

---

## API Specification (Expected from Student DB App)

### Required Endpoints

**1. Get All Students (paginated)**
```
GET /api/students
Query Params:
  - page: number (default 1)
  - limit: number (default 100)
  - updated_since: ISO date (optional, for incremental sync)

Response:
{
  "success": true,
  "data": [
    {
      "id": "STU001",
      "name": "Ahmad Dahlan",
      "nis": "2024001",
      "class": "10A",
      "dormitory": "Putra 1",
      "dormitory_room": "101",
      "academic_year": "2024/2025",
      "status": "active",
      "parent_name": "Bpk. Dahlan",
      "parent_phone": "+6281234567890",
      "parent_email": "dahlan@example.com",
      "parent_address": "Jl. Contoh No. 1",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-02-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 1500,
    "total_pages": 15
  }
}
```

**2. Get Student by ID**
```
GET /api/students/:id

Response:
{
  "success": true,
  "data": { /* student object */ }
}
```

**3. Search Students**
```
GET /api/students/search
Query Params:
  - q: search query (name, phone, nis)
  - academic_year: filter by year

Response:
{
  "success": true,
  "data": [ /* students array */ ]
}
```

### Authentication
- API Key in header: `X-API-Key: {your_key}`
- OR Bearer token: `Authorization: Bearer {token}`

---

## Implementation Steps

### Step 1: Database Migration
```bash
# Create migration script
node scripts/migrations/004-add-student-integration.js

# Run migration
npm run db:migrate

# Verify schema
npm run db:validate
```

### Step 2: Backend Implementation

**Priority 1: Core Sync Engine**
1. Create `studentDbClient.js` with API client
2. Create `studentDbSync.js` with sync logic
3. Test sync with manual trigger
4. Add cron job to `index.js`

**Priority 2: Linking Logic**
5. Create `contactStudentService.js`
6. Create `groupLinkingService.js`
7. Test auto-linking with existing contacts

**Priority 3: API Endpoints**
8. Create `studentDbRoutes.js`
9. Test all endpoints with Postman/curl

### Step 3: Frontend Implementation

**Priority 1: Contact View Enhancement**
10. Modify `crm.js` to display student info
11. Add student linking button
12. Show linked groups

**Priority 2: Student Management UI**
13. Create `studentLinking.js`
14. Add student search modal
15. Add student detail view

### Step 4: Integration Testing
16. Full sync test (1500+ students)
17. Auto-linking test
18. Group linking test
19. Performance test (sync time)

---

## UI Mockups

### Contact View Enhancement

```
┌──────────────────────────────────────────────────────────┐
│  Ibu Siti Aminah                                         │
│  +6281234567890 • student_parent                         │
├──────────────────────────────────────────────────────────┤
│  👥 Linked Students                                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 1. Ahmad Dahlan                                  │    │
│  │    NIS: 2024001 • Kelas 10A • Asrama Putra 1    │    │
│  │    [View Details] [Unlink]                       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  📱 Linked Groups                                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 📘 Kelas 10A (auto: class)                       │    │
│  │ 🏠 Asrama Putra 1 (auto: dormitory)              │    │
│  │ + Add Group                                     │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  [💬 Message Class Group] [💬 Message Dormitory Group]   │
└──────────────────────────────────────────────────────────┘
```

### Student Search Modal

```
┌──────────────────────────────────────────────────────────┐
│  🔍 Link Student to Contact                              │
├──────────────────────────────────────────────────────────┤
│  Search: [________________] Search                       │
│  Filter: [Academic Year ▼] [Class ▼]                    │
├──────────────────────────────────────────────────────────┤
│  Result (156 students found)                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ☐ Ahmad Dahlan - 10A - Asrama Putra 1          │    │
│  │ ☐ Aisyah Putri - 10B - Asrama Putri 2          │    │
│  │ ☐ Budi Santoso - 11A - Asrama Putra 1          │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  [Link Selected] [Cancel]                                │
└──────────────────────────────────────────────────────────┘
```

---

## Verification Steps

Setelah implementasi selesai:

### Database & Sync
- [ ] `students_cache` table created successfully
- [ ] `contact_group_links` table created successfully
- [ ] Initial sync runs and populates cache
- [ ] Cron job runs every 6 hours
- [ ] Incremental sync only fetches updated records

### Student Linking
- [ ] Can search students by name/NIS/phone
- [ ] Can link contact to single student
- [ ] Can link contact to multiple students (siblings)
- [ ] Linked students display in contact view
- [ ] Student data shows: name, class, dormitory, parent info

### Group Auto-Linking
- [ ] Contacts auto-link to class group based on student's class
- [ ] Contacts auto-link to dormitory group based on student's dormitory
- [ ] Manual add/remove group links works
- [ ] Linked groups display with link type (class/dormitory/manual)

### Contact Auto-Detection
- [ ] New chat from parent phone auto-links to existing student
- [ ] Auto-creates group links for detected contacts
- [ ] Works for multiple parents (father + mother numbers)

### Performance
- [ ] Sync 1000 students takes < 2 minutes
- [ ] Contact view loads < 500ms with student data
- [ ] Student search responds < 300ms
- [ ] API calls to Student DB App respect rate limits

### Error Handling
- [ ] API failures log properly
- [ ] Sync retries on failure
- [ ] Invalid data rejected with clear error
- [ ] Partial sync doesn't break existing data

---

## Testing Strategy

### Manual Testing Checklist

**Sync Engine:**
```bash
# 1. Test manual sync trigger
POST /api/student-cache/sync
# Check logs for sync progress
# Verify students_cache table populated

# 2. Test incremental sync
# Update student in external system
# Wait for cron or trigger sync
# Verify cache updated

# 3. Test error handling
# Stop Student DB API
# Trigger sync
# Verify proper error logged
```

**Student Linking:**
```bash
# 1. Create new contact
POST /api/contacts
{ "name": "Test Parent", "phone": "+628111111111" }

# 2. Link to student
POST /api/student-cache/link
{ "contact_id": 123, "student_external_id": "STU001" }

# 3. Verify link
GET /api/contacts/123
# Check: students array populated

# 4. Unlink
DELETE /api/student-cache/123
# Check: students array empty
```

**Group Auto-Linking:**
```bash
# 1. Create contact with linked student
# 2. Trigger group linking
POST /api/student-cache/link-groups/:contact_id

# 3. Verify
GET /api/contact-group-links?contact_id=123
# Check: class and dormitory groups linked
```

### Test Data Setup

Create test students in Student DB App:
```javascript
[
  { id: "TEST001", name: "Test Siswa 1", class: "10A", dormitory: "Putra 1", parent_phone: "+628111111111" },
  { id: "TEST002", name: "Test Siswa 2", class: "10B", dormitory: "Putri 1", parent_phone: "+628222222222" },
  { id: "TEST003", name: "Test Sibling 1", class: "11A", dormitory: "Putra 2", parent_phone: "+628333333333" },
  { id: "TEST004", name: "Test Sibling 2", class: "9A", dormitory: null, parent_phone: "+628333333333" }, // Same parent
]
```

---

## Troubleshooting

### Common Issues

**1. Sync not running:**
```bash
# Check cron configuration
# Check STUDENT_DB_SYNC_ENABLED=true
# Check logs: tail -f logs/sync.log
```

**2. API connection failed:**
```bash
# Check STUDENT_DB_API_URL correct
# Check API key valid
# Test: curl -H "X-API-Key: xxx" {STUDENT_DB_API_URL}/students
```

**3. Group auto-linking not working:**
```bash
# Check GROUP_AUTO_LINKING_ENABLED=true
# Check group names match pattern
# Verify group exists in whatsapp_groups table
```

**4. Student data not showing:**
```bash
# Check students_cache populated
# Check contact.cached_student_ids not null
# Check join query in crmRoutes.js
```

---

## Future Enhancements (Phase 2+)

1. **Ticket System Integration** - Link ticket history to contacts
2. **Payment Integration** - Show payment status, send reminders
3. **Broadcast by Class/Dormitory** - Send announcement to specific groups
4. **Analytics Dashboard** - Student engagement metrics
5. **Parent Portal** - Allow parents to view their children's info