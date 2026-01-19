import { getPool, createDefaultLeadStatuses } from './database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import * as groupHandlers from './groupHandlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEDIA_BASE_PATH = path.join(__dirname, '../media');

/**
 * Download and save media file locally
 */
async function saveMediaLocally(rawMessage, messageId, messageType) {
  try {
    // Find the media message key (e.g., 'imageMessage', 'videoMessage', etc.)
    const mediaMessageKey = Object.keys(rawMessage.message || {}).find(k => k.endsWith('Message') && k !== 'conversation' && k !== 'extendedTextMessage');

    if (!mediaMessageKey) {
      console.log(`⚠️ No media message found in raw message`);
      return null;
    }

    // Extract media type from key (e.g., 'imageMessage' -> 'image')
    const mediaType = mediaMessageKey.replace('Message', '');
    const mediaContent = rawMessage.message[mediaMessageKey];

    console.log(`💾 Downloading media locally: ${mediaType}, messageId: ${messageId}`);
    console.log(`   Media message key: ${mediaMessageKey}`);

    // Create media directory if not exists
    const mediaDir = path.join(__dirname, '../media');
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }

    // Download media stream - pass the specific media message object, not the full raw message
    const stream = await downloadContentFromMessage(mediaContent, mediaType);

    // Convert stream to buffer
    const buffer = await streamToBuffer(stream);

    // Determine file extension based on media type and mimetype
    let ext = 'bin';
    if (mediaContent.mimetype) {
      const mimeToExt = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/ogg': 'ogg',
        'application/pdf': 'pdf',
      };
      ext = mimeToExt[mediaContent.mimetype] || mediaType.substring(0, 3);
    } else {
      const extMap = {
        'image': 'jpg',
        'video': 'mp4',
        'audio': 'mp3',
        'document': 'bin'
      };
      ext = extMap[mediaType] || 'bin';
    }

    // Save file
    const filename = `${messageId}.${ext}`;
    const filepath = path.join(mediaDir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`✓ Media saved locally: ${filename} (${(buffer.length / 1024).toFixed(2)} KB)`);
    return filename;
  } catch (error) {
    console.error('Error saving media locally:', error);
    return null;
  }
}

/**
 * Helper function to convert stream to buffer
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Normalize phone number to international format
 * - Removes all non-digit characters
 * - For Indonesian numbers starting with 0: removes 0 and adds 62
 * - Returns normalized international format or null if invalid
 */
function normalizePhoneNumber(phone, defaultCountryCode = '62') {
  if (!phone) return null;

  // Remove all non-digit characters
  let digitsOnly = phone.replace(/\D/g, '');

  // Skip empty numbers
  if (!digitsOnly || digitsOnly.length === 0) return null;

  // Handle Indonesian format: if starts with 0, replace with default country code
  // Example: 08388105401 -> 628388105401
  if (digitsOnly.startsWith('0')) {
    digitsOnly = defaultCountryCode + digitsOnly.substring(1);
    console.log(`📱 Normalized phone: ${phone} -> ${digitsOnly}`);
  }

  // Validate length: WhatsApp numbers are typically 10-15 digits
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    console.warn(`⚠️ Invalid phone number length: ${phone} (${digitsOnly.length} digits)`);
    return null;
  }

  return digitsOnly;
}

/**
 * Validate and normalize phone number (alias for compatibility)
 */
function validateAndNormalizePhone(phone) {
  return normalizePhoneNumber(phone);
}

/**
 * Handle incoming WhatsApp message
 * Saves contact and message to database, emits Socket.io event
 */
async function handleIncomingMessage(sessionId, message, sock, io, messageType = 'notify') {
  const connection = getPool();

  try {
    // Skip status broadcasts
    if (message.key.remoteJid?.includes('@broadcast')) {
      return;
    }

    // Check if this is a group message
    const isGroupMessage = message.key.remoteJid?.includes('@g.us');

    if (isGroupMessage) {
      // Handle group message - delegate to group handler
      await handleGroupMessage(sessionId, message, sock, io, messageType);
      return;
    }

    // Extract message data - LOG ALL FIELDS FOR DEBUGGING
    const remoteJid = message.key.remoteJid;
    const fromMe = message.key.fromMe;
    const participant = message.key.participant;
    const pushName = message.pushName;
    const messageKey = message.key;

    // Log ALL key fields to understand the structure
    console.log(`🔍 Message key fields:`, {
      message,
      messageKey,
      remoteJid,
      remoteJidAlt: messageKey.remoteJidAlt,
      fromMe,
      participant,
      pushName,
      messageId: message.key.id
    });

    // SOLUTION: Use remoteJidAlt for @lid JIDs (official Baileys solution!)
    // remoteJidAlt contains the REAL JID when remoteJid is @lid
    let actualJid = remoteJid;

    // Check if this is an @lid JID (invalid JID from other devices)
    const isLidJid = remoteJid?.endsWith('@lid');

    if (isLidJid) {
      console.log(`⚠️ @lid JID detected in remoteJid - checking remoteJidAlt`);

      // STRATEGY 1: Use remoteJidAlt if available (OFFICIAL SOLUTION!)
      if (messageKey.remoteJidAlt && messageKey.remoteJidAlt.endsWith('@s.whatsapp.net')) {
        actualJid = messageKey.remoteJidAlt;
        console.log(`✅ Found REAL JID in remoteJidAlt: ${actualJid}`);
      }
      // STRATEGY 2: Use pushName to find existing contact (fallback)
      else if (pushName) {
        console.log(`🔍 No remoteJidAlt - will use pushName "${pushName}" to match contact`);
      }
      else {
        console.warn(`⚠️ No remoteJidAlt and no pushName - cannot find real JID`);
      }
    }

    let phone = actualJid.split('@')[0];

    // Skip status messages
    if (phone === 'status') {
      return;
    }

    // For @lid JIDs without real JID found (no remoteJidAlt), we'll use the pushName
    let useLidWorkaround = isLidJid && !actualJid.endsWith('@s.whatsapp.net');

    // Only validate phone if it's not a @lid workaround
    if (!useLidWorkaround) {
      const normalizedPhone = validateAndNormalizePhone(phone);
      if (!normalizedPhone) {
        console.warn(`⚠️ Skipping message with invalid phone: ${phone}`);
        return;
      }
      phone = normalizedPhone;
    } else {
      console.log(`⚠️ @lid JID with no remoteJidAlt - using pushName "${pushName}" workaround`);
    }

    // Extract content and media URL
    let messageContent = message.message?.conversation ||
                          message.message?.extendedTextMessage?.text ||
                          '[Media]';
    let mediaUrl = null;

    // Extract media URL for different message types
    const msgType = getMessageType(message);

    // Handle protocolMessage (REVOKE - delete message)
    if (msgType === 'protocol') {
      const protoMsg = message.message?.protocolMessage;

      // Debug log
      console.log(`🔍 Protocol message detected:`, {
        type: protoMsg?.type,
        typeValue: protoMsg?.type?.valueOf(),
        hasKey: !!protoMsg?.key,
        keyId: protoMsg?.key?.id
      });

      if (protoMsg?.type === 0 || protoMsg?.type === 'REVOKE') {
        // Type 0 = REVOKE in Baileys
        const revokedMessageId = protoMsg.key?.id;

        if (revokedMessageId) {
          console.log(`🗑️ Message revoke detected: ${revokedMessageId}`);

          // Get the deleted message's contact_id first
          const [deletedMsg] = await connection.query(
            `SELECT contact_id FROM messages WHERE message_id = ? AND session_id = ?`,
            [revokedMessageId, sessionId]
          );

          if (deletedMsg.length > 0) {
            const contactId = deletedMsg[0].contact_id;

            // Update the deleted message in database
            await connection.query(
              `UPDATE messages SET content = '[This message was deleted]', is_deleted = TRUE WHERE message_id = ? AND session_id = ?`,
              [revokedMessageId, sessionId]
            );

            console.log(`✓ Message marked as deleted: ${revokedMessageId}`);

            // Emit Socket.io event for real-time update
            if (io && messageType === 'notify') {
              io.emit('chat.messageDeleted', {
                sessionId,
                messageId: revokedMessageId,
                contactId: contactId
              });
            }
          } else {
            console.log(`⚠️ Deleted message not found in database: ${revokedMessageId}`);
          }
        }
      } else {
        console.log(`ℹ️ Protocol message type: ${protoMsg?.type} (not REVOKE)`);
      }

      // Don't save any protocol messages to database
      return;
    }

    if (msgType !== 'text' && msgType !== 'location' && msgType !== 'contact') {
      // For image messages
      if (message.message?.imageMessage) {
        const imgMsg = message.message.imageMessage;
        messageContent = imgMsg.caption || '[Image]';
        mediaUrl = imgMsg.url || null;
      }
      // For video messages
      else if (message.message?.videoMessage) {
        const vidMsg = message.message.videoMessage;
        messageContent = vidMsg.caption || '[Video]';
        mediaUrl = vidMsg.url || null;
      }
      // For audio messages
      else if (message.message?.audioMessage) {
        mediaUrl = message.message.audioMessage.url || null;
      }
      // For document messages
      else if (message.message?.documentMessage) {
        const docMsg = message.message.documentMessage;
        messageContent = docMsg.caption || docMsg.fileName || '[Document]';
        mediaUrl = docMsg.url || null;
      }
    }

    const timestamp = new Date(message.messageTimestamp * 1000);
    const isFromMe = fromMe;
    const direction = isFromMe ? 'outgoing' : 'incoming';

    // Log for debugging
    console.log(`📨 Processing message: phone=${phone}, fromMe=${isFromMe}, direction=${direction}, type=${messageType}`);
    console.log(`   actualJid: ${actualJid}, remoteJid: ${remoteJid}, useLidWorkaround: ${useLidWorkaround}`);
    if (isLidJid) {
      console.log(`   Used remoteJidAlt: ${messageKey.remoteJidAlt || 'N/A'}`);
    }

    // Get or create contact (with @lid workaround if needed)
    // Don't use pushName for outgoing messages to avoid saving sender's own name as recipient's name
    const contact = await getOrCreateContact(sessionId, phone, isFromMe ? null : pushName, useLidWorkaround);

    console.log(`✓ Found/created contact: id=${contact.id}, phone=${contact.phone}, name=${contact.name}`);

    // Save message to database
    const messageId = message.key.id || `wa_${Date.now()}_${phone}`;

    // Check if message already exists (avoid duplicates from history sync)
    const [existing] = await connection.query(
      `SELECT id FROM messages WHERE message_id = ? AND session_id = ?`,
      [messageId, sessionId]
    );

    if (existing.length > 0) {
      // Message already exists, skip insertion
      console.log(`⚠️ Duplicate message skipped: ${messageId}`);
      return;
    }

    await connection.query(
      `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, media_url, raw_message, timestamp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, contact.id, messageId, direction, msgType, messageContent, mediaUrl, JSON.stringify(message), timestamp, isFromMe ? 'sent' : 'delivered']
    );

    // Download and save media locally if it's a media message
    let localMediaPath = null;
    if (msgType !== 'text' && msgType !== 'location' && msgType !== 'contact') {
      try {
        localMediaPath = await saveMediaLocally(message, messageId, msgType);
        if (localMediaPath) {
          // Update database with local media path
          await connection.query(
            `UPDATE messages SET media_url = ? WHERE message_id = ? AND session_id = ?`,
            [localMediaPath, messageId, sessionId]
          );
        }
      } catch (err) {
        console.error('Failed to save media locally:', err);
      }
    }

    // Update last_interaction_at for contact
    await connection.query(
      `UPDATE contacts SET last_interaction_at = ? WHERE id = ?`,
      [timestamp, contact.id]
    );

    // Emit Socket.io event for real-time update (only for new messages, not history sync)
    if (io && messageType === 'notify') {
      io.emit('chat.newMessage', {
        sessionId,
        message: {
          id: messageId,
          direction: direction,
          content: messageContent,
          type: msgType,
          mediaUrl: localMediaPath || mediaUrl,  // Use local path if available
          timestamp: timestamp.toISOString(),
          status: isFromMe ? 'sent' : 'delivered'
        },
        contact: {
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          source: contact.source,
          lastInteraction: timestamp.toISOString(),  // IMPORTANT: Include for sorting!
          lastMessage: {  // IMPORTANT: Include for message preview!
            content: messageContent,
            timestamp: timestamp.toISOString()
          },
          messageCount: (contact.messageCount || 0) + 1  // Increment message count
        }
      });
    }

    const logPrefix = messageType === 'notify' ? '✓ New message' : '✓ History message';
    console.log(`${logPrefix} saved: contact_id=${contact.id}, phone=${phone}, content=${messageContent.substring(0, 50)}`);
  } catch (error) {
    console.error('Error handling incoming message:', error);
    throw error;
  }
}

/**
 * Get or create contact by phone number or name
 * For messages from other devices with @lid JID, try to match by name first
 */
async function getOrCreateContact(sessionId, phone, name = null, useLidWorkaround = false) {
  const connection = getPool();

  try {
    console.log(`🔍 Looking for contact: phone=${phone}, sessionId=${sessionId}, name=${name}, useLidWorkaround=${useLidWorkaround}`);

    // Normalize phone number to international format
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      console.warn(`⚠️ Invalid phone number, cannot create contact: ${phone}`);
      // For @lid workaround without valid phone, still try to match by name
      if (!useLidWorkaround || !name) {
        throw new Error(`Invalid phone number: ${phone}`);
      }
    }

    // STRATEGY 1: If this is a @lid message (invalid JID from other device), try to match by name first
    if (useLidWorkaround && name) {
      console.log(`🔍 Using @lid workaround - searching by name: ${name}`);

      const [contactsByName] = await connection.query(
        `SELECT * FROM contacts WHERE session_id = ? AND (name = ? OR push_name = ?)`,
        [sessionId, name, name]
      );

      if (contactsByName.length > 0) {
        const contact = contactsByName[0];
        console.log(`✅ Found contact by NAME for @lid message: id=${contact.id}, phone=${contact.phone}, name=${contact.name}`);

        // Update phone if we have a normalized phone and existing contact has invalid/short phone
        if (normalizedPhone && (!contact.phone || contact.phone.length < normalizedPhone.length)) {
          await connection.query(
            `UPDATE contacts SET phone = ? WHERE id = ?`,
            [normalizedPhone, contact.id]
          );
          contact.phone = normalizedPhone;
          console.log(`📝 Updated contact phone to: ${normalizedPhone}`);
        }

        return contact;
      }
    }

    // STRATEGY 2: Try to find by phone number (normal behavior) - use normalized phone
    const [contacts] = await connection.query(
      `SELECT * FROM contacts WHERE session_id = ? AND phone = ?`,
      [sessionId, normalizedPhone]
    );

    if (contacts.length > 0) {
      const contact = contacts[0];
      console.log(`✅ Found existing contact: id=${contact.id}, phone=${contact.phone}, name=${contact.name}`);

      // Update name if provided and current name is null or is a phone number (placeholder)
      if (name && (!contact.name || contact.name === contact.phone)) {
        await connection.query(
          `UPDATE contacts SET name = ? WHERE id = ?`,
          [name, contact.id]
        );
        contact.name = name;
        console.log(`📝 Updated contact name to: ${name}`);
      }

      return contact;
    }

    // STRATEGY 3: For @lid messages with name, create new contact but mark it for potential merge
    if (useLidWorkaround && name) {
      console.log(`➕ Creating new contact from @lid message: phone=${normalizedPhone || phone}, name=${name}`);

      const [result] = await connection.query(
        `INSERT INTO contacts (session_id, phone, name, push_name, source)
         VALUES (?, ?, ?, ?, 'whatsapp')`,
        [sessionId, normalizedPhone || phone, name, name]
      );

      const newContact = {
        id: result.insertId,
        phone: normalizedPhone || phone,
        name: name || normalizedPhone || phone,
        source: 'whatsapp'
      };

      console.log(`✅ Created new contact from @lid: id=${newContact.id}, phone=${newContact.phone}, name=${newContact.name}`);

      return newContact;
    }

    // STRATEGY 4: Normal contact creation
    console.log(`➕ Creating new contact: phone=${normalizedPhone}, name=${name}`);
    const [result] = await connection.query(
      `INSERT INTO contacts (session_id, phone, name, push_name, source)
       VALUES (?, ?, ?, ?, 'whatsapp')`,
      [sessionId, normalizedPhone, name || normalizedPhone, name]
    );

    const newContact = {
      id: result.insertId,
      phone: normalizedPhone,
      name: name || normalizedPhone,
      source: 'whatsapp'
    };

    console.log(`✅ Created new contact: id=${newContact.id}, phone=${newContact.phone}, name=${newContact.name}`);

    return newContact;
  } catch (error) {
    console.error('Error getting/creating contact:', error);
    throw error;
  }
}

/**
 * Send message via WhatsApp (supports text, image, video)
 */
async function sendMessage(sessionId, sock, phone, content = '', messageType = 'text', mediaOptions = null) {
  const connection = getPool();

  try {
    // Check if this is a group message (contains @g.us)
    const isGroupMessage = phone.includes('@g.us');
    let jid;
    let contact = null;

    if (isGroupMessage) {
      // For group messages, use the JID directly
      jid = phone;
      console.log(`📤 Sending group message to: ${jid}`);
    } else {
      // For private messages, normalize phone number
      const normalizedPhone = normalizePhoneNumber(phone);
      if (!normalizedPhone) {
        throw new Error(`Invalid phone number: ${phone}`);
      }

      jid = `${normalizedPhone}@s.whatsapp.net`;
      contact = await getOrCreateContact(sessionId, normalizedPhone);
    }

    const supportsMedia = mediaOptions && ['image', 'video'].includes(messageType);
    const caption = typeof content === 'string' ? content : '';
    const displayContent = caption || (messageType === 'image' ? '[Image]' : messageType === 'video' ? '[Video]' : '');

    let payload;
    if (supportsMedia) {
      const mediaSource = mediaOptions.buffer
        || (mediaOptions.mediaPath ? fs.createReadStream(mediaOptions.mediaPath) : null);

      if (!mediaSource) {
        throw new Error('Media payload missing buffer or file path');
      }

      if (messageType === 'image') {
        payload = {
          image: mediaSource,
          caption: caption || undefined,
          mimetype: mediaOptions.mimetype
        };
      } else {
        payload = {
          video: mediaSource,
          caption: caption || undefined,
          mimetype: mediaOptions.mimetype
        };
      }
    } else {
      if (!caption) {
        throw new Error('Message content is required for text messages');
      }
      payload = { text: caption };
      messageType = 'text';
    }

    const sentMessage = await sock.sendMessage(jid, payload);

    const timestamp = new Date();
    const messageId = sentMessage.key.id;
    const mediaUrl = supportsMedia
      ? (mediaOptions.relativePath
          || (mediaOptions.mediaPath
            ? path.relative(MEDIA_BASE_PATH, mediaOptions.mediaPath).split(path.sep).join('/')
            : null))
      : null;

    // Store full sentMessage object for media download (includes mediaKey, etc.)
    const rawPayload = sentMessage;

    // For group messages, contact_id is NULL and we need group metadata
    const contactId = isGroupMessage ? null : contact.id;
    let groupId = null;
    let participantJid = null;
    let participantName = 'You';

    if (isGroupMessage) {
      // Extract group ID from JID (remove @g.us suffix)
      const groupIdWithoutSuffix = phone.replace('@g.us', '');

      // Get group from database
      const [groupData] = await connection.query(
        `SELECT id FROM whatsapp_groups WHERE session_id = ? AND group_id = ?`,
        [sessionId, groupIdWithoutSuffix]
      );

      if (groupData.length > 0) {
        groupId = groupData[0].id;
      }

      // Get participant info from our own session
      participantJid = null; // Will be filled by handleGroupMessage when receiving echo
      participantName = 'You';
    }

    // Build INSERT query dynamically based on whether it's a group message
    if (isGroupMessage && groupId) {
      // Group message with all metadata
      await connection.query(
        `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, media_url, raw_message, timestamp, status, is_group_message, group_id, participant_jid, participant_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          contactId,
          messageId,
          'outgoing',
          messageType,
          displayContent,
          mediaUrl,
          rawPayload ? JSON.stringify(rawPayload) : null,
          timestamp,
          'sent',
          true,
          groupId,
          participantJid,
          participantName
        ]
      );

      // Update last_interaction_at for group
      await connection.query(
        `UPDATE whatsapp_groups SET last_interaction_at = ? WHERE id = ?`,
        [timestamp, groupId]
      );
    } else {
      // Private message (or group without ID yet)
      await connection.query(
        `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, media_url, raw_message, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          contactId,
          messageId,
          'outgoing',
          messageType,
          displayContent,
          mediaUrl,
          rawPayload ? JSON.stringify(rawPayload) : null,
          timestamp,
          'sent'
        ]
      );

      // Update last_interaction_at for private messages only
      if (!isGroupMessage && contact) {
        await connection.query(
          `UPDATE contacts SET last_interaction_at = ? WHERE id = ?`,
          [timestamp, contact.id]
        );
      }
    }

    return {
      id: messageId,
      contactId: contactId,
      direction: 'outgoing',
      type: messageType,
      content: displayContent,
      mediaUrl,
      timestamp: timestamp.toISOString(),
      status: 'sent'
    };
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

/**
 * Get contacts with recent messages
 */
async function getContactsWithRecentMessages(sessionId, search = '', limit = 20) {
  const connection = getPool();

  try {
    let query = `
      SELECT DISTINCT
        c.*,
        (SELECT content FROM messages WHERE contact_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_content,
        (SELECT timestamp FROM messages WHERE contact_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages WHERE contact_id = c.id) as message_count
      FROM contacts c
      WHERE c.session_id = ?
    `;
    const params = [sessionId];

    if (search) {
      query += ` AND (c.name LIKE ? OR c.phone LIKE ?)`;
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam);
    }

    query += ` ORDER BY c.last_interaction_at DESC LIMIT ?`;
    params.push(limit);

    const [contacts] = await connection.query(query, params);

    return contacts.map(c => ({
      id: c.id,
      sessionId: c.session_id,
      phone: c.phone,
      name: c.name,
      profilePicUrl: c.profile_pic_url,
      source: c.source,
      leadStatusId: c.lead_status_id,
      lastInteraction: c.last_interaction_at,
      messageCount: c.message_count,
      lastMessage: {
        content: c.last_message_content,
        timestamp: c.last_message_time
      }
    }));
  } catch (error) {
    console.error('Error getting contacts:', error);
    throw error;
  }
}

/**
 * Get message history for a contact
 */
async function getContactHistory(sessionId, contactId, limit = 50) {
  const connection = getPool();

  try {
    const [messages] = await connection.query(
      `SELECT * FROM messages
       WHERE session_id = ? AND contact_id = ?
       ORDER BY timestamp ASC
       LIMIT ?`,
      [sessionId, contactId, limit]
    );

    return messages.map(m => ({
      id: m.id,
      messageId: m.message_id,
      direction: m.direction,
      type: m.message_type,
      content: m.content,
      mediaUrl: m.media_url,
      timestamp: m.timestamp,
      status: m.status,
      isDeleted: m.is_deleted
    }));
  } catch (error) {
    console.error('Error getting message history:', error);
    throw error;
  }
}

/**
 * Sync contacts from WhatsApp
 */
async function syncContactsFromWhatsApp(sessionId, sock) {
  const connection = getPool();

  try {
    console.log(`Syncing contacts for session: ${sessionId}...`);

    // Get contacts from Baileys
    // Note: This is a simplified version. In production, you might want to use
    // sock.fetchContacts() or similar method
    const contacts = Object.values(sock.store?.contacts || {});

    let synced = 0;
    let updated = 0;

    for (const [jid, contact] of Object.entries(contacts)) {
      // Skip non-user JIDs (groups, broadcasts, etc.)
      if (!jid.endsWith('@s.whatsapp.net')) continue;

      // Extract phone from JID and normalize (WhatsApp JIDs are already international format)
      const rawPhone = jid.split('@')[0];
      const phone = normalizePhoneNumber(rawPhone);

      if (!phone) {
        console.log(`⚠️ Skipping invalid WhatsApp JID: ${jid}`);
        continue;
      }

      const name = contact.name || contact.notify || contact.verifiedName || null;

      // Check if contact exists (using normalized phone)
      const [existing] = await connection.query(
        `SELECT id FROM contacts WHERE session_id = ? AND phone = ?`,
        [sessionId, phone]
      );

      if (existing.length > 0) {
        // Update name if missing
        if (name) {
          await connection.query(
            `UPDATE contacts SET name = ? WHERE id = ?`,
            [name, existing[0].id]
          );
          updated++;
        }
      } else {
        // Create new contact
        await connection.query(
          `INSERT INTO contacts (session_id, phone, name, push_name, source)
           VALUES (?, ?, ?, ?, 'whatsapp')`,
          [sessionId, phone, name, name]
        );
        synced++;
      }
    }

    console.log(`✓ Contacts synced: ${synced} new, ${updated} updated`);
    return { synced, updated };
  } catch (error) {
    console.error('Error syncing contacts:', error);
    throw error;
  }
}

/**
 * Handle history sync from WhatsApp
 * Processes messages, contacts, and chats from other devices
 */
async function handleHistorySync(sessionId, { chats, contacts, messages, syncType }, sock, io) {
  const connection = getPool();

  try {
    console.log(`📚 Processing history sync (${syncType}): ${messages?.length || 0} messages`);

    let processedMessages = 0;
    let skippedMessages = 0;
    let invalidMessages = 0;
    let processedContacts = 0;
    const updatedContactIds = new Set();

    // Process messages from history
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        try {
          // Check if this is a group message
          const isGroupMessage = msg.key.remoteJid?.includes('@g.us');

          if (isGroupMessage) {
            // Handle group messages through the group handler
            await handleGroupMessage(sessionId, msg, sock, io, 'append');
            processedMessages++;
            continue;
          }

          // Handle private messages
          // Get and validate phone number
          let phone = msg.key.remoteJid?.split('@')[0];
          const normalizedPhone = validateAndNormalizePhone(phone);

          if (!normalizedPhone) {
            console.warn(`⚠️ Skipping history message with invalid phone: ${phone}`);
            invalidMessages++;
            continue;
          }

          phone = normalizedPhone;

          // Get contact ID for this message
          const [contactData] = await connection.query(
            `SELECT id FROM contacts WHERE session_id = ? AND phone = ?`,
            [sessionId, phone]
          );

          if (contactData.length > 0) {
            updatedContactIds.add(contactData[0].id);
          }

          // Process message (will check for duplicates internally)
          await handleIncomingMessage(sessionId, msg, io, 'append');
          processedMessages++;
        } catch (error) {
          // Skip errors (likely duplicates or invalid)
          skippedMessages++;
        }
      }
    }

    // Process contacts from history
    if (contacts && contacts.length > 0) {
      for (const contact of contacts) {
        try {
          // Skip if no phone number
          if (!contact.id || !contact.id.endsWith('@s.whatsapp.net')) {
            continue;
          }

          let phone = contact.id.split('@')[0];
          const normalizedPhone = validateAndNormalizePhone(phone);

          if (!normalizedPhone) {
            console.warn(`⚠️ Skipping contact with invalid phone: ${phone}`);
            continue;
          }

          phone = normalizedPhone;

          const name = contact.name || contact.notify || contact.verifiedName || null;

          // Check if contact exists
          const [existing] = await connection.query(
            `SELECT id FROM contacts WHERE session_id = ? AND phone = ?`,
            [sessionId, phone]
          );

          if (existing.length === 0) {
            // Create new contact
            const [result] = await connection.query(
              `INSERT INTO contacts (session_id, phone, name, push_name, source)
               VALUES (?, ?, ?, ?, 'whatsapp')`,
              [sessionId, phone, name, name]
            );
            updatedContactIds.add(result.insertId);
            processedContacts++;
          } else {
            updatedContactIds.add(existing[0].id);
          }
        } catch (error) {
          console.error('Error processing contact from history:', error);
        }
      }
    }

    console.log(`✓ History sync complete: ${processedMessages} messages processed, ${skippedMessages} skipped, ${invalidMessages} invalid, ${processedContacts} contacts added`);

    // Emit Socket.io event to notify frontend
    if (io) {
      io.emit('chat.historySync', {
        sessionId,
        updatedContactIds: Array.from(updatedContactIds),
        stats: {
          processedMessages,
          skippedMessages,
          invalidMessages,
          processedContacts
        }
      });
    }

    return {
      processedMessages,
      skippedMessages,
      invalidMessages,
      processedContacts,
      updatedContactIds: Array.from(updatedContactIds)
    };
  } catch (error) {
    console.error('Error handling history sync:', error);
    throw error;
  }
}

/**
 * Update message status
 */
async function updateMessageStatus(sessionId, messageId, status) {
  const connection = getPool();

  try {
    await connection.query(
      `UPDATE messages SET status = ? WHERE message_id = ? AND session_id = ?`,
      [status, messageId, sessionId]
    );

    console.log(`✓ Message ${messageId} status updated to ${status}`);
  } catch (error) {
    console.error('Error updating message status:', error);
    throw error;
  }
}

/**
 * Sync message history for a specific contact from WhatsApp
 */
async function syncContactHistory(sessionId, sock, contactId, phone) {
  const connection = getPool();

  try {
    console.log(`Syncing message history for contact: ${phone}...`);

    // Get JID
    const jid = `${phone}@s.whatsapp.net`;

    // Get existing messages from database to avoid duplicates
    const [existingMessages] = await connection.query(
      `SELECT message_id FROM messages WHERE contact_id = ? AND session_id = ?`,
      [contactId, sessionId]
    );
    const existingMessageIds = new Set(existingMessages.map(m => m.message_id));

    // Fetch messages from Baileys store
    const storeMessages = sock.store?.messages || {};
    const chatMessages = storeMessages[jid] || {};

    let synced = 0;
    let skipped = 0;

    // Process messages from store
    for (const [msgId, msgData] of Object.entries(chatMessages)) {
      // Skip if already exists
      if (existingMessageIds.has(msgId)) {
        skipped++;
        continue;
      }

      const message = msgData.message;

      // Extract message data and media URL
      let messageContent = message?.conversation ||
                            message?.extendedTextMessage?.text ||
                            '[Media]';
      let mediaUrl = null;

      const messageType = getMessageType({ message });

      // Extract media URL for different message types
      if (messageType !== 'text' && messageType !== 'location' && messageType !== 'contact') {
        if (message?.imageMessage) {
          const imgMsg = message.imageMessage;
          messageContent = imgMsg.caption || '[Image]';
          mediaUrl = imgMsg.url || null;
        } else if (message?.videoMessage) {
          const vidMsg = message.videoMessage;
          messageContent = vidMsg.caption || '[Video]';
          mediaUrl = vidMsg.url || null;
        } else if (message?.audioMessage) {
          mediaUrl = message.audioMessage.url || null;
        } else if (message?.documentMessage) {
          const docMsg = message.documentMessage;
          messageContent = docMsg.caption || docMsg.fileName || '[Document]';
          mediaUrl = docMsg.url || null;
        }
      }

      if (!messageContent && !mediaUrl) continue;

      const timestamp = new Date(msgData.messageTimestamp * 1000);

      // Determine direction
      const isFromMe = message?.key?.fromMe || false;
      const direction = isFromMe ? 'outgoing' : 'incoming';

      // Insert into database
      await connection.query(
        `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, media_url, raw_message, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          contactId,
          msgId,
          direction,
          messageType,
          messageContent,
          mediaUrl,
          JSON.stringify(msgData),  // Store full msgData object (includes key, message, etc.)
          timestamp,
          isFromMe ? 'sent' : 'delivered'
        ]
      );

      synced++;
    }

    // Update last_interaction_at for contact
    await connection.query(
      `UPDATE contacts SET last_interaction_at = COALESCE(
        (SELECT MAX(timestamp) FROM messages WHERE contact_id = ?),
        contacts.last_interaction_at
       ) WHERE id = ?`,
      [contactId, contactId]
    );

    console.log(`✓ Message history synced: ${synced} new, ${skipped} skipped (duplicates)`);
    return { synced, skipped, total: synced + skipped };
  } catch (error) {
    console.error('Error syncing contact history:', error);
    throw error;
  }
}

/**
 * Get message type from Baileys message object
 */
function getMessageType(message) {
  if (message.message?.imageMessage) return 'image';
  if (message.message?.videoMessage) return 'video';
  if (message.message?.audioMessage) return 'audio';
  if (message.message?.documentMessage) return 'document';
  if (message.message?.locationMessage) return 'location';
  if (message.message?.contactMessage) return 'contact';
  if (message.message?.protocolMessage) return 'protocol';
  return 'text';
}

/**
 * Handle incoming group message
 */
async function handleGroupMessage(sessionId, message, sock, io, messageType = 'notify') {
  const connection = getPool();

  try {
    const remoteJid = message.key.remoteJid;
    const fromMe = message.key.fromMe;
    const participantJid = message.key.participant || null;
    const pushName = message.pushName || 'Unknown';
    const messageId = message.key.id;

    console.log(`👥 Processing group message:`);
    console.log(`   - Group JID: ${remoteJid}`);
    console.log(`   - Message ID: ${messageId}`);
    console.log(`   - From Me: ${fromMe}`);
    console.log(`   - Type: ${messageType}`);
    console.log(`   - Participant: ${participantJid}`);
    console.log(`   - Push Name: ${pushName}`);
    console.log(`📋 FULL MESSAGE JSON:`);
    console.log(JSON.stringify(message, null, 2));

    // Upsert group - fetch/update metadata from WhatsApp
    const groupIdWithoutSuffix = remoteJid.replace('@g.us', '');

    // Check if group exists first
    const [existingGroup] = await connection.query(
      `SELECT * FROM whatsapp_groups WHERE session_id = ? AND group_id = ?`,
      [sessionId, groupIdWithoutSuffix]
    );

    let group;
    let shouldFetchMetadata = true;

    if (existingGroup.length > 0) {
      // Group exists - check if we need to refresh metadata
      const existingGroupData = existingGroup[0];
      const lastUpdate = existingGroupData.updated_at || existingGroupData.created_at;
      const now = new Date();
      const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

      // Always fetch metadata to ensure group name is up-to-date
      console.log(`   - Existing group found: ${existingGroupData.subject} (ID: ${existingGroupData.id}, updated ${hoursSinceUpdate.toFixed(1)}h ago)`);
    }

    // Always fetch metadata from WhatsApp for groups
    if (shouldFetchMetadata) {
      console.log(`   - Fetching group metadata from WhatsApp...`);
      try {
        const groupMeta = await sock.groupMetadata(remoteJid);
        console.log(`   - Group metadata received: ${groupMeta.subject}`);

        const groupMetadata = {
          id: remoteJid,
          subject: groupMeta.subject || null,
          participantCount: groupMeta.participants?.length || 0,
          description: groupMeta.desc || null,
          profilePicUrl: groupMeta.profilePicUrl || null
        };

        group = await groupHandlers.upsertGroup(sessionId, groupMetadata);

        // Always sync participants to keep them up-to-date
        if (groupMeta.participants && groupMeta.participants.length > 0) {
          await groupHandlers.syncGroupParticipants(group.id, groupMeta.participants);
          console.log(`   - Synced ${groupMeta.participants.length} participants`);
        }

        console.log(`   - Group synced: ${group.subject} (ID: ${group.id})`);
      } catch (metaError) {
        console.error(`   - Failed to fetch group metadata: ${metaError.message}`);

        // Fallback: use existing group if available, or create with minimal metadata
        if (existingGroup && existingGroup.length > 0) {
          group = {
            id: existingGroup[0].id,
            group_id: existingGroup[0].group_id,
            subject: existingGroup[0].subject,
            participantCount: existingGroup[0].participant_count,
            category: existingGroup[0].category
          };
          console.log(`   - Using existing group data: ${group.subject}`);
        } else {
          const groupMetadata = {
            id: remoteJid,
            subject: null,
            participantCount: 0,
            description: null,
            profilePicUrl: null
          };

          group = await groupHandlers.upsertGroup(sessionId, groupMetadata);
          console.log(`   - New group created with minimal data: ${group.subject} (ID: ${group.id})`);
        }
      }
    }

    // Extract message content
    let messageContent = message.message?.conversation ||
                          message.message?.extendedTextMessage?.text ||
                          '[Media]';
    let mediaUrl = null;

    const msgType = getMessageType(message);

    // Handle protocolMessage (REVOKE - delete message)
    if (msgType === 'protocol') {
      const protoMsg = message.message?.protocolMessage;

      if (protoMsg?.type === 0 || protoMsg?.type === 'REVOKE') {
        const revokedMessageId = protoMsg.key?.id;

        if (revokedMessageId) {
          console.log(`🗑️ Group message revoke detected: ${revokedMessageId}`);

          await connection.query(
            `UPDATE messages SET content = '[This message was deleted]', is_deleted = TRUE WHERE message_id = ? AND session_id = ? AND group_id = ?`,
            [revokedMessageId, sessionId, group.id]
          );

          if (io && messageType === 'notify') {
            io.emit('chat.groupMessageDeleted', {
              sessionId,
              groupId: group.id,
              messageId: revokedMessageId
            });
          }
        }
      }

      return;
    }

    // Extract media for non-text messages
    if (msgType !== 'text' && msgType !== 'location' && msgType !== 'contact') {
      if (message.message?.imageMessage) {
        const imgMsg = message.message.imageMessage;
        messageContent = imgMsg.caption || '[Image]';
        mediaUrl = imgMsg.url || null;
      } else if (message.message?.videoMessage) {
        const vidMsg = message.message.videoMessage;
        messageContent = vidMsg.caption || '[Video]';
        mediaUrl = vidMsg.url || null;
      } else if (message.message?.audioMessage) {
        mediaUrl = message.message.audioMessage.url || null;
      } else if (message.message?.documentMessage) {
        const docMsg = message.message.documentMessage;
        messageContent = docMsg.caption || docMsg.fileName || '[Document]';
        mediaUrl = docMsg.url || null;
      }
    }

    const timestamp = new Date(message.messageTimestamp * 1000);
    const direction = fromMe ? 'outgoing' : 'incoming';
    const participantName = fromMe ? 'You' : pushName;

    console.log(`   - Message extracted: type=${msgType}, direction=${direction}, content="${messageContent}"`);

    // Check if message already exists
    const [existing] = await connection.query(
      `SELECT id FROM messages WHERE message_id = ? AND session_id = ? AND group_id = ?`,
      [messageId, sessionId, group.id]
    );

    if (existing.length > 0) {
      console.log(`⚠️ Duplicate group message skipped: ${messageId}`);
      return;
    }

    // Save group message
    let insertedId;
    try {
      const [result] = await connection.query(
        `INSERT INTO messages (
          session_id, contact_id, message_id, direction, message_type, content, media_url,
          raw_message, timestamp, status, is_group_message, group_id, participant_jid, participant_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          null, // contact_id is NULL for group messages (not linked to individual contact)
          messageId,
          direction,
          msgType,
          messageContent,
          mediaUrl,
          JSON.stringify(message),
          timestamp,
          fromMe ? 'sent' : 'delivered',
          true,
          group.id,
          participantJid,
          participantName
        ]
      );

      insertedId = result.insertId;

      console.log(`✓ Group message saved to DB:`);
      console.log(`   - Content: ${messageContent}`);
      console.log(`   - Type: ${msgType}`);
      console.log(`   - Direction: ${direction}`);
      console.log(`   - From: ${participantName}`);
    } catch (insertError) {
      // Ignore duplicate entry errors (message already inserted by sendMessage)
      if (insertError.code === 'ER_DUP_ENTRY') {
        console.log(`⚠️ Duplicate group message (already sent): ${messageId}`);
        return;
      }
      throw insertError;
    }

    // Download and save media locally if it's a media message (same as private chat)
    if (msgType !== 'text' && msgType !== 'location' && msgType !== 'contact') {
      try {
        console.log(`💾 Saving media locally for group message: ${msgType}`);
        const localMediaPath = await saveMediaLocally(message, messageId, msgType);
        if (localMediaPath) {
          // Update database with local media path
          await connection.query(
            `UPDATE messages SET media_url = ? WHERE id = ?`,
            [localMediaPath, insertedId]
          );
          console.log(`✓ Media saved locally: ${localMediaPath}`);
        }
      } catch (mediaError) {
        console.error('Failed to save media locally:', mediaError);
      }
    }

    // Update last_interaction_at for group
    await connection.query(
      `UPDATE whatsapp_groups SET last_interaction_at = ? WHERE id = ?`,
      [timestamp, group.id]
    );

    // Emit Socket.io event for real-time update
    // Emit for:
    // - New incoming messages from others (!fromMe && messageType === 'notify')
    // - Our own outgoing messages (fromMe && messageType === 'append' - these are echoes of our sent messages)
    const shouldEmit = io && (
      (!fromMe && messageType === 'notify') ||  // New message from others
      (fromMe && messageType === 'append')       // Echo of our sent message
    );

    console.log(`📡 Socket.io emit: ${shouldEmit ? 'YES' : 'NO'} (fromMe=${fromMe}, type=${messageType})`);

    if (shouldEmit) {
      const eventData = {
        sessionId,
        groupId: group.id,
        group: {
          id: group.id,
          subject: group.subject,
          participantCount: group.participantCount,
          category: group.category
        },
        message: {
          id: messageId,
          direction: direction,
          content: messageContent,
          type: msgType,
          mediaUrl: mediaUrl,
          timestamp: timestamp.toISOString(),
          status: fromMe ? 'sent' : 'delivered',
          senderName: participantName,
          senderJid: participantJid
        }
      };

      console.log(`📡 Emitting event: chat.newGroupMessage`);
      console.log(`   - Group: ${group.subject} (${group.id})`);
      console.log(`   - Message: ${messageContent}`);

      io.emit('chat.newGroupMessage', eventData);
    }

    const logPrefix = messageType === 'notify' ? '✓ New group message' : '✓ Group history message';
    console.log(`${logPrefix} saved: group_id=${group.id}, group=${remoteJid}, content=${messageContent.substring(0, 50)}`);
  } catch (error) {
    console.error('Error handling group message:', error);
    throw error;
  }
}

export {
  handleIncomingMessage,
  handleHistorySync,
  getOrCreateContact,
  sendMessage,
  getContactsWithRecentMessages,
  getContactHistory,
  syncContactsFromWhatsApp,
  syncContactHistory,
  updateMessageStatus,
  getMessageType,
  normalizePhoneNumber,
  validateAndNormalizePhone
};
