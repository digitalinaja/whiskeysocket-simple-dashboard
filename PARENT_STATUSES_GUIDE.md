# Parent Statuses - Fitur CRM Sekolah

## 📋 Overview

**Parent Statuses** adalah fitur untuk mengelola status orang tua siswa (existing parents) secara terpisah dari pipeline prospek (lead statuses). Ini penting untuk sekolah karena:

### 🎯 **Perbedaan Lead vs Parent Status**

| Aspect | Lead Statuses | Parent Statuses |
|--------|---------------|-----------------|
| **Target** | Prospek orang tua (belum mendaftar) | Orang tua siswa (sudah mendaftar) |
| **Fokus** | Konversi prospek → pendaftaran | Retention & engagement |
| **Pipeline** | Sales funnel | Customer lifecycle |
| **Contoh** | New Lead → Contacted → Closed Won | Active → Administration Pending → Alumni |

---

## 🔄 **Parent Status Lifecycle (Default)**

### **5 Default Parent Statuses:**

1. **Active** (Hijau - `#22c55e`)
   - Orang tua dengan anak aktif bersekolah
   - SPP lancar, komunikasi aktif

2. **Administration Pending** (Kuning - `#f59e0b`)
   - Dalam proses administrasi pendaftaran
   - Dokumen belum lengkap, pembayaran pending

3. **Needs Attention** (Merah - `#ef4444`)
   - Memerlukan follow-up atau perhatian khusus
   - Tunggakan SPP, komplain, issue perlu solusi

4. **Alumni** (Ungu - `#8b5cf6`)
   - Anak sudah lulus dari sekolah
   - Potensial jadi donor, ambassador, networking

5. **Inactive** (Abu-abu - `#94a3b8`)
   - Tidak aktif atau sudah keluar
   - Pindah sekolah, putus sekolah

---

## 🗄️ **Database Schema**

### **Table: `parent_statuses`**

```sql
CREATE TABLE parent_statuses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  name VARCHAR(50) NOT NULL,
  order_index INT DEFAULT 0,
  color VARCHAR(7) DEFAULT '#3b82f6',
  category ENUM('active','pending','attention','alumni','inactive','custom') DEFAULT 'active',
  description TEXT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_parent_status_per_session (session_id, name),
  INDEX idx_parent_session (session_id),
  INDEX idx_parent_category (category)
);
```

### **Column di `contacts` table:**

```sql
ALTER TABLE contacts
ADD COLUMN parent_status_id INT NULL,
ADD INDEX idx_parent_status (parent_status_id);
```

---

## 🔌 **API Endpoints**

### **1. Get All Parent Statuses**
```http
GET /api/parent-statuses?sessionId={sessionId}
```

**Response:**
```json
{
  "statuses": [
    {
      "id": 1,
      "session_id": "default",
      "name": "Active",
      "order_index": 1,
      "color": "#22c55e",
      "category": "active",
      "description": "Orang tua dengan anak aktif bersekolah",
      "is_default": true,
      "is_active": true
    }
  ]
}
```

---

### **2. Create Parent Status**
```http
POST /api/parent-statuses
Content-Type: application/json

{
  "sessionId": "default",
  "name": "Payment Overdue",
  "color": "#ef4444",
  "orderIndex": 6,
  "category": "attention",
  "description": "Tunggakan pembayaran lebih dari 30 hari"
}
```

**Response:**
```json
{
  "success": true,
  "statusId": 7
}
```

---

### **3. Update Parent Status**
```http
PUT /api/parent-statuses/{id}
Content-Type: application/json

{
  "name": "Payment Overdue",
  "color": "#dc2626",
  "category": "attention",
  "description": "Tunggakan lebih dari 60 hari - urgent",
  "isActive": true
}
```

---

### **4. Delete Parent Status** (Soft Delete)
```http
DELETE /api/parent-statuses/{id}
```

**Note:** Ini soft delete (set `is_active = FALSE`), tidak menghapus data.

---

### **5. Update Contact's Parent Status**
```http
PUT /api/contacts/{contactId}/parent-status
Content-Type: application/json

{
  "sessionId": "default",
  "parentStatusId": 3
}
```

**Untuk menghapus parent status:**
```json
{
  "sessionId": "default",
  "parentStatusId": null
}
```

---

## 📊 **Kategori Parent Status**

| Category | Color Code | Deskripsi | Use Case |
|----------|------------|-----------|----------|
| **active** | Green | Orang tua aktif | SPP lancar, komunikasi baik |
| **pending** | Yellow | Menunggu sesuatu | Proses administrasi, dokumen |
| **attention** | Red | Perlu attention | Tunggakan, komplain, masalah |
| **alumni** | Purple | Alumni | Networking, donation, events |
| **inactive** | Gray | Tidak aktif | Keluar, pindah, putus |
| **custom** | Blue | Kustom | Sesuai kebutuhan sekolah |

---

## 🎨 **Color Guidelines**

Gunakan warna yang konsisten dengan kategori:

```javascript
const categoryColors = {
  active: '#22c55e',      // Green - positif
  pending: '#f59e0b',     // Yellow/Orange - tunggu
  attention: '#ef4444',   // Red - urgent/alert
  alumni: '#8b5cf6',      // Purple - special
  inactive: '#94a3b8',    // Gray - netral
  custom: '#3b82f6'       // Blue - default
};
```

---

## 💡 **Use Cases untuk Sekolah**

### **1. Retention Management**
```
Active → Needs Attention → Inactive
         ↓
   Intervention (follow-up)
```

### **2. Administration Flow**
```
New Parent → Administration Pending → Active
                                  ↓
                           Document checklist
```

### **3. Alumni Engagement**
```
Active → Alumni (graduation)
         ↓
   Networking, Events, Donation
```

### **4. Financial Tracking**
```
Active → Needs Attention (SPP overdue)
         ↓
   Payment reminder, payment plan
```

---

## 🔔 **Trigger & Automation Ideas**

### **Automations berdasarkan Parent Status:**

| Status Change | Trigger Automation |
|---------------|-------------------|
| **→ Needs Attention** | Send WhatsApp reminder to admin |
| **→ Administration Pending** | Auto-send document checklist |
| **→ Active** | Send welcome message |
| **→ Inactive** | Create exit survey task |
| **→ Alumni** | Add to alumni newsletter |

### **Example: Auto-reminder for Overdue Payments**

```javascript
// Cron job: Check daily
if (parent.status === 'Needs Attention' && parent.category === 'attention') {
  // Send WhatsApp reminder
  await sendWhatsAppMessage(
    parent.phone,
    `Halo ${parent.name}, mohon segera melunasi tunggakan SPP bulan ini. Terima kasih!`
  );
}
```

---

## 📈 **Reporting & Analytics**

### **Metrics yang Bisa Di-track:**

1. **Parent Distribution**
   ```sql
   SELECT ps.name, COUNT(*) as count
   FROM contacts c
   JOIN parent_statuses ps ON c.parent_status_id = ps.id
   GROUP BY ps.name
   ```

2. **Churn Rate**
   ```sql
   SELECT
     COUNT(CASE WHEN ps.category = 'inactive' THEN 1 END) * 100.0 / COUNT(*) as churn_rate
   FROM contacts c
   JOIN parent_statuses ps ON c.parent_status_id = ps.id
   ```

3. **Administration Completion**
   ```sql
   SELECT
     SUM(CASE WHEN ps.category = 'active' THEN 1 ELSE 0 END) as completed,
     SUM(CASE WHEN ps.category = 'pending' THEN 1 ELSE 0 END) as pending
   FROM contacts c
   JOIN parent_statuses ps ON c.parent_status_id = ps.id
   WHERE c.contact_type = 'student_parent'
   ```

---

## 🚀 **Implementation Checklist**

- [x] Database schema updated
- [x] Default parent statuses created
- [x] API endpoints created
- [x] Contacts query updated with parent status
- [ ] Frontend UI untuk parent status management
- [ ] Filter contacts by parent status
- [ ] Bulk update parent status
- [ ] Parent status change history
- [ ] Automation/triggers for status changes

---

## 🎯 **Best Practices**

### **1. Separation of Concerns**
- **Lead Status**: Untuk pipeline sales (prospek → closing)
- **Parent Status**: Untuk customer lifecycle (existing parents)
- Jangan gunakan keduanya untuk contact yang sama!

### **2. Status Transition Rules**
```
Lead Status → Closed Won → (create contact) → Parent Status: Administration Pending
Parent Status: Active → Needs Attention → (intervention) → Parent Status: Active
```

### **3. Naming Conventions**
- Gunakan nama yang jelas dan action-oriented
- "Needs Attention" bukan "Problematic"
- "Administration Pending" bukan "In Process"

### **4. Category Consistency**
- Pastikan custom statuses masuk kategori yang tepat
- Jangan buat status baru jika existing category sudah cukup

---

## 🔍 **Troubleshooting**

### **Issue: Parent status not showing in contact list**

**Cause**: Contacts belum di-load ulang setelah schema update

**Solution**:
1. Refresh contacts list
2. Check browser console untuk errors
3. Verify `parent_status_id` terisi di database

---

### **Issue: Cannot change parent status**

**Cause**: Parent status belum dibuat untuk session

**Solution**:
```javascript
// Check if parent statuses exist for session
const response = await fetch(`/api/parent-statuses?sessionId=${sessionId}`);
const { statuses } = await response.json();

if (statuses.length === 0) {
  // Create default statuses
  await createDefaultParentStatuses(sessionId);
}
```

---

### **Issue: Duplicate default statuses**

**Cause**: Multiple calls to `createDefaultParentStatuses`

**Solution**: Function sudah menggunakan `INSERT IGNORE`, jadi aman dipanggil berkali-kali

---

## 📚 **Resources**

- **Database Schema**: `src/schemaDefinitions.js`
- **API Routes**: `src/crmRoutes.js` (line 656-788)
- **Default Creation**: `src/database.js` (line 225-255)
- **Session Init**: `src/index.js` (line 419-420)

---

## 📝 **Changelog**

### **Version 1.5.0 (Current)**
- ✅ Added `parent_statuses` table
- ✅ Added `parent_status_id` to `contacts` table
- ✅ Created 5 default parent statuses
- ✅ Added CRUD API endpoints
- ✅ Updated contacts query with parent status join
- ✅ Auto-create default statuses on new session

---

**Last Updated**: January 27, 2026

**Schema Version**: 1.5.0

**Status**: Backend Complete ✅ | Frontend Pending ⏳
