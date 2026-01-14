const { getPool, createDefaultLeadStatuses } = require('./database');

/**
 * Handle incoming WhatsApp message
 * Saves contact and message to database, emits Socket.io event
 */
async function handleIncomingMessage(sessionId, message, io) {
  const connection = getPool();

  try {
    // Extract message data
    const remoteJid = message.key.remoteJid;
    const phone = remoteJid.split('@')[0];
    const messageContent = message.message?.conversation ||
                          message.message?.extendedTextMessage?.text ||
                          message.message?.imageMessage?.caption ||
                          '[Media]';
    const messageType = getMessageType(message);
    const timestamp = new Date(message.messageTimestamp * 1000);

    // Get or create contact
    const contact = await getOrCreateContact(sessionId, phone, message.pushName);

    // Save message to database
    const messageId = message.key.id || `wa_${Date.now()}_${phone}`;

    await connection.query(
      `INSERT INTO messages (session_id, contact_id, message_id, direction, message_type, content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, contact.id, messageId, 'incoming', messageType, messageContent, timestamp]
    );

    // Update last_interaction_at for contact
    await connection.query(
      `UPDATE contacts SET last_interaction_at = ? WHERE id = ?`,
      [timestamp, contact.id]
    );

    // Emit Socket.io event for real-time update
    if (io) {
      io.emit('chat.newMessage', {
        sessionId,
        message: {
          id: messageId,
          direction: 'incoming',
          content: messageContent,
          type: messageType,
          timestamp: timestamp.toISOString(),
          status: 'delivered'
        },
        contact: {
          id: contact.id,
          phone: contact.phone,
          name: contact.name,
          source: contact.source
        }
      });
    }

    console.log(`✓ Incoming message saved: ${phone} - ${messageContent.substring(0, 50)}`);
  } catch (error) {
    console.error('Error handling incoming message:', error);
    throw error;
  }
}

/**
 * Get or create contact by phone number
 */
async function getOrCreateContact(sessionId, phone, name = null) {
  const connection = getPool();

  try {
    // Check if contact exists
    const [contacts] = await connection.query(
      `SELECT * FROM contacts WHERE session_id = ? AND phone = ?`,
      [sessionId, phone]
    );

    if (contacts.length > 0) {
      const contact = contacts[0];

      // Update name if provided and current name is null
      if (name && !contact.name) {
        await connection.query(
          `UPDATE contacts SET name = ? WHERE id = ?`,
          [name, contact.id]
        );
        contact.name = name;
      }

      return contact;
    }

    // Create new contact
    const [result] = await connection.query(
      `INSERT INTO contacts (session_id, phone, name, push_name, source)
       VALUES (?, ?, ?, ?, 'whatsapp')`,
      [sessionId, phone, name || phone, name]
    );

    return {
      id: result.insertId,
      phone,
      name: name || phone,
      source: 'whatsapp'
    };
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
    // Normalize phone number
    const normalizedPhone = phone.replace(/\D/g, '');
    const jid = `${normalizedPhone}@s.whatsapp.net`;

    // Get or create contact
    const contact = await getOrCreateContact(sessionId, phone);

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

      const phone = jid.split('@')[0];
      const name = contact.name || contact.notify || contact.verifiedName || null;

      // Check if contact exists
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
  getOrCreateContact,
  sendMessage,
  getContactsWithRecentMessages,
  getContactHistory,
  syncContactsFromWhatsApp,
  updateMessageStatus,
  getMessageType
};
