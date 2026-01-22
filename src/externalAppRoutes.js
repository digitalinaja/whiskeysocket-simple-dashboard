// src/externalAppRoutes.js
// External app integration routes for school CRM

import express from 'express';
const router = express.Router();
import * as externalAppSync from './externalAppSync.js';

/**
 * GET /api/external/config
 * Get external app configuration status
 */
router.get('/external/config', async (req, res) => {
  try {
    const config = externalAppSync.getExternalAppConfig();
    res.json({ config });
  } catch (error) {
    console.error('Error fetching external app config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

/**
 * GET /api/external/student/:studentId
 * Fetch student info from Student DB App
 */
router.get('/external/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await externalAppSync.fetchStudentFromApp(studentId);

    res.json({ student });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Failed to fetch student data', details: error.message });
  }
});

/**
 * POST /api/external/link-student
 * Link contact to student(s)
 */
router.post('/external/link-student', async (req, res) => {
  try {
    const { sessionId, contactId, studentIds } = req.body;

    if (!sessionId || !contactId || !studentIds) {
      return res.status(400).json({ error: 'sessionId, contactId, and studentIds are required' });
    }

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds must be a non-empty array' });
    }

    const result = await externalAppSync.linkContactToStudents(sessionId, contactId, studentIds);

    res.json(result);
  } catch (error) {
    console.error('Error linking student:', error);
    res.status(500).json({ error: 'Failed to link student', details: error.message });
  }
});

/**
 * POST /api/external/sync-students-auto
 * Auto-link contacts to students by phone number
 */
router.post('/external/sync-students-auto', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await externalAppSync.autoLinkStudentsByPhone(sessionId);

    res.json(result);
  } catch (error) {
    console.error('Error auto-syncing students:', error);
    res.status(500).json({ error: 'Failed to auto-sync students', details: error.message });
  }
});

/**
 * GET /api/external/contacts/:contactId/payment
 * Get payment status for a contact
 */
router.get('/external/contacts/:contactId/payment', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await externalAppSync.fetchPaymentStatus(sessionId, contactId);

    res.json(result);
  } catch (error) {
    console.error('Error fetching payment status:', error);
    res.status(500).json({ error: 'Failed to fetch payment status', details: error.message });
  }
});

/**
 * GET /api/external/contacts/:contactId/tickets
 * Get ticket history for a contact
 */
router.get('/external/contacts/:contactId/tickets', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await externalAppSync.fetchTicketHistory(sessionId, contactId);

    res.json(result);
  } catch (error) {
    console.error('Error fetching ticket history:', error);
    res.status(500).json({ error: 'Failed to fetch ticket history', details: error.message });
  }
});

/**
 * PUT /api/external/contacts/:contactId/payment-link
 * Update payment app link for contact
 */
router.put('/external/contacts/:contactId/payment-link', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId, paymentLink } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    if (!paymentLink) {
      return res.status(400).json({ error: 'paymentLink is required' });
    }

    const result = await externalAppSync.updatePaymentAppLink(sessionId, contactId, paymentLink);

    res.json(result);
  } catch (error) {
    console.error('Error updating payment link:', error);
    res.status(500).json({ error: 'Failed to update payment link', details: error.message });
  }
});

/**
 * PUT /api/external/contacts/:contactId/ticketing-link
 * Update ticketing app link for contact
 */
router.put('/external/contacts/:contactId/ticketing-link', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { sessionId, ticketingLink } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    if (!ticketingLink) {
      return res.status(400).json({ error: 'ticketingLink is required' });
    }

    const result = await externalAppSync.updateTicketingAppLink(sessionId, contactId, ticketingLink);

    res.json(result);
  } catch (error) {
    console.error('Error updating ticketing link:', error);
    res.status(500).json({ error: 'Failed to update ticketing link', details: error.message });
  }
});

export default router;
