import crypto from 'crypto';
import { getPool } from './database.js';

/**
 * Encrypt session data for storage
 */
function encryptSessionData(data, encryptionKey) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(encryptionKey, 'hex').slice(0, 32),
      iv
    );
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    console.error('Encryption failed:', err);
    throw err;
  }
}

/**
 * Decrypt session data from storage
 */
function decryptSessionData(encryptedData, encryptionKey) {
  try {
    // Convert Buffer to string if necessary
    const encryptedString = Buffer.isBuffer(encryptedData) 
      ? encryptedData.toString('utf8') 
      : encryptedData;
    
    const [ivHex, encrypted] = encryptedString.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(encryptionKey, 'hex').slice(0, 32),
      iv
    );
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (err) {
    console.error('Decryption failed:', err);
    throw err;
  }
}

/**
 * Generate encryption key from session ID
 */
function generateEncryptionKey(sessionId) {
  // Use PBKDF2 to derive a key from session ID + secret
  const secret = process.env.SESSION_ENCRYPTION_SECRET || 'whiskeysocket-default-secret';
  return crypto
    .pbkdf2Sync(sessionId + secret, 'whiskeysocket', 100000, 32, 'sha256')
    .toString('hex');
}

/**
 * Save session to TiDB Cloud
 */
export async function saveSessionToCloud(sessionId, sessionData) {
  const connection = await getPool().getConnection();
  try {
    const encryptionKey = generateEncryptionKey(sessionId);
    const encryptedData = encryptSessionData(sessionData, encryptionKey);
    
    const query = `
      INSERT INTO whatsapp_sessions (session_id, session_data, last_synced_at)
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE 
        session_data = VALUES(session_data),
        last_synced_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
    `;
    
    const [result] = await connection.execute(query, [sessionId, encryptedData]);
    console.log(`✓ Session ${sessionId} saved to cloud`);
    return result;
  } catch (err) {
    console.error('Failed to save session to cloud:', err);
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Load session from TiDB Cloud
 */
export async function loadSessionFromCloud(sessionId) {
  const connection = await getPool().getConnection();
  try {
    const query = `
      SELECT session_data, last_synced_at
      FROM whatsapp_sessions
      WHERE session_id = ?
    `;
    
    const [rows] = await connection.execute(query, [sessionId]);
    
    if (rows.length === 0) {
      console.log(`Session ${sessionId} not found in cloud`);
      return null;
    }
    
    const encryptionKey = generateEncryptionKey(sessionId);
    const sessionData = decryptSessionData(rows[0].session_data, encryptionKey);
    
    console.log(`✓ Session ${sessionId} loaded from cloud (synced at ${rows[0].last_synced_at})`);
    return sessionData;
  } catch (err) {
    console.error('Failed to load session from cloud:', err);
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Delete session from TiDB Cloud
 */
export async function deleteSessionFromCloud(sessionId) {
  const connection = await getPool().getConnection();
  try {
    const query = `
      DELETE FROM whatsapp_sessions
      WHERE session_id = ?
    `;
    
    const [result] = await connection.execute(query, [sessionId]);
    console.log(`✓ Session ${sessionId} deleted from cloud`);
    return result;
  } catch (err) {
    console.error('Failed to delete session from cloud:', err);
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * List all sessions in cloud
 */
export async function listSessionsFromCloud() {
  const connection = await getPool().getConnection();
  try {
    const query = `
      SELECT session_id, last_synced_at, created_at
      FROM whatsapp_sessions
      ORDER BY last_synced_at DESC
    `;
    
    const [rows] = await connection.execute(query);
    return rows;
  } catch (err) {
    console.error('Failed to list sessions from cloud:', err);
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Update session sync status
 */
export async function updateSessionSyncStatus(sessionId) {
  const connection = await getPool().getConnection();
  try {
    const query = `
      UPDATE whatsapp_sessions
      SET last_synced_at = NOW()
      WHERE session_id = ?
    `;
    
    await connection.execute(query, [sessionId]);
  } catch (err) {
    console.error('Failed to update session sync status:', err);
    throw err;
  } finally {
    connection.release();
  }
}
