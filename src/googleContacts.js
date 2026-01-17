import { google } from 'googleapis';
import { getPool } from './database.js';
import { normalizePhoneNumber } from './chatHandlers.js';

// OAuth2 client configuration
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate authorization URL for Google OAuth
 */
function getAuthUrl(sessionId) {
  const oauth2Client = getOAuth2Client();

  const scopes = [
    'https://www.googleapis.com/auth/contacts.readonly'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: sessionId // Pass sessionId as state parameter
  });

  return authUrl;
}

/**
 * Handle OAuth callback and store tokens
 */
async function handleOAuthCallback(code, sessionId) {
  const connection = getPool();

  try {
    const oauth2Client = getOAuth2Client();

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Calculate expiry date
    const expiryDate = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000); // Default 1 hour

    // Store or update tokens in database
    await connection.query(
      `INSERT INTO google_tokens (session_id, access_token, refresh_token, token_type, expiry_date, scope)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = VALUES(refresh_token),
       token_type = VALUES(token_type),
       expiry_date = VALUES(expiry_date),
       scope = VALUES(scope),
       updated_at = CURRENT_TIMESTAMP`,
      [
        sessionId,
        tokens.access_token,
        tokens.refresh_token,
        tokens.token_type || 'Bearer',
        expiryDate,
        tokens.scope
      ]
    );

    console.log(`✓ Google OAuth tokens stored for session: ${sessionId}`);
    return true;
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    throw error;
  }
}

/**
 * Get authenticated Google client for a session
 */
async function getGoogleClient(sessionId) {
  const connection = getPool();

  try {
    // Get tokens from database
    const [tokens] = await connection.query(
      `SELECT * FROM google_tokens WHERE session_id = ?`,
      [sessionId]
    );

    if (tokens.length === 0) {
      throw new Error('No Google tokens found for session');
    }

    const token = tokens[0];

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expiry_date: token.expiry_date?.getTime()
    });

    // Check if token is expired and refresh if needed
    const expiryDate = token.expiry_date ? new Date(token.expiry_date) : null;
    const isExpired = expiryDate && expiryDate < new Date();

    if (isExpired) {
      console.log('Refreshing Google access token...');
      const { credentials } = await oauth2Client.refreshAccessToken();

      // Update tokens in database
      await connection.query(
        `UPDATE google_tokens
         SET access_token = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`,
        [
          credentials.access_token,
          credentials.expiry_date ? new Date(credentials.expiry_date) : null,
          sessionId
        ]
      );

      console.log('✓ Google access token refreshed');
    }

    // Create People API client
    const people = google.people({ version: 'v1', auth: oauth2Client });

    return people;
  } catch (error) {
    console.error('Error getting Google client:', error);
    throw error;
  }
}

/**
 * Check if Google is connected for a session
 */
async function isConnected(sessionId) {
  const connection = getPool();

  try {
    const [tokens] = await connection.query(
      `SELECT id FROM google_tokens WHERE session_id = ?`,
      [sessionId]
    );

    return tokens.length > 0;
  } catch (error) {
    console.error('Error checking Google connection:', error);
    return false;
  }
}

/**
 * Sync contacts from Google
 */
async function syncContactsFromGoogle(sessionId) {
  const connection = getPool();

  try {
    console.log(`Syncing Google contacts for session: ${sessionId}...`);

    const people = await getGoogleClient(sessionId);

    // Fetch all connections (contacts)
    let allContacts = [];
    let pageToken = null;

    do {
      const response = await people.people.connections.list({
        resourceName: 'people/me',
        personFields: 'names,phoneNumbers,emailAddresses,organizations',
        pageSize: 1000,
        pageToken
      });

      if (response.data.connections) {
        allContacts = allContacts.concat(response.data.connections);
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    console.log(`Fetched ${allContacts.length} contacts from Google`);

    let synced = 0;
    let updated = 0;
    let merged = 0;

    for (const gc of allContacts) {
      // Skip contacts without names or phone numbers
      if (!gc.names || gc.names.length === 0) continue;

      const name = gc.names[0].displayName || 'Unknown';
      const phoneNumbers = gc.phoneNumbers || [];
      const rawPhone = phoneNumbers.length > 0 ? phoneNumbers[0].value : null;

      if (!rawPhone) continue; // Skip contacts without phone numbers

      // Normalize phone number to international format
      const primaryPhone = normalizePhoneNumber(rawPhone);
      if (!primaryPhone) {
        console.log(`⚠️ Skipping invalid phone: ${rawPhone}`);
        continue;
      }

      // Check if contact exists by phone (normalized)
      const [existing] = await connection.query(
        `SELECT * FROM contacts WHERE session_id = ? AND phone = ?`,
        [sessionId, primaryPhone]
      );

      if (existing.length > 0) {
        const contact = existing[0];

        // Update if source is 'whatsapp' or 'google', change to 'both'
        // Always prioritize Google Contact name over WhatsApp pushName (more official/consistent)
        if (contact.source !== 'both' || contact.name !== name) {
          await connection.query(
            `UPDATE contacts SET source = 'both', google_contact_id = ?, name = ?, push_name = ? WHERE id = ?`,
            [gc.resourceName, name, name, contact.id]
          );
          merged++;
          console.log(`📝 Merged contact: phone=${primaryPhone}, name="${name}" (updated from "${contact.name}")`);
        }
      } else {
        // Create new contact with source='google'
        const [result] = await connection.query(
          `INSERT INTO contacts (session_id, phone, name, google_contact_id, source)
           VALUES (?, ?, ?, ?, 'google')`,
          [sessionId, primaryPhone, name, gc.resourceName]
        );
        synced++;
      }
    }

    console.log(`✓ Google contacts synced: ${synced} new, ${merged} merged`);
    return { synced, merged, total: allContacts.length };
  } catch (error) {
    console.error('Error syncing Google contacts:', error);
    throw error;
  }
}

/**
 * Disconnect Google account for a session
 */
async function disconnectGoogle(sessionId) {
  const connection = getPool();

  try {
    await connection.query(
      `DELETE FROM google_tokens WHERE session_id = ?`,
      [sessionId]
    );

    console.log(`✓ Google disconnected for session: ${sessionId}`);
    return true;
  } catch (error) {
    console.error('Error disconnecting Google:', error);
    throw error;
  }
}

export {
  getAuthUrl,
  handleOAuthCallback,
  getGoogleClient,
  isConnected,
  syncContactsFromGoogle,
  disconnectGoogle
};
