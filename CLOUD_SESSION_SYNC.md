# Cloud Session Sync Documentation

## Overview
Baileys WhatsApp sessions sekarang dapat disimpan dan di-sync secara otomatis ke TiDB Cloud database. Ini memungkinkan:

✅ **Access session dari device manapun** - Login di satu device, akses dari device lain  
✅ **Automatic backup** - Session di-backup ke cloud setiap kali ada update  
✅ **Disaster recovery** - Restore session jika device rusak  
✅ **Multi-server setup** - Satu session bisa diakses dari multiple servers  

## How It Works

### 1. Auto-Sync Flow
```
Device/Server A
    ↓
Session updated (credentials change)
    ↓
Baileys: creds.update event
    ↓
Save locally (existing behavior)
    ↓
Encrypt & Save to TiDB Cloud
    ↓
✓ Session synced
```

### 2. Load from Cloud
```
Device/Server B
    ↓
Create session (new device/server)
    ↓
Check local auth files (empty)
    ↓
Try to load from cloud
    ↓
Found in cloud → Decrypt & Restore
    ↓
✓ Session ready to use
```

## Configuration

### Required Environment Variables

```env
# TiDB Cloud Connection (already required for CRM features)
TIDB_HOST=gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com
TIDB_PORT=4000
TIDB_USER=your_username
TIDB_PASSWORD=your_password
TIDB_DATABASE=whiskeysocket_crm

# Session Encryption Secret (NEW - change this!)
SESSION_ENCRYPTION_SECRET=your-super-secret-encryption-key-change-this-in-production
```

### Generate Secure Encryption Key

```bash
# Generate a random 32-character key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy output dan set sebagai `SESSION_ENCRYPTION_SECRET` di `.env`

## API Endpoints

### 1. List All Cloud Sessions
```
GET /cloud/sessions
Authorization: Bearer <token>
```

**Response:**
```json
{
  "sessions": [
    {
      "session_id": "personal",
      "last_synced_at": "2026-01-22T10:30:45Z",
      "created_at": "2026-01-20T08:15:30Z",
      "updated_at": "2026-01-22T10:30:45Z"
    },
    {
      "session_id": "business",
      "last_synced_at": "2026-01-22T09:45:20Z",
      "created_at": "2026-01-21T14:20:10Z",
      "updated_at": "2026-01-22T09:45:20Z"
    }
  ]
}
```

### 2. Get Session Sync Status
```
GET /cloud/sessions/:sessionId/status
Authorization: Bearer <token>
```

**Response:**
```json
{
  "sessionId": "personal",
  "lastSynced": "2026-01-22T10:30:45Z",
  "createdAt": "2026-01-20T08:15:30Z",
  "updatedAt": "2026-01-22T10:30:45Z"
}
```

### 3. Force Sync Session to Cloud
```
POST /cloud/sessions/:sessionId/sync
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "synced to cloud",
  "sessionId": "personal"
}
```

### 4. Restore Session from Cloud
```
POST /cloud/sessions/:sessionId/restore
Authorization: Bearer <token>
```

**Behavior:**
- Fetch credentials dari cloud
- Restore ke local auth directory
- Reload session
- Baileys akan re-authenticate

**Response:**
```json
{
  "status": "restored from cloud",
  "sessionId": "personal"
}
```

### 5. Delete Session from Cloud
```
DELETE /cloud/sessions/:sessionId
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "deleted from cloud",
  "sessionId": "personal"
}
```

## Use Cases

### Use Case 1: Multi-Device Access
```
Dev Laptop
  ↓ Login to WhatsApp (scan QR)
  ↓ Session auto-saved to cloud
  
Production Server
  ↓ Same session ID
  ↓ Auto-restore from cloud
  ↓ ✓ Ready to send messages
```

### Use Case 2: Device Migration
```
Old Server (broken)
  ↓ Session in cloud

New Server
  ↓ Create session with same ID
  ↓ Auto-restore from cloud
  ↓ ✓ No re-login needed
```

### Use Case 3: Backup & Recovery
```
Regular Sync (auto)
  ↓ Every creds update
  ↓ Stored encrypted in TiDB

Disaster Recovery
  ↓ Device lost/corrupted
  ↓ POST /cloud/sessions/:id/restore
  ↓ ✓ Session recovered
```

## Security

### Encryption Details
- **Algorithm**: AES-256-CBC
- **Key Derivation**: PBKDF2 (100,000 iterations)
- **Input**: sessionId + SESSION_ENCRYPTION_SECRET
- **Storage**: Encrypted BLOB in TiDB

### Security Checklist
- ✅ Session data encrypted before sending to cloud
- ✅ Unique encryption key per session
- ✅ Use strong SESSION_ENCRYPTION_SECRET
- ✅ Keep .env file secure (never commit to git)
- ✅ Use HTTPS for all API calls (in production)

## Troubleshooting

### Issue: Cloud sync fails but local session still works
**Cause**: Database connection error  
**Solution**: Check TiDB connection credentials, database is accessible

### Issue: Session not restored from cloud
**Cause**: Session doesn't exist in cloud yet  
**Solution**: Normal for brand new sessions. Session will auto-sync after first login.

### Issue: "SESSION_ENCRYPTION_SECRET not set"
**Solution**: Add to .env file and restart server

### Issue: Restored session says "logged out"
**Cause**: WhatsApp app on phone might have logged out  
**Solution**: Scan QR code again to re-login, new credentials will be synced

## Monitoring

### Check if session is syncing
Look for these logs:
```
☁️ Session personal synced to cloud
✓ Session personal saved to cloud
✓ Session personal loaded from cloud
```

### Check sync history
```bash
# List all cloud sessions with sync times
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions
```

## Database Schema

Table: `whatsapp_sessions`
```sql
id: INT AUTO_INCREMENT PRIMARY KEY
session_id: VARCHAR(255) NOT NULL UNIQUE
session_data: LONGBLOB NOT NULL (encrypted)
last_synced_at: TIMESTAMP NULL
created_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

## Performance Impact

- **Local save**: ~5-10ms (unchanged)
- **Cloud sync**: ~100-500ms (async, doesn't block local save)
- **Cloud load**: ~200-800ms (only on first session creation)
- **Overall**: No noticeable UX impact due to async handling

## Future Enhancements

- [ ] Sync status dashboard in UI
- [ ] Selective session backup (only important sessions)
- [ ] Session versioning/rollback
- [ ] Cross-device notification when session is used
- [ ] Session sharing between users (with permissions)

## Migration from Existing Setup

If you already have local sessions:

1. **First time after update**: Existing local sessions work normally
2. **Auto-sync starts**: Next creds update → auto-synced to cloud
3. **New device**: Can restore existing sessions from cloud

No action needed! Cloud sync is backward compatible.
