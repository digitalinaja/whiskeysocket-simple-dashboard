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

**Response:**
```json
{
  "found": true,
  "data": {
    "sso_id": "686",
    "sso_type": "ortu",
    "sso_name": "Bapak Budi",
    "student_ids": ["9491", "9492", "9493"],
    "raw_sso_data": { ... }
  }
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

**Response (User Found):**
```json
{
  "success": true,
  "found": true,
  "message": "Successfully synced with SSO",
  "contact": {
    "id": 123,
    "phone": "08123456789",
    "name": "Bapak Budi",
    "sso_id": "686",
    "sso_type": "ortu",
    "student_ids": ["9491", "9492", "9493"],
    "student_count": 3
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
    "id": 123,
    "phone": "08123456789",
    "sso_id": null,
    "sso_type": null
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

**Response:**
```json
{
  "contact_id": 123,
  "phone": "08123456789",
  "is_synced": true,
  "sso_id": "686",
  "sso_type": "ortu",
  "student_ids": ["9491", "9492", "9493"],
  "student_count": 3,
  "last_synced_at": "2026-01-27T10:30:00.000Z",
  "needs_sync": false
}
```

---

## 🗄️ **Database Schema**

### **Columns Added to `contacts` table:**

```sql
ALTER TABLE contacts
ADD COLUMN sso_id VARCHAR(50) NULL,
ADD COLUMN sso_type ENUM('guru','ortu','pegawai','admin','siswa','lainnya') NULL,
ADD COLUMN sso_acl JSON NULL COMMENT 'Access control list from SSO',
ADD COLUMN student_ids JSON NULL COMMENT 'Array of student IDs from SSO',
ADD COLUMN last_synced_sso_at TIMESTAMP NULL,
ADD INDEX idx_sso_id (sso_id),
ADD INDEX idx_sso_type (sso_type);
```

### **SSO User Types:**

| Type | Label | Description |
|------|-------|-------------|
| `guru` | Guru (Teacher) | Teacher/educator |
| `ortu` | Orang Tua (Parent) | Parent/guardian |
| `pegawai` | Pegawai (Staff) | School staff |
| `admin` | Administrator | School administrator |
| `siswa` | Siswa (Student) | Student |
| `lainnya` | Lainnya (Other) | Other |

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

#### **When Synced:**
```
┌─────────────────────────────────────┐
│ SSO Integration              ✓ Synced │
├─────────────────────────────────────┤
│ SSO ID:           686               │
│ User Type:        Orang Tua (Parent)│
│ Linked Students:  3 student(s)      │
│   ┌─ 9491              [View]      │
│   ├─ 9492              [View]      │
│   └─ 9493              [View]      │
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

SSO stores phone numbers without country code and leading zero:

```javascript
// Examples:
normalizePhoneForSSO('08123456789')    // → '8123456789'
normalizePhoneForSSO('+628123456789')  // → '8123456789'
normalizePhoneForSSO('628123456789')   // → '8123456789'
```

---

## 📊 **Expected SSO API Response Format**

### **User Lookup Endpoint:**
```
GET /api/users/phone/{normalizedPhone}
Authorization: Bearer {SSO_API_KEY}
```

**Expected Response:**
```json
{
  "686": {
    "id_telp": "686",
    "nama": "Bapak Budi",
    "nohp": "08123456789",
    "type": "ortu",
    "acl": {
      "pegawai": ["Administrator", "Guru / Pegawai"],
      "ortu": ["9491", "9492", "9493"]
    }
  }
}
```

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

**Version:** 1.0.0

**Status:** ✅ Implementation Complete | ⏳ Testing Pending
