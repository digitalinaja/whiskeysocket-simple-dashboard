// src/activityRoutes.js
// Activity tracking and management endpoints for CRM Boarding School

import express from 'express';
const router = express.Router();
import { getPool } from './database.js';

/**
 * GET /api/activities
 * List activities with filters
 */
router.get('/activities', async (req, res) => {
  try {
    const { sessionId, contactId, activityTypeId, startDate, endDate, limit = 50, page = 1 } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const limitVal = parseInt(limit);

    // Build WHERE clause
    let whereClause = `WHERE a.session_id = ?`;
    const params = [sessionId];

    if (contactId) {
      whereClause += ` AND a.contact_id = ?`;
      params.push(contactId);
    }

    if (activityTypeId) {
      whereClause += ` AND a.activity_type_id = ?`;
      params.push(activityTypeId);
    }

    if (startDate) {
      whereClause += ` AND a.activity_date >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND a.activity_date <= ?`;
      params.push(endDate);
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM activities a
      ${whereClause}
    `;
    const [countResult] = await connection.query(countQuery, params);
    const total = countResult[0].total;

    // Get activities with details
    const query = `
      SELECT
        a.*,
        c.name as contact_name,
        c.phone as contact_phone,
        at.name as activity_type_name,
        at.icon as activity_type_icon,
        at.color as activity_type_color
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      JOIN activity_types at ON a.activity_type_id = at.id
      ${whereClause}
      ORDER BY a.activity_date DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limitVal, offset);

    const [activities] = await connection.query(query, params);

    const totalPages = Math.ceil(total / limitVal);

    res.json({
      activities: activities.map(a => ({
        id: a.id,
        sessionId: a.session_id,
        contactId: a.contact_id,
        contactName: a.contact_name,
        contactPhone: a.contact_phone,
        activityType: {
          id: a.activity_type_id,
          name: a.activity_type_name,
          icon: a.activity_type_icon,
          color: a.activity_type_color
        },
        title: a.title,
        description: a.description,
        activityDate: a.activity_date,
        createdBy: a.created_by,
        outcome: a.outcome,
        nextAction: a.next_action,
        nextActionDate: a.next_action_date,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      })),
      pagination: {
        page: parseInt(page),
        limit: limitVal,
        total,
        totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

/**
 * GET /api/activities/:id
 * Get activity details
 */
router.get('/activities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    const [activities] = await connection.query(
      `SELECT
        a.*,
        c.name as contact_name,
        c.phone as contact_phone,
        at.name as activity_type_name,
        at.icon as activity_type_icon,
        at.color as activity_type_color
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      JOIN activity_types at ON a.activity_type_id = at.id
      WHERE a.id = ? AND a.session_id = ?`,
      [id, sessionId]
    );

    if (activities.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    const a = activities[0];

    res.json({
      activity: {
        id: a.id,
        sessionId: a.session_id,
        contactId: a.contact_id,
        contactName: a.contact_name,
        contactPhone: a.contact_phone,
        activityType: {
          id: a.activity_type_id,
          name: a.activity_type_name,
          icon: a.activity_type_icon,
          color: a.activity_type_color
        },
        title: a.title,
        description: a.description,
        activityDate: a.activity_date,
        createdBy: a.created_by,
        outcome: a.outcome,
        nextAction: a.next_action,
        nextActionDate: a.next_action_date,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching activity details:', error);
    res.status(500).json({ error: 'Failed to fetch activity details' });
  }
});

/**
 * GET /api/contacts/:contactId/activities
 * Get all activities for a contact
 */
router.get('/contacts/:contactId/activities', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    const [activities] = await connection.query(
      `SELECT
        a.*,
        at.name as activity_type_name,
        at.icon as activity_type_icon,
        at.color as activity_type_color
      FROM activities a
      JOIN activity_types at ON a.activity_type_id = at.id
      WHERE a.contact_id = ? AND a.session_id = ?
      ORDER BY a.activity_date DESC`,
      [contactId, sessionId]
    );

    res.json({
      activities: activities.map(a => ({
        id: a.id,
        activityType: {
          id: a.activity_type_id,
          name: a.activity_type_name,
          icon: a.activity_type_icon,
          color: a.activity_type_color
        },
        title: a.title,
        description: a.description,
        activityDate: a.activity_date,
        createdBy: a.created_by,
        outcome: a.outcome,
        nextAction: a.next_action,
        nextActionDate: a.next_action_date,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      }))
    });
  } catch (error) {
    console.error('Error fetching contact activities:', error);
    res.status(500).json({ error: 'Failed to fetch contact activities' });
  }
});

/**
 * POST /api/activities
 * Create new activity
 */
router.post('/activities', async (req, res) => {
  try {
    const { sessionId, contactId, activityTypeId, title, description, activityDate, createdBy, outcome, nextAction, nextActionDate } = req.body;

    if (!sessionId || !contactId || !activityTypeId || !title) {
      return res.status(400).json({ error: 'sessionId, contactId, activityTypeId, and title are required' });
    }

    const connection = getPool();

    const [result] = await connection.query(
      `INSERT INTO activities (session_id, contact_id, activity_type_id, title, description, activity_date, created_by, outcome, next_action, next_action_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        contactId,
        activityTypeId,
        title,
        description || null,
        activityDate || new Date(),
        createdBy || 'system',
        outcome || null,
        nextAction || null,
        nextActionDate || null
      ]
    );

    // Fetch the created activity with details
    const [activities] = await connection.query(
      `SELECT
        a.*,
        c.name as contact_name,
        c.phone as contact_phone,
        at.name as activity_type_name,
        at.icon as activity_type_icon,
        at.color as activity_type_color
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      JOIN activity_types at ON a.activity_type_id = at.id
      WHERE a.id = ?`,
      [result.insertId]
    );

    const a = activities[0];

    res.status(201).json({
      activity: {
        id: a.id,
        sessionId: a.session_id,
        contactId: a.contact_id,
        contactName: a.contact_name,
        contactPhone: a.contact_phone,
        activityType: {
          id: a.activity_type_id,
          name: a.activity_type_name,
          icon: a.activity_type_icon,
          color: a.activity_type_color
        },
        title: a.title,
        description: a.description,
        activityDate: a.activity_date,
        createdBy: a.created_by,
        outcome: a.outcome,
        nextAction: a.next_action,
        nextActionDate: a.next_action_date,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      }
    });
  } catch (error) {
    console.error('Error creating activity:', error);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

/**
 * PUT /api/activities/:id
 * Update activity
 */
router.put('/activities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId, activityTypeId, title, description, activityDate, outcome, nextAction, nextActionDate } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (activityTypeId !== undefined) {
      updates.push('activity_type_id = ?');
      params.push(activityTypeId);
    }
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (activityDate !== undefined) {
      updates.push('activity_date = ?');
      params.push(activityDate);
    }
    if (outcome !== undefined) {
      updates.push('outcome = ?');
      params.push(outcome);
    }
    if (nextAction !== undefined) {
      updates.push('next_action = ?');
      params.push(nextAction);
    }
    if (nextActionDate !== undefined) {
      updates.push('next_action_date = ?');
      params.push(nextActionDate);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id, sessionId);

    const [result] = await connection.query(
      `UPDATE activities SET ${updates.join(', ')} WHERE id = ? AND session_id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    // Fetch updated activity
    const [activities] = await connection.query(
      `SELECT
        a.*,
        c.name as contact_name,
        c.phone as contact_phone,
        at.name as activity_type_name,
        at.icon as activity_type_icon,
        at.color as activity_type_color
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      JOIN activity_types at ON a.activity_type_id = at.id
      WHERE a.id = ?`,
      [id]
    );

    const a = activities[0];

    res.json({
      activity: {
        id: a.id,
        sessionId: a.session_id,
        contactId: a.contact_id,
        contactName: a.contact_name,
        contactPhone: a.contact_phone,
        activityType: {
          id: a.activity_type_id,
          name: a.activity_type_name,
          icon: a.activity_type_icon,
          color: a.activity_type_color
        },
        title: a.title,
        description: a.description,
        activityDate: a.activity_date,
        createdBy: a.created_by,
        outcome: a.outcome,
        nextAction: a.next_action,
        nextActionDate: a.next_action_date,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating activity:', error);
    res.status(500).json({ error: 'Failed to update activity' });
  }
});

/**
 * DELETE /api/activities/:id
 * Delete activity
 */
router.delete('/activities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    const [result] = await connection.query(
      `DELETE FROM activities WHERE id = ? AND session_id = ?`,
      [id, sessionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting activity:', error);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

/**
 * GET /api/activity-types
 * List all activity types for session
 */
router.get('/activity-types', async (req, res) => {
  try {
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();
    const [types] = await connection.query(
      `SELECT
        at.*,
        COUNT(a.id) as usage_count
      FROM activity_types at
      LEFT JOIN activities a ON at.id = a.activity_type_id
      WHERE at.session_id = ?
      GROUP BY at.id
      ORDER BY at.name`,
      [sessionId]
    );

    res.json({ activityTypes: types });
  } catch (error) {
    console.error('Error fetching activity types:', error);
    res.status(500).json({ error: 'Failed to fetch activity types' });
  }
});

/**
 * POST /api/activity-types
 * Create new activity type
 */
router.post('/activity-types', async (req, res) => {
  try {
    const { sessionId, name, icon, color } = req.body;

    if (!sessionId || !name) {
      return res.status(400).json({ error: 'sessionId and name are required' });
    }

    const connection = getPool();
    const [result] = await connection.query(
      `INSERT INTO activity_types (session_id, name, icon, color) VALUES (?, ?, ?, ?)`,
      [sessionId, name, icon || null, color || '#6366f1']
    );

    const [types] = await connection.query(`SELECT * FROM activity_types WHERE id = ?`, [result.insertId]);

    res.status(201).json({ activityType: types[0] });
  } catch (error) {
    console.error('Error creating activity type:', error);
    res.status(500).json({ error: 'Failed to create activity type' });
  }
});

/**
 * PUT /api/activity-types/:id
 * Update activity type
 */
router.put('/activity-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId, name, icon, color } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    const [result] = await connection.query(
      `UPDATE activity_types SET name = ?, icon = ?, color = ? WHERE id = ? AND session_id = ?`,
      [name, icon, color, id, sessionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Activity type not found' });
    }

    const [types] = await connection.query(`SELECT * FROM activity_types WHERE id = ?`, [id]);

    res.json({ activityType: types[0] });
  } catch (error) {
    console.error('Error updating activity type:', error);
    res.status(500).json({ error: 'Failed to update activity type' });
  }
});

/**
 * DELETE /api/activity-types/:id
 * Delete activity type
 */
router.delete('/activity-types/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const connection = getPool();

    // Check if activity type is in use
    const [check] = await connection.query(
      `SELECT COUNT(*) as count FROM activities WHERE activity_type_id = ?`,
      [id]
    );

    if (check[0].count > 0) {
      return res.status(400).json({
        error: 'Activity type is in use',
        count: check[0].count,
        message: 'Cannot delete activity type that has associated activities'
      });
    }

    const [result] = await connection.query(
      `DELETE FROM activity_types WHERE id = ? AND session_id = ?`,
      [id, sessionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Activity type not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting activity type:', error);
    res.status(500).json({ error: 'Failed to delete activity type' });
  }
});

export default router;
