const { getPool, createDefaultLeadStatuses } = require('./database');

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
async function handleIncomingMessage(sessionId, message, io, messageType = 'notify') {
  const connection = getPool();

  try {
    // Skip if message is from a group (contains @g.us in JID)
    if (message.key.remoteJid?.includes('@g.us')) {
      return;
    }

    // Skip status broadcasts
    if (message.key.remoteJid?.includes('@broadcast')) {
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

    const messageContent = message.message?.conversation ||
                          message.message?.extendedTextMessage?.text ||
                          message.message?.imageMessage?.caption ||
                          '[Media]';
    const msgType = getMessageType(message);
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
    const contact = await getOrCreateContact(sessionId, phone, pushName, useLidWorkaround);

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
      `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, timestamp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, contact.id, messageId, direction, msgType, messageContent, timestamp, isFromMe ? 'sent' : 'delivered']
    );

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

      // Update name if provided and current name is null
      if (name && !contact.name) {
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
 * Send message via WhatsApp
 */
async function sendMessage(sessionId, sock, phone, content, messageType = 'text') {
  const connection = getPool();

  try {
    // Normalize phone number for consistency
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      throw new Error(`Invalid phone number: ${phone}`);
    }

    const jid = `${normalizedPhone}@s.whatsapp.net`;

    // Get or create contact (will normalize again internally, which is fine)
    const contact = await getOrCreateContact(sessionId, normalizedPhone);

    // Send message via Baileys
    const sentMessage = await sock.sendMessage(jid, { text: content });

    // Save to database
    const timestamp = new Date();
    const messageId = sentMessage.key.id;

    await connection.query(
      `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, timestamp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, contact.id, messageId, 'outgoing', messageType, content, timestamp, 'sent']
    );

    // Update last_interaction_at for contact
    await connection.query(
      `UPDATE contacts SET last_interaction_at = ? WHERE id = ?`,
      [timestamp, contact.id]
    );

    return {
      id: messageId,
      contactId: contact.id,
      direction: 'outgoing',
      content,
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
       WHERE session_id = ? AND contact_id = ? AND is_deleted = FALSE
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
      status: m.status
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
async function handleHistorySync(sessionId, { chats, contacts, messages, syncType }, io) {
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
          // Skip group messages
          if (msg.key.remoteJid?.includes('@g.us')) {
            continue;
          }

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

      // Extract message data
      const messageContent = message?.conversation ||
                            message?.extendedTextMessage?.text ||
                            message?.imageMessage?.caption ||
                            '[Media]';

      if (!messageContent) continue;

      const messageType = getMessageType({ message });
      const timestamp = new Date(msgData.messageTimestamp * 1000);

      // Determine direction
      const isFromMe = message?.key?.fromMe || false;
      const direction = isFromMe ? 'outgoing' : 'incoming';

      // Insert into database
      await connection.query(
        `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, timestamp, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          contactId,
          msgId,
          direction,
          messageType,
          messageContent,
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
  return 'text';
}

module.exports = {
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
