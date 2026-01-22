# ☁️ Cloud Session Auto-Sync - Setup Checklist

## Pre-Implementation Checklist
- ✅ TiDB Cloud database configured (existing)
- ✅ Express API server running
- ✅ Session management in place
- ✅ `.env` file created

## Implementation Complete ✓

### Files Created (3 new files)
- [x] `src/sessionStorage.js` - Cloud sync core logic
- [x] `scripts/cloudSessionCli.js` - CLI tool
- [x] Documentation files:
  - `CLOUD_SESSION_SYNC.md` - Complete API reference
  - `CLOUD_SYNC_QUICKSTART.md` - 5-minute quick start
  - `CLOUD_SYNC_IMPLEMENTATION.md` - Technical details

### Files Modified (4 files)
- [x] `src/baileys.js` - Add auto-sync on creds.update
- [x] `src/index.js` - Add cloud endpoints & restore logic
- [x] `src/schemaDefinitions.js` - Add whatsapp_sessions table
- [x] `package.json` - Add npm scripts

### Syntax Verified ✓
- [x] `src/sessionStorage.js` - OK
- [x] `src/baileys.js` - OK
- [x] `src/index.js` - OK

## Setup Instructions

### Step 1: Add Environment Variable
```bash
# Generate random encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Copy the output and add to .env:
SESSION_ENCRYPTION_SECRET=<paste_here>
```

⏱️ Time: 2 minutes

### Step 2: Create Database Table
```bash
npm run db:validate
```

This will:
- Check TiDB connection
- Create `whatsapp_sessions` table if not exists
- Verify schema

✓ Look for: "✓ Database initialized and validated successfully"

⏱️ Time: 1-2 minutes

### Step 3: Restart Server
```bash
npm start
```

Watch logs for:
```
✓ Database initialized and validated successfully
Server running on port 3000
```

⏱️ Time: 1 minute

### Step 4: Test (Optional but Recommended)
```bash
# List all cloud sessions (should be empty initially)
npm run cloud:list

# Result:
# No sessions found in cloud
```

⏱️ Time: 1 minute

**Total Setup Time: 5-10 minutes**

## Verification

### Is cloud sync working?

1. **Create a session in dashboard**
   - Go to http://localhost:3000
   - Create new session "test"
   - Scan QR code with WhatsApp

2. **Check cloud sync**
   ```bash
   npm run cloud:list
   ```
   
   Should see:
   ```
   ✓ Session found in cloud
   Session: test
   Created:  2026-01-22T10:30:45Z
   Updated:  2026-01-22T10:30:45Z
   Synced:   2026-01-22T10:30:45Z
   ```

3. **Check logs for**
   ```
   ☁️ Session test synced to cloud
   ✓ Session test saved to cloud
   ```

## Features Enabled

### ✅ Auto-Sync (Automatic)
- Every time credentials update → Auto-saved to cloud
- No configuration needed
- Logs: `☁️ Session <id> synced to cloud`

### ✅ Auto-Restore (Automatic)
- New device/server → Auto-restores from cloud
- No re-login needed if session exists
- Logs: `✓ Session <id> loaded from cloud`

### ✅ Manual Management (API)
```bash
# List sessions
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions

# Check status
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions/test/status

# Force sync
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions/test/sync

# Force restore
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions/test/restore

# Delete from cloud
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions/test
```

### ✅ CLI Management
```bash
npm run cloud:list                    # List sessions
npm run cloud:status <sessionId>      # Check status
npm run cloud:delete <sessionId>      # Delete
```

## Troubleshooting

### Error: "SESSION_ENCRYPTION_SECRET not set"
**Solution:** Add to `.env` and restart

### Error: "Connection failed"
**Solution:** Check TiDB credentials in `.env`

### Cloud sync not working
**Solution:** 
1. Check logs for errors
2. Verify TiDB is accessible
3. Run `npm run db:validate` to recreate table

### Session not restoring from cloud
**Solution:**
- This is normal for brand new sessions
- After first login/update → will be in cloud
- Next device creation will restore it

## Common Tasks

### Task: Move session to another device
1. Create same session ID on new device
2. Auto-restore happens automatically
3. Done ✓

### Task: Backup all sessions
```bash
npm run cloud:list
# All sessions are already backed up!
```

### Task: Delete a session completely
```bash
# Method 1: Via API
curl -X DELETE -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions/test

# Method 2: Via CLI (only cloud)
npm run cloud:delete test

# Note: Deletes from cloud only, not local
```

### Task: Force resync session
```bash
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3000/cloud/sessions/test/sync
```

## Security Checklist

- [ ] `SESSION_ENCRYPTION_SECRET` set in `.env`
- [ ] `.env` file NOT committed to git
- [ ] Using HTTPS in production (if available)
- [ ] Database credentials in `.env` (not hardcoded)
- [ ] Regular backups of TiDB database
- [ ] Monitor for unusual sync patterns

## Performance Check

Run these to verify performance is acceptable:

```bash
# Check sync time in logs
# Should see 100-500ms for cloud sync

npm start
# Create session and watch logs
# Look for timestamps

# Check database
# SELECT COUNT(*) FROM whatsapp_sessions;
# Should work quickly even with many sessions
```

## Next Steps

1. ✅ Setup complete?
2. ✅ Cloud sync working?
3. 📖 Read `CLOUD_SESSION_SYNC.md` for:
   - Complete API reference
   - Advanced use cases
   - Security details
   - Architecture diagram

4. 🧪 Test multi-device sync
5. 📊 Monitor with `npm run cloud:list`

## Support

If you encounter issues:

1. Check logs: Look for error messages
2. Verify setup: Run `npm run db:validate`
3. Read docs: `CLOUD_SESSION_SYNC.md`
4. Check troubleshooting: See section above

## Rollback

If you need to disable cloud sync:

1. Remove `SESSION_ENCRYPTION_SECRET` from `.env`
2. Restart server
3. Local sessions will continue working
4. Cloud sync will be skipped silently

## What's Next

### Optional Enhancements
- [ ] Dashboard UI for cloud session management
- [ ] Session sharing between users
- [ ] Session versioning/rollback
- [ ] Cross-region replication
- [ ] Automatic cleanup of old sessions

### Monitoring
- Set up alerts for failed cloud syncs
- Monitor database table size
- Track restore success rate

---

✅ **Setup Complete!**

Your sessions are now automatically backed up to TiDB Cloud.
Access them from any device with the same session ID. 🚀
