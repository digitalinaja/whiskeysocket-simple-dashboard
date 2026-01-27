# SSO Integration Guide - Whiskeysocket CRM

## 📋 Overview

**SSO Integration** adalah fitur untuk mengintegrasikan CRM dengan sistem SSO sekolah yang sudah ada. Ini memungkinkan:

1. **Sync data orang tua, guru, dan siswa** dari SSO ke CRM
2. **Display informasi SSO** di contact profile (user type, linked students, dll)
3. **Student-aware messaging** - tag pesan dengan student ID
4. **Communication analytics** - berdasarkan SSO data

---

## 🔌 **API Endpoints**

### **1. Test SSO Connection**
```http
GET /api/sso/test-connection
```

**Response:**
```json
{
  "success": true,
  "status": 200,
  "message": "SSO API connection successful"
}
```

---

### **2. Search Contact in SSO**
```http
POST /api/sso/search-contact
Content-Type: application/json

{
  "phone": "08123456789"
}
```

**Response (Found - Single Role):**
```json
{
  "found": true,
  "data": {
    "sso_id": "2804",
    "sso_type": "ortu",
    "sso_name": "Akun Ortu",
    "student_ids": ["8440"],
    "student_count": 1,
    "sso_roles": [],
    "raw_sso_data": { ... }
  }
}
```

**Response (Found - Dual Role):**
```json
{
  "found": true,
  "data": {
    "sso_id": "685",
    "sso_type": "pegawai,admin,guru,ortu",
    "sso_name": "Ahmad Alimuddin",
    "student_ids": ["9491", "9492", "9493", "9494", "9495"],
    "student_count": 5,
    "sso_roles": ["Administrator", "Guru / Pegawai", "Pengurus", "Direksi"],
    "raw_sso_data": { ... }
  }
}
```

**Response (Not Found):**
```json
{
  "found": false,
  "data": null
}
```

---

### **3. Sync Contact with SSO**
```http
POST /api/sso/sync-contact
Content-Type: application/json

{
  "sessionId": "default",
  "contactId": 123
}
```

**Response (User Found - Dual Role):**
```json
{
  "success": true,
  "found": true,
  "message": "Successfully synced with SSO",
  "contact": {
    "id": 123,
    "phone": "08388105401",
    "name": "Ahmad Alimuddin",
    "sso_id": "685",
    "sso_type": "pegawai,admin,guru,ortu",
    "student_ids": ["9491", "9492", "9493", "9494", "9495"],
    "student_count": 5,
    "sso_roles": ["Administrator", "Guru / Pegawai", "Pengurus"],
    "last_synced_sso_at": "2026-01-27T10:30:00.000Z"
  }
}
```

**Response (User Found - Parent Only):**
```json
{
  "success": true,
  "found": true,
  "message": "Successfully synced with SSO",
  "contact": {
    "id": 456,
    "phone": "081510281837",
    "name": "Akun Ortu",
    "sso_id": "2804",
    "sso_type": "ortu",
    "student_ids": ["8440"],
    "student_count": 1,
    "sso_roles": [],
    "last_synced_sso_at": "2026-01-27T10:30:00.000Z"
  }
}
```

**Response (User Not Found):**
```json
{
  "success": true,
  "found": false,
  "message": "User not found in SSO system",
  "contact": {
    "id": 789,
    "phone": "08123456789",
    "sso_id": null,
    "sso_type": null,
    "student_ids": null,
    "sso_roles": null
  }
}
```

---

### **4. Batch Sync Contacts**
```http
POST /api/sso/batch-sync
Content-Type: application/json

{
  "sessionId": "default",
  "contactIds": [1, 2, 3, 4, 5]
}
```

**Response:**
```json
{
  "total": 5,
  "synced": 3,
  "not_found": 2,
  "failed": 0,
  "contacts": [
    { "success": true, "found": true, ... },
    { "success": true, "found": false, ... },
    ...
  ]
}
```

---

### **5. Get Student Details**
```http
GET /api/sso/student-details?student_ids=9491,9492,9493
```

**Response:**
```json
{
  "students": [
    {
      "id": "9491",
      "name": "Ahmad Alimuddin",
      "class": "X-A",
      "status": "Active"
    }
  ]
}
```

---

### **6. Get SSO Sync Status**
```http
GET /api/sso/sync-status/:contactId?sessionId=default
```

**Response (Dual-Role User):**
```json
{
  "contact_id": 123,
  "phone": "08388105401",
  "is_synced": true,
  "sso_id": "685",
  "sso_type": "pegawai,admin,guru,ortu",
  "student_ids": ["9491", "9492", "9493", "9494", "9495"],
  "student_count": 5,
  "sso_roles": ["Administrator", "Guru / Pegawai", "Pengurus"],
  "last_synced_at": "2026-01-27T10:30:00.000Z",
  "needs_sync": false
}
```

**Response (Parent Only):**
```json
{
  "contact_id": 456,
  "phone": "081510281837",
  "is_synced": true,
  "sso_id": "2804",
  "sso_type": "ortu",
  "student_ids": ["8440"],
  "student_count": 1,
  "sso_roles": [],
  "last_synced_at": "2026-01-27T10:30:00.000Z",
  "needs_sync": false
}
```

**Response (Not Synced):**
```json
{
  "contact_id": 789,
  "phone": "08123456789",
  "is_synced": false,
  "sso_id": null,
  "sso_type": null,
  "student_ids": null,
  "student_count": 0,
  "sso_roles": null,
  "last_synced_at": null,
  "needs_sync": true
}
```

---

## 🗄️ **Database Schema**

### **Columns Added to `contacts` table:**

```sql
ALTER TABLE contacts
ADD COLUMN sso_id VARCHAR(50) NULL,
ADD COLUMN sso_type VARCHAR(255) NULL COMMENT 'Comma-separated types: guru,ortu,pegawai,admin,siswa,lainnya',
ADD COLUMN sso_acl JSON NULL COMMENT 'Access control list from SSO {pegawai: [], ortu: []}',
ADD COLUMN student_ids JSON NULL COMMENT 'Array of student IDs from SSO',
ADD COLUMN sso_roles JSON NULL COMMENT 'Array of role names for pegawai (if applicable)',
ADD COLUMN last_synced_sso_at TIMESTAMP NULL,
ADD INDEX idx_sso_id (sso_id),
ADD INDEX idx_sso_type (sso_type);
```

### **SSO User Types:**

User can have **multiple types simultaneously** (stored as comma-separated values):

| Type | Label | Description | Detection Logic |
|------|-------|-------------|-----------------|
| `pegawai` | Pegawai (Staff) | School staff/teacher | `acl.pegawai` exists AND not empty |
| `ortu` | Orang Tua (Parent) | Parent/guardian | `acl.ortu` exists AND not empty |
| `admin` | Administrator | School admin | `acl.pegawai` contains "Administrator" |
| `guru` | Guru (Teacher) | Teacher/educator | `acl.pegawai` contains "Guru / Pegawai" |
| `siswa` | Siswa (Student) | Student | Direct type = "siswa" |
| `lainnya` | Lainnya (Other) | Other types | Fallback for unmapped types |

**Important Notes:**
- User can be **BOTH pegawai AND ortu** (e.g., a teacher who is also a parent)
- `acl.pegawai` = Array of **role names** (strings): ["Administrator", "Guru / Pegawai", "Direksi", etc]
- `acl.ortu` = Array of **student IDs** (strings): ["9491", "9492", "9493"]
- The `type` field from SSO is not always reliable; use ACL to determine actual roles

---

## ⚙️ **Environment Configuration**

Add to your `.env` file:

```env
# ============================================
# SCHOOL SSO INTEGRATION
# ============================================

# SSO API Base URL
SSO_API_BASE_URL=https://sso-sekolah-api.example.com/api

# SSO API Key for authentication
SSO_API_KEY=your-sso-api-key-here

# SSO API Request Timeout (milliseconds)
SSO_API_TIMEOUT=30000
```

---

## 🎨 **UI Components**

### **Contact Profile Modal - SSO Section**

#### **When Synced (Single Role - Parent Only):**
```
┌─────────────────────────────────────┐
│ SSO Integration              ✓ Synced │
├─────────────────────────────────────┤
│ SSO ID:           2804              │
│ User Type:        🎓 Orang Tua      │
│ Linked Students:  1 student(s)      │
│   ┌─ 8440              [View]      │
│   └─                                 │
│ Last Synced:     Jan 27, 2026       │
└─────────────────────────────────────┘
```

#### **When Synced (Dual-Role - Teacher + Parent):**
```
┌─────────────────────────────────────┐
│ SSO Integration              ✓ Synced │
├─────────────────────────────────────┤
│ SSO ID:           685               │
│ User Type:        👔 Pegawai 🎓 Orang Tua │
│ Roles:            Administrator, Guru / Pegawai │
│ Linked Students:  5 student(s)      │
│   ┌─ 9491              [View]      │
│   ├─ 9492              [View]      │
│   ├─ 9493              [View]      │
│   ├─ 9494              [View]      │
│   └─ 9495              [View]      │
│ Last Synced:     Jan 27, 2026       │
└─────────────────────────────────────┘
```

#### **When Synced (Multi-Child Parent):**
```
┌─────────────────────────────────────┐
│ SSO Integration              ✓ Synced │
├─────────────────────────────────────┤
│ SSO ID:           2806              │
│ User Type:        🎓 Orang Tua      │
│ Linked Students:  3 student(s)      │
│   ┌─ 6931              [View]      │
│   ├─ 8864              [View]      │
│   └─ 8764              [View]      │
│ Last Synced:     Jan 27, 2026       │
└─────────────────────────────────────┘
```

#### **When Not Synced:**
```
┌─────────────────────────────────────┐
│ SSO Integration         Not Synced   │
├─────────────────────────────────────┤
│ This contact is not synced with the │
│ school SSO system.                  │
│                                     │
│     [🔄 Sync with SSO]              │
└─────────────────────────────────────┘
```

---

### **UI Badge Display Logic**

**User Type Badges:**
```javascript
function getTypeBadges(sso_type) {
  const types = sso_type.split(',');
  const badges = types.map(type => {
    const config = {
      'pegawai': { icon: '👔', label: 'Pegawai', color: 'blue' },
      'guru': { icon: '📚', label: 'Guru', color: 'green' },
      'admin': { icon: '⭐', label: 'Administrator', color: 'purple' },
      'ortu': { icon: '🎓', label: 'Orang Tua', color: 'orange' },
      'siswa': { icon: '👨‍🎓', label: 'Siswa', color: 'teal' },
      'lainnya': { icon: '👤', label: 'Lainnya', color: 'gray' }
    };
    return config[type] || config['lainnya'];
  });
  return badges;
}
```

**Display Rules:**
- Show ALL type badges for dual-role users
- Order badges by priority: admin > guru > pegawai > ortu > siswa > lainnya
- Show role names list below type badges if pegawai
- Show student cards if ortu (regardless of pegawai status)

---

## 🔧 **Implementation Details**

### **src/ssoIntegration.js**

**Functions:**

| Function | Description |
|----------|-------------|
| `getSSOConfig()` | Get SSO configuration from environment |
| `normalizePhoneForSSO()` | Normalize phone number for SSO lookup |
| `fetchUserFromSSO()` | Fetch user data from SSO API by phone |
| `fetchStudentsFromSSO()` | Fetch multiple students by IDs |
| `parseSSOUserData()` | Parse and extract relevant SSO fields |
| `syncContactWithSSO()` | Sync a single contact with SSO |
| `batchSyncContactsWithSSO()` | Batch sync multiple contacts |
| `getStudentDetails()` | Get student details by IDs |
| `searchContactInSSO()` | Search contact in SSO by phone |
| `getSSOSyncStatus()` | Get sync status for a contact |
| `testSSOConnection()` | Test SSO API connection |

### **Phone Number Normalization**

SSO stores phone numbers WITHOUT country code and leading zero:

```javascript
// Examples:
normalizePhoneForSSO('08123456789')    // → '8123456789'
normalizePhoneForSSO('+628123456789')  // → '8123456789'
normalizePhoneForSSO('628123456789')   // → '8123456789'
```

---

### **User Type Parsing Logic**

Based on the actual SSO response, implement this parsing logic:

```javascript
function parseSSOUserTypes(ssoData) {
  const types = [];
  const roles = [];

  // Check pegawai ACL
  const hasPegawai = ssoData.acl?.pegawai &&
                     Array.isArray(ssoData.acl.pegawai) &&
                     ssoData.acl.pegawai.length > 0;

  // Check ortu ACL
  const hasOrtu = ssoData.acl?.ortu &&
                  Array.isArray(ssoData.acl.ortu) &&
                  ssoData.acl.ortu.length > 0;

  // Determine types based on ACL
  if (hasPegawai) {
    types.push('pegawai');

    // Add specific role types
    const pegawaiRoles = ssoData.acl.pegawai;
    roles.push(...pegawaiRoles);

    if (pegawaiRoles.includes('Administrator')) {
      types.push('admin');
    }
    if (pegawaiRoles.includes('Guru / Pegawai')) {
      types.push('guru');
    }
  }

  if (hasOrtu) {
    types.push('ortu');
  }

  // Fallback to type field if no ACL data
  if (types.length === 0 && ssoData.type) {
    types.push(ssoData.type);
  }

  // Fallback to 'lainnya' if still no types
  if (types.length === 0) {
    types.push('lainnya');
  }

  return {
    sso_id: ssoData.id_telp,
    sso_type: types.join(','), // "pegawai,ortu,guru,admin"
    sso_acl: ssoData.acl,
    student_ids: ssoData.acl?.ortu || [],
    sso_roles: roles, // Array of role names for UI display
    raw_sso_data: ssoData
  };
}
```

**Example Usage:**
```javascript
// For Ahmad Alimuddin (dual-role)
const result = parseSSOUserTypes({
  id_telp: "685",
  type: "guru",
  acl: {
    pegawai: ["Administrator", "Guru / Pegawai"],
    ortu: ["9491", "9492", "9493"]
  }
});

// Result:
// {
//   sso_id: "685",
//   sso_type: "pegawai,admin,guru,ortu",
//   student_ids: ["9491", "9492", "9493"],
//   sso_roles: ["Administrator", "Guru / Pegawai"]
// }
```

---

## 📊 **Actual SSO API Response Format**

### **User Lookup Endpoint:**
```
GET /api/users/phone/{normalizedPhone}
Authorization: Bearer {SSO_API_KEY}
```

**OR with DataTable-style endpoint:**
```
GET /api/users?draw=1&search[value]={phone}
Authorization: Bearer {SSO_API_KEY}
```

**Actual Response Structure (DataTable format):**
```json
{
  "draw": 1,
  "recordsTotal": 17072,
  "recordsFiltered": 17072,
  "data": [
    {
      "id_telp": "685",
      "nama": "Ahmad Alimuddin",
      "nohp": "08388105401",
      "siap_gid": "133",
      "type": "guru",
      "noktp": "",
      "ortu": null,
      "status": "aktif",
      "org": "1",
      "orgid": "DQM",
      "orglogo": "https://dq.akses.live/assets/img/logo-dqm-full-color-utama.png",
      "timestamp": "2025-11-03 03:54:39",
      "acl": {
        "pegawai": [
          "Administrator",
          "Guru / Pegawai",
          "Pengurus",
          "Direksi",
          "SDM",
          "Mudir / Manager",
          "Keuangan",
          "TU",
          "CS",
          "Alumni",
          "Masyarakat",
          "Vendor"
        ],
        "ortu": [
          "9491",
          "9492",
          "9493",
          "9494",
          "9495"
        ]
      }
    }
  ],
  "pagination": {
    "total_items": 17072,
    "total_pages": 3415,
    "current_page": 1,
    "limit": 3
  },
  "source": "cache_id_telp_all"
}
```

**Key Response Fields:**

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id_telp` | string | Unique user ID | "685" |
| `nama` | string | Full name | "Ahmad Alimuddin" |
| `nohp` | string | Phone number | "08388105401" |
| `type` | string | User type from SSO | "guru", "ortu", or "" |
| `acl.pegawai` | string[] | Role names (if staff) | ["Administrator", "Guru / Pegawai"] |
| `acl.ortu` | string[] | Student IDs (if parent) | ["9491", "9492", "9493"] |
| `orgid` | string | Organization code | "DQM" |
| `orglogo` | string | Organization logo URL | "https://..." |
| `status` | string | Account status | "aktif" |

---

### **Real-World User Examples:**

#### **Example 1: Teacher who is also a Parent (Dual-Role)**
```json
{
  "id_telp": "685",
  "nama": "Ahmad Alimuddin",
  "type": "guru",
  "acl": {
    "pegawai": ["Administrator", "Guru / Pegawai", "Pengurus", "Direksi"],
    "ortu": ["9491", "9492", "9493", "9494", "9495"]
  }
}
```
**Parsed as:** `sso_type = "pegawai,ortu,guru,admin"`
- Has 12 role names as pegawai
- Has 5 children as ortu
- Should display BOTH role badges in UI

#### **Example 2: Parent Only**
```json
{
  "id_telp": "2804",
  "nama": "Akun Ortu",
  "type": "",
  "acl": {
    "ortu": ["8440"]
  }
}
```
**Parsed as:** `sso_type = "ortu"`
- No pegawai roles
- Has 1 child
- Simple parent user

#### **Example 3: Parent with Multiple Children**
```json
{
  "id_telp": "2806",
  "nama": "Dhona Nazula",
  "type": "",
  "acl": {
    "ortu": ["6931", "8864", "8764"]
  }
}
```
**Parsed as:** `sso_type = "ortu"`
- No pegawai roles
- Has 3 children
- Should show 3 student cards

### **Student Batch Lookup Endpoint:**
```
POST /api/students/batch
Authorization: Bearer {SSO_API_KEY}
Content-Type: application/json

{
  "student_ids": ["9491", "9492", "9493"]
}
```

**Expected Response:**
```json
{
  "students": [
    {
      "id": "9491",
      "name": "Ahmad Alimuddin",
      "class": "X-A",
      "status": "Active"
    }
  ]
}
```

### **Health Check Endpoint:**
```
GET /api/health
Authorization: Bearer {SSO_API_KEY}
```

**Expected Response:**
```json
{
  "status": "ok"
}
```

---

## 💡 **Use Cases**

### **1. Manual Sync per Contact**
1. Open contact detail modal
2. Click "Sync with SSO" button
3. If found, display SSO data
4. If not found, show error message

### **2. Check Sync Status**
- View contact detail modal
- See sync badge (✓ Synced / Not Synced)
- View last sync timestamp
- Warning if data is outdated (>24 hours)

### **3. View Linked Students**
- After sync, view linked students
- Click "View" button to see student details
- Shows student ID, name, class, status

---

## 🔔 **Future Enhancements**

### **Phase 2: Automation**
- [ ] Auto-sync on new contact creation
- [ ] Periodic background sync (daily/weekly)
- [ ] Sync all contacts button

### **Phase 3: Analytics**
- [ ] Message stats per student
- [ ] Response time analysis
- [ ] Parent engagement scoring
- [ ] Communication patterns

### **Phase 4: Advanced Features**
- [ ] Student-specific message tagging
- [ ] Parent categorization by engagement
- [ ] Risk scoring based on communication
- [ ] Automated intervention alerts

---

## 🚀 **Setup Instructions**

### **Step 1: Configure Environment**

Edit `.env` file:

```env
SSO_API_BASE_URL=https://your-sso-api.com/api
SSO_API_KEY=your-actual-api-key
SSO_API_TIMEOUT=30000
```

### **Step 2: Test Connection**

Start the server and test:

```bash
curl -X GET http://localhost:3000/api/sso/test-connection \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### **Step 3: Sync a Contact**

1. Open CRM in browser
2. Navigate to Contacts
3. Click on a contact
4. Click "Sync with SSO" button
5. View results

---

## 🔍 **Troubleshooting**

### **Issue: SSO_API_BASE_URL not configured**

**Error:** `SSO_API_BASE_URL is not configured in environment variables`

**Solution:**
- Add `SSO_API_BASE_URL` to `.env` file
- Restart server

### **Issue: SSO_API_KEY not configured**

**Error:** `SSO_API_KEY is not configured in environment variables`

**Solution:**
- Add `SSO_API_KEY` to `.env` file
- Restart server

### **Issue: User not found in SSO**

**Error:** `User not found in SSO system`

**Solution:**
- Verify phone number format in SSO
- Check if phone number in CRM matches SSO
- Use search endpoint to debug

### **Issue: Connection timeout**

**Error:** `SSO API request timed out`

**Solution:**
- Check SSO_API_BASE_URL is correct
- Verify network connectivity
- Increase SSO_API_TIMEOUT value

---

## 📚 **Resources**

- **SSO Module:** `src/ssoIntegration.js`
- **API Routes:** `src/index.js` (line 328-419)
- **Frontend:** `public/js/crm.js` (line 340-1018)
- **Styles:** `public/css/style.css` (line 795-867)
- **Schema:** `src/schemaDefinitions.js` (line 31-32)

---

**Last Updated:** January 27, 2026

**Version:** 2.0.0

**Status:** ✅ Documentation Updated | ⏳ Implementation Pending

---

## 📝 **Changelog**

### **Version 2.0.0 (January 27, 2026)**
**Major Update - Dual-Role Support & Actual API Structure**

#### **Changes:**
1. ✅ Updated API response format to match actual DataTable structure
   - Changed from object with ID keys to DataTable format with `draw`, `recordsTotal`, `data`, `pagination`

2. ✅ Updated database schema
   - Changed `sso_type` from ENUM to VARCHAR(255) to support comma-separated multiple types
   - Added `sso_roles` JSON column to store role names for pegawai
   - Updated documentation for ACL structure

3. ✅ Added dual-role user support
   - Users can now be BOTH pegawai AND ortu simultaneously
   - Logic to detect and parse multiple user types from ACL
   - UI examples for dual-role users (e.g., teacher who is also a parent)

4. ✅ Clarified ACL structure
   - `acl.pegawai` = Array of role names (strings): ["Administrator", "Guru / Pegawai"]
   - `acl.ortu` = Array of student IDs (strings): ["9491", "9492", "9493"]
   - Added real-world examples from actual SSO response

5. ✅ Added comprehensive parsing logic
   - JavaScript function `parseSSOUserTypes()` to handle ACL-based type detection
   - Priority-based type assignment (admin > guru > pegawai > ortu > siswa)
   - Fallback logic for users without ACL data

6. ✅ Updated UI components
   - UI examples for single-role, dual-role, and multi-child parents
   - Badge display logic with icons and colors
   - Display rules for multiple type badges

7. ✅ Updated API response examples
   - Search Contact: Added dual-role and single-role examples
   - Sync Contact: Added dual-role and parent-only examples
   - Sync Status: Added comprehensive status examples

#### **Breaking Changes from v1.0.0:**
- Database schema change: `sso_type` ENUM → VARCHAR(255)
- New field added: `sso_roles` JSON
- API response structure now includes `sso_roles` array
- Multiple user types stored as comma-separated values instead of single enum

---

### **Version 1.0.0 (Initial Release)**
- Basic SSO integration documentation
- Single-role user support only
- Expected API response format (not yet verified against actual API)
