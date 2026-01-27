import { getPool } from './database.js';
import { normalizePhoneNumber } from './chatHandlers.js';

/**
 * Microsoft Graph API base URL
 */
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Get Microsoft OAuth configuration
 */
function getMicrosoftConfig() {
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${process.env.BASE_URL || 'http://localhost:3000'}/auth/microsoft/callback`
  };
}

/**
 * Generate authorization URL for Microsoft OAuth
 */
function getAuthUrl(sessionId) {
  const config = getMicrosoftConfig();

  const scopes = [
    'https://graph.microsoft.com/Contacts.Read'
  ];

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: scopes.join(' '),
    state: sessionId, // Pass sessionId as state parameter
    response_mode: 'query'
  });

  const authUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;

  return authUrl;
}

/**
 * Handle OAuth callback and store tokens
 */
async function handleOAuthCallback(code, sessionId) {
  const connection = getPool();

  try {
    const config = getMicrosoftConfig();

    // Exchange code for tokens
    const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
    }

    const tokens = await tokenResponse.json();

    // Calculate expiry date
    const expiresIn = tokens.expires_in || 3600;
    const expiryDate = new Date(Date.now() + expiresIn * 1000);

    // Store or update tokens in database
    // Note: Microsoft doesn't always send refresh_token (depends on tenant/app configuration)
    // We handle NULL refresh_token gracefully
    await connection.query(
      `INSERT INTO outlook_tokens (session_id, access_token, refresh_token, token_type, expiry_date, scope)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), outlook_tokens.refresh_token),
       token_type = VALUES(token_type),
       expiry_date = VALUES(expiry_date),
       scope = VALUES(scope),
       updated_at = CURRENT_TIMESTAMP`,
      [
        sessionId,
        tokens.access_token,
        tokens.refresh_token || null, // Allow NULL if not provided
        tokens.token_type || 'Bearer',
        expiryDate,
        tokens.scope || ''
      ]
    );

    console.log(`✓ Microsoft OAuth tokens stored for session: ${sessionId}`);
    return true;
  } catch (error) {
    console.error('Error handling Microsoft OAuth callback:', error.message);
    throw error;
  }
}

/**
 * Get authenticated Microsoft Graph client for a session
 */
async function getMicrosoftClient(sessionId) {
  const connection = getPool();

  try {
    // Get tokens from database
    const [tokens] = await connection.query(
      `SELECT * FROM outlook_tokens WHERE session_id = ?`,
      [sessionId]
    );

    if (tokens.length === 0) {
      throw new Error('No Microsoft tokens found for session');
    }

    const token = tokens[0];

    // Check if token is expired and refresh if needed
    const expiryDate = token.expiry_date ? new Date(token.expiry_date) : null;
    const isExpired = expiryDate && expiryDate < new Date();

    let accessToken = token.access_token;

    if (isExpired) {
      console.log('Refreshing Microsoft access token...');

      const config = getMicrosoftConfig();

      const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

      const params = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: token.refresh_token,
        grant_type: 'refresh_token'
      });

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token refresh failed: ${tokenResponse.status}`);
      }

      const newTokens = await tokenResponse.json();
      accessToken = newTokens.access_token;

      // Calculate new expiry date
      const expiresIn = newTokens.expires_in || 3600;
      const newExpiryDate = new Date(Date.now() + expiresIn * 1000);

      // Update tokens in database
      await connection.query(
        `UPDATE outlook_tokens
         SET access_token = ?,
             refresh_token = COALESCE(?, refresh_token),
             expiry_date = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`,
        [
          accessToken,
          newTokens.refresh_token,
          newExpiryDate,
          sessionId
        ]
      );

      console.log('✓ Microsoft access token refreshed');
    }

    return accessToken;
  } catch (error) {
    console.error('Error getting Microsoft client:', error.message);
    throw error;
  }
}

/**
 * Check if Microsoft is connected for a session
 */
async function isConnected(sessionId) {
  const connection = getPool();

  try {
    const [tokens] = await connection.query(
      `SELECT id FROM outlook_tokens WHERE session_id = ?`,
      [sessionId]
    );

    return tokens.length > 0;
  } catch (error) {
    console.error('Error checking Microsoft connection:', error);
    return false;
  }
}

/**
 * Fetch all contacts from Microsoft Graph API
 */
async function fetchOutlookContacts(accessToken) {
  let allContacts = [];
  let useSelect = true; // Flag to track if we're using $select

  // Use URL parameters properly encoded for OData queries
  const params = new URLSearchParams({
    $select: 'displayName,mobilePhone,homePhone,businessPhone,emailAddresses'
  });

  let url = `${GRAPH_API_BASE}/me/contacts?${params.toString()}`;

  try {
    // Handle pagination with @odata.nextLink
    do {
      console.log(`Fetching Outlook contacts from: ${url.substring(0, 100)}...`);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Microsoft Graph API Error:', response.status, errorText);

        // Try without $select if there's a 400 error
        if (response.status === 400 && useSelect && url.includes('%24select')) {
          console.log('⚠️ Error with $select parameter, retrying without field filtering...');
          url = `${GRAPH_API_BASE}/me/contacts`;
          useSelect = false; // Mark that we're not using $select anymore
          continue; // Retry with simple URL
        }

        throw new Error(`Failed to fetch contacts: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      if (data.value) {
        allContacts = allContacts.concat(data.value);
        console.log(`Fetched ${data.value.length} contacts, total: ${allContacts.length}`);
      }

      // Check if there's a next page
      // Note: If we're not using $select, nextLink might not have $select either
      url = data['@odata.nextLink'] || null;
    } while (url);

    console.log(`✓ Total contacts fetched from Outlook: ${allContacts.length}`);
    return allContacts;
  } catch (error) {
    console.error('Error fetching Outlook contacts:', error.message);
    throw error;
  }
}

/**
 * Sync contacts from Outlook
 */
async function syncContactsFromOutlook(sessionId) {
  const connection = getPool();

  try {
    console.log(`Syncing Outlook contacts for session: ${sessionId}...`);

    const accessToken = await getMicrosoftClient(sessionId);
    const outlookContacts = await fetchOutlookContacts(accessToken);

    let synced = 0;
    let updated = 0;
    let merged = 0;
    let skipped = 0;

    for (const contact of outlookContacts) {
      // Skip contacts without names
      if (!contact.displayName) {
        skipped++;
        continue;
      }

      const name = contact.displayName;

      // Get phone numbers (priority: mobilePhone > businessPhone > homePhone)
      const rawPhone = contact.mobilePhone || contact.businessPhone || contact.homePhone || null;

      if (!rawPhone) {
        skipped++;
        continue;
      }

      // Normalize phone number to international format
      const primaryPhone = normalizePhoneNumber(rawPhone);
      if (!primaryPhone) {
        console.log(`⚠️ Skipping invalid phone: ${rawPhone}`);
        skipped++;
        continue;
      }

      // Check if contact exists by phone (normalized)
      const [existing] = await connection.query(
        `SELECT * FROM contacts WHERE session_id = ? AND phone = ?`,
        [sessionId, primaryPhone]
      );

      if (existing.length > 0) {
        const existingContact = existing[0];

        // Update logic: change source to 'both' if not already, update name from Outlook
        const needsUpdate =
          existingContact.source !== 'both' ||
          existingContact.name !== name ||
          !existingContact.outlook_contact_id;

        if (needsUpdate) {
          const newSource = existingContact.source === 'outlook' ? 'outlook' : 'both';

          await connection.query(
            `UPDATE contacts
             SET source = ?,
                 outlook_contact_id = ?,
                 name = ?,
                 push_name = ?
             WHERE id = ?`,
            [newSource, contact.id, name, name, existingContact.id]
          );

          if (existingContact.source !== 'outlook') {
            merged++;
            console.log(`📝 Merged contact: phone=${primaryPhone}, name="${name}" (updated from "${existingContact.name}")`);
          } else {
            updated++;
            console.log(`🔄 Updated contact: phone=${primaryPhone}, name="${name}"`);
          }
        }
      } else {
        // Create new contact with source='outlook'
        const [result] = await connection.query(
          `INSERT INTO contacts (session_id, phone, name, outlook_contact_id, source)
           VALUES (?, ?, ?, ?, 'outlook')`,
          [sessionId, primaryPhone, name, contact.id]
        );

        synced++;
        console.log(`✓ Added new contact: phone=${primaryPhone}, name="${name}"`);
      }
    }

    console.log(`✓ Outlook contacts synced: ${synced} new, ${updated} updated, ${merged} merged, ${skipped} skipped`);
    return { synced, updated, merged, skipped, total: outlookContacts.length };
  } catch (error) {
    console.error('Error syncing Outlook contacts:', error);
    throw error;
  }
}

/**
 * Disconnect Microsoft account for a session
 */
async function disconnectMicrosoft(sessionId) {
  const connection = getPool();

  try {
    await connection.query(
      `DELETE FROM outlook_tokens WHERE session_id = ?`,
      [sessionId]
    );

    console.log(`✓ Microsoft disconnected for session: ${sessionId}`);
    return true;
  } catch (error) {
    console.error('Error disconnecting Microsoft:', error);
    throw error;
  }
}

export {
  getAuthUrl,
  handleOAuthCallback,
  getMicrosoftClient,
  isConnected,
  syncContactsFromOutlook,
  disconnectMicrosoft
};
