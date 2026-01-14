const express = require('express');
const router = express.Router();
const { getPool, createDefaultLeadStatuses } = require('./database');
const chatHandlers = require('./chatHandlers');

/**
 * GET /api/contacts
 * List contacts with filters
 */
router.get('/contacts', async (req, res) => {
  try {
    const { sessionId, search, limit = 20, statusId, tagId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();
    let query = `
      SELECT DISTINCT
        c.*,
        ls.name as lead_status_name, ls.color as lead_status_color,
        (SELECT content FROM messages WHERE contact_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_content,
        (SELECT timestamp FROM messages WHERE contact_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages WHERE contact_id = c.id) as message_count,
        (SELECT GROUP_CONCAT(t.id) FROM contact_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.contact_id = c.id) as tag_ids
      FROM contacts c
      LEFT JOIN lead_statuses ls ON c.lead_status_id = ls.id
      WHERE c.session_id = ?
    `;
    const params = [sessionId];

    if (search) {
      query += ` AND (c.name LIKE ? OR c.phone LIKE ?)`;
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam);
    }

    if (statusId) {
      query += ` AND c.lead_status_id = ?`;
      params.push(statusId);
    }

    if (tagId) {
      query += ` AND c.id IN (SELECT contact_id FROM contact_tags WHERE tag_id = ?)`;
      params.push(tagId);
    }

    query += ` ORDER BY c.last_interaction_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    const [contacts] = await connection.query(query, params);

    res.json({
      contacts: contacts.map(c => ({
        id: c.id,
        sessionId: c.session_id,
        phone: c.phone,
        name: c.name,
        profilePicUrl: c.profile_pic_url,
        source: c.source,
        googleContactId: c.google_contact_id,
        leadStatus: c.lead_status_id ? {
          id: c.lead_status_id,
          name: c.lead_status_name,
          color: c.lead_status_color
        } : null,
        tagIds: c.tag_ids ? c.tag_ids.split(',').map(Number) : [],
        lastInteraction: c.last_interaction_at,
        messageCount: c.message_count,
        lastMessage: {
          content: c.last_message_content,
          timestamp: c.last_message_time
        }
      }))
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

/**
 * GET /api/contacts/:contactId
 * Get contact details with tags, notes, status
 */
router.get('/contacts/:contactId', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Get contact
    const [contacts] = await connection.query(
      `SELECT c.*, ls.name as lead_status_name, ls.color as lead_status_color
       FROM contacts c
       LEFT JOIN lead_statuses ls ON c.lead_status_id = ls.id
       WHERE c.id = ? AND c.session_id = ?`,
      [contactId, sessionId]
    );

    if (contacts.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const contact = contacts[0];

    // Get tags
    const [tags] = await connection.query(
      `SELECT t.id, t.name, t.color FROM tags t
       JOIN contact_tags ct ON t.id = ct.tag_id
       WHERE ct.contact_id = ?`,
      [contactId]
    );

    // Get notes
    const [notes] = await connection.query(
      `SELECT * FROM notes WHERE contact_id = ? ORDER BY created_at DESC`,
      [contactId]
    );

    res.json({
      contact: {
        id: contact.id,
        sessionId: contact.session_id,
        phone: contact.phone,
        name: contact.name,
        profilePicUrl: contact.profile_pic_url,
        source: contact.source,
        googleContactId: contact.google_contact_id,
        leadStatus: contact.lead_status_id ? {
          id: contact.lead_status_id,
          name: contact.lead_status_name,
          color: contact.lead_status_color
        } : null,
        tags: tags,
        notes: notes,
        lastInteraction: contact.last_interaction_at,
        createdAt: contact.created_at
      }
    });
  } catch (error) {
    console.error('Error fetching contact details:', error);
    res.status(500).json({ error: 'Failed to fetch contact details' });
  }
});

/**
 * GET /api/contacts/:contactId/messages
 * Get message history for contact
 */
router.get('/contacts/:contactId/messages', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId, limit = 50 } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const messages = await chatHandlers.getContactHistory(sessionId, contactId, parseInt(limit));

    res.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * POST /api/chat/send
 * Send message from chat UI
 */
router.post('/chat/send', async (req, res) => {
  try {
    const { sessionId, phone, content, type = 'text' } = req.body;

    if (!sessionId || !phone || !content) {
      return res.status(400).json({ error: 'sessionId, phone, and content are required' });
    }

    // Get socket from sessions map (will be available after integration with index.js)
    const sessions = req.app.get('sessions');
    const session = sessions.get(sessionId);

    if (!session || !session.sock) {
      return res.status(404).json({ error: 'Session not found or not connected' });
    }

    const result = await chatHandlers.sendMessage(sessionId, session.sock, phone, content, type);

    res.json({ success: true, message: result });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * POST /api/contacts/:contactId/tags
 * Add tag to contact
 */
router.post('/contacts/:contactId/tags', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId, tagId, name, color } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    let finalTagId = tagId;

    // Create tag if not exists
    if (!finalTagId && name) {
      const [result] = await connection.query(
        `INSERT IGNORE INTO tags (session_id, name, color) VALUES (?, ?, ?)`,
        [sessionId, name, color || '#06b6d4']
      );
      finalTagId = result.insertId;
    }

    if (!finalTagId) {
      return res.status(400).json({ error: 'tagId or name is required' });
    }

    // Associate tag with contact
    await connection.query(
      `INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)`,
      [contactId, finalTagId]
    );

    res.json({ success: true, tagId: finalTagId });
  } catch (error) {
    console.error('Error adding tag to contact:', error);
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

/**
 * DELETE /api/contacts/:contactId/tags/:tagId
 * Remove tag from contact
 */
router.delete('/contacts/:contactId/tags/:tagId', async (req, res) => {
  try {
    const { contactId, tagId } = req.params;

    const connection = getPool();
    await connection.query(
      `DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?`,
      [contactId, tagId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing tag from contact:', error);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

/**
 * PUT /api/contacts/:contactId/status
 * Update lead status
 */
router.put('/contacts/:contactId/status', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId, statusId } = req.body;

    if (!sessionId || !statusId) {
      return res.status(400).json({ error: 'sessionId and statusId are required' });
    }

    const connection = getPool();
    await connection.query(
      `UPDATE contacts SET lead_status_id = ? WHERE id = ? AND session_id = ?`,
      [statusId, contactId, sessionId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating lead status:', error);
    res.status(500).json({ error: 'Failed to update lead status' });
  }
});

/**
 * GET /api/tags
 * List all tags for session
 */
router.get('/tags', async (req, res) => {
  try {
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();
    const [tags] = await connection.query(
      `SELECT t.*, COUNT(ct.contact_id) as usage_count
       FROM tags t
       LEFT JOIN contact_tags ct ON t.id = ct.tag_id
       WHERE t.session_id = ?
       GROUP BY t.id
       ORDER BY t.name`,
      [sessionId]
    );

    res.json({ tags });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

/**
 * POST /api/tags
 * Create new tag
 */
router.post('/tags', async (req, res) => {
  try {
    const { sessionId, name, color } = req.body;

    if (!sessionId || !name) {
      return res.status(400).json({ error: 'sessionId and name are required' });
    }

    const connection = getPool();
    const [result] = await connection.query(
      `INSERT INTO tags (session_id, name, color) VALUES (?, ?, ?)`,
      [sessionId, name, color || '#06b6d4']
    );

    res.json({ success: true, tagId: result.insertId });
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

/**
 * GET /api/lead-statuses
 * List all lead statuses for session
 */
router.get('/lead-statuses', async (req, res) => {
  try {
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();
    const [statuses] = await connection.query(
      `SELECT * FROM lead_statuses WHERE session_id = ? ORDER BY order_index`,
      [sessionId]
    );

    res.json({ statuses });
  } catch (error) {
    console.error('Error fetching lead statuses:', error);
    res.status(500).json({ error: 'Failed to fetch lead statuses' });
  }
});

/**
 * POST /api/lead-statuses
 * Create new lead status
 */
router.post('/lead-statuses', async (req, res) => {
  try {
    const { sessionId, name, color, orderIndex } = req.body;

    if (!sessionId || !name) {
      return res.status(400).json({ error: 'sessionId and name are required' });
    }

    const connection = getPool();
    const [result] = await connection.query(
      `INSERT INTO lead_statuses (session_id, name, color, order_index) VALUES (?, ?, ?, ?)`,
      [sessionId, name, color || '#94a3b8', orderIndex || 0]
    );

    res.json({ success: true, statusId: result.insertId });
  } catch (error) {
    console.error('Error creating lead status:', error);
    res.status(500).json({ error: 'Failed to create lead status' });
  }
});

/**
 * GET /api/contacts/:contactId/notes
 * Get notes for contact
 */
router.get('/contacts/:contactId/notes', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();
    const [notes] = await connection.query(
      `SELECT * FROM notes WHERE contact_id = ? AND session_id = ? ORDER BY created_at DESC`,
      [contactId, sessionId]
    );

    res.json({ notes });
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

/**
 * POST /api/contacts/:contactId/notes
 * Add note to contact
 */
router.post('/contacts/:contactId/notes', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId, content } = req.body;

    if (!sessionId || !content) {
      return res.status(400).json({ error: 'sessionId and content are required' });
    }

    const connection = getPool();
    const [result] = await connection.query(
      `INSERT INTO notes (contact_id, session_id, content) VALUES (?, ?, ?)`,
      [contactId, sessionId, content]
    );

    const [notes] = await connection.query(`SELECT * FROM notes WHERE id = ?`, [result.insertId]);

    res.json({ success: true, note: notes[0] });
  } catch (error) {
    console.error('Error creating note:', error);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

/**
 * PUT /api/notes/:noteId
 * Update note
 */
router.put('/notes/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    const connection = getPool();
    await connection.query(
      `UPDATE notes SET content = ? WHERE id = ?`,
      [content, noteId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

/**
 * DELETE /api/notes/:noteId
 * Delete note
 */
router.delete('/notes/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;

    const connection = getPool();
    await connection.query(`DELETE FROM notes WHERE id = ?`, [noteId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

/**
 * POST /api/contacts/:contactId/sync-history
 * Sync message history for a contact from WhatsApp
 */
router.post('/contacts/:contactId/sync-history', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    // Get socket from sessions map
    const sessions = req.app.get('sessions');
    const session = sessions.get(sessionId);

    if (!session || !session.sock) {
      return res.status(404).json({ error: 'Session not found or not connected' });
    }

    // Get contact details
    const connection = getPool();
    const [contacts] = await connection.query(
      `SELECT * FROM contacts WHERE id = ? AND session_id = ?`,
      [contactId, sessionId]
    );

    if (contacts.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const contact = contacts[0];

    // Sync history from WhatsApp
    const result = await chatHandlers.syncContactHistory(
      sessionId,
      session.sock,
      contactId,
      contact.phone
    );

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error syncing contact history:', error);
    res.status(500).json({ error: 'Failed to sync contact history' });
  }
});

module.exports = router;
