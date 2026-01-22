// src/externalAppSync.js
// External app integration module for school CRM
// Handles sync with Student Database App, Payment App, and Ticketing App

import { getPool } from './database.js';

/**
 * External App Configuration Store
 * In production, this should be stored in database or environment variables
 */
const EXTERNAL_APP_CONFIG = {
  studentDbApp: {
    baseUrl: process.env.STUDENT_DB_APP_URL || null,
    apiKey: process.env.STUDENT_DB_APP_API_KEY || null,
    enabled: !!process.env.STUDENT_DB_APP_URL
  },
  paymentApp: {
    baseUrl: process.env.PAYMENT_APP_URL || null,
    apiKey: process.env.PAYMENT_APP_API_KEY || null,
    enabled: !!process.env.PAYMENT_APP_URL
  },
  ticketingApp: {
    baseUrl: process.env.TICKETING_APP_URL || null,
    apiKey: process.env.TICKETING_APP_API_KEY || null,
    enabled: !!process.env.TICKETING_APP_URL
  }
};

/**
 * Fetch student information from Student Database App
 * @param {string} studentId - External student ID
 * @returns {Promise<Object>} Student data
 */
async function fetchStudentFromApp(studentId) {
  const config = EXTERNAL_APP_CONFIG.studentDbApp;

  if (!config.enabled || !config.baseUrl || !config.apiKey) {
    throw new Error('Student Database App is not configured');
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/students/${studentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch student: ${response.statusText}`);
    }

    const data = await response.json();
    return data.student || data;
  } catch (error) {
    console.error('Error fetching student from app:', error);
    throw error;
  }
}

/**
 * Fetch multiple students by parent phone number
 * @param {string} phone - Parent phone number
 * @returns {Promise<Array>} Array of students
 */
async function fetchStudentsByParentPhone(phone) {
  const config = EXTERNAL_APP_CONFIG.studentDbApp;

  if (!config.enabled || !config.baseUrl || !config.apiKey) {
    return [];
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/students/by-parent/${phone}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`Failed to fetch students: ${response.statusText}`);
    }

    const data = await response.json();
    return data.students || data || [];
  } catch (error) {
    console.error('Error fetching students by phone:', error);
    return [];
  }
}

/**
 * Link contact to external student(s)
 * @param {string} sessionId - Session ID
 * @param {number} contactId - Contact ID
 * @param {Array<string>} studentIds - Array of external student IDs
 * @returns {Promise<Object>} Updated contact data
 */
async function linkContactToStudents(sessionId, contactId, studentIds) {
  const connection = await getPool().getConnection();

  try {
    // Get contact
    const [contacts] = await connection.query(
      'SELECT * FROM contacts WHERE id = ? AND session_id = ?',
      [contactId, sessionId]
    );

    if (contacts.length === 0) {
      throw new Error('Contact not found');
    }

    const contact = contacts[0];

    // Update contact with student links
    const [result] = await connection.query(
      `UPDATE contacts
       SET external_student_ids = ?,
           external_student_source = 'student_db_app',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND session_id = ?`,
      [JSON.stringify(studentIds), contactId, sessionId]
    );

    if (result.affectedRows === 0) {
      throw new Error('Failed to update contact');
    }

    // Fetch student details from app
    const students = await Promise.all(
      studentIds.map(id => fetchStudentFromApp(id).catch(() => ({ id, name: 'Unknown' })))
    );

    return {
      success: true,
      contactId,
      linkedStudentIds: studentIds,
      students
    };
  } catch (error) {
    console.error('Error linking contact to students:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Fetch payment status from Payment App
 * @param {string} sessionId - Session ID
 * @param {number} contactId - Contact ID
 * @returns {Promise<Object>} Payment summary
 */
async function fetchPaymentStatus(sessionId, contactId) {
  const config = EXTERNAL_APP_CONFIG.paymentApp;
  const connection = await getPool().getConnection();

  try {
    if (!config.enabled || !config.baseUrl || !config.apiKey) {
      return { enabled: false, message: 'Payment App not configured' };
    }

    // Get contact with external student IDs
    const [contacts] = await connection.query(
      'SELECT * FROM contacts WHERE id = ? AND session_id = ?',
      [contactId, sessionId]
    );

    if (contacts.length === 0) {
      throw new Error('Contact not found');
    }

    const contact = contacts[0];
    const studentIds = contact.external_student_ids ? JSON.parse(contact.external_student_ids) : [];

    if (studentIds.length === 0) {
      return { enabled: true, message: 'No students linked', payments: [] };
    }

    // Fetch payment data from Payment App
    const paymentPromises = studentIds.map(async (studentId) => {
      try {
        const response = await fetch(`${config.baseUrl}/api/payments/student/${studentId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          return { studentId, error: 'Failed to fetch payments' };
        }

        const data = await response.json();
        return { studentId, payments: data.payments || data || [] };
      } catch (error) {
        return { studentId, error: error.message };
      }
    });

    const results = await Promise.all(paymentPromises);

    return {
      enabled: true,
      studentIds,
      payments: results
    };
  } catch (error) {
    console.error('Error fetching payment status:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Fetch ticket history from Ticketing App
 * @param {string} sessionId - Session ID
 * @param {number} contactId - Contact ID
 * @returns {Promise<Object>} Ticket summary
 */
async function fetchTicketHistory(sessionId, contactId) {
  const config = EXTERNAL_APP_CONFIG.ticketingApp;
  const connection = await getPool().getConnection();

  try {
    if (!config.enabled || !config.baseUrl || !config.apiKey) {
      return { enabled: false, message: 'Ticketing App not configured' };
    }

    // Get contact
    const [contacts] = await connection.query(
      'SELECT phone, email FROM contacts WHERE id = ? AND session_id = ?',
      [contactId, sessionId]
    );

    if (contacts.length === 0) {
      throw new Error('Contact not found');
    }

    const contact = contacts[0];

    // Fetch tickets by phone or email
    const response = await fetch(
      `${config.baseUrl}/api/tickets/search?phone=${encodeURIComponent(contact.phone || '')}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      return { enabled: true, message: 'Failed to fetch tickets', tickets: [] };
    }

    const data = await response.json();

    return {
      enabled: true,
      tickets: data.tickets || data || []
    };
  } catch (error) {
    console.error('Error fetching ticket history:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Update payment app link for contact
 * @param {string} sessionId - Session ID
 * @param {number} contactId - Contact ID
 * @param {string} paymentLink - Payment app URL
 * @returns {Promise<Object>} Result
 */
async function updatePaymentAppLink(sessionId, contactId, paymentLink) {
  const connection = await getPool().getConnection();

  try {
    const [result] = await connection.query(
      `UPDATE contacts
       SET payment_app_link = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND session_id = ?`,
      [paymentLink, contactId, sessionId]
    );

    if (result.affectedRows === 0) {
      throw new Error('Contact not found or update failed');
    }

    return { success: true, paymentLink };
  } catch (error) {
    console.error('Error updating payment app link:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Update ticketing app link for contact
 * @param {string} sessionId - Session ID
 * @param {number} contactId - Contact ID
 * @param {string} ticketingLink - Ticketing app URL
 * @returns {Promise<Object>} Result
 */
async function updateTicketingAppLink(sessionId, contactId, ticketingLink) {
  const connection = await getPool().getConnection();

  try {
    const [result] = await connection.query(
      `UPDATE contacts
       SET ticketing_app_link = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND session_id = ?`,
      [ticketingLink, contactId, sessionId]
    );

    if (result.affectedRows === 0) {
      throw new Error('Contact not found or update failed');
    }

    return { success: true, ticketingLink };
  } catch (error) {
    console.error('Error updating ticketing app link:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Auto-link contacts to students by phone number
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Sync results
 */
async function autoLinkStudentsByPhone(sessionId) {
  const connection = await getPool().getConnection();

  try {
    // Get all contacts without linked students
    const [contacts] = await connection.query(
      `SELECT id, phone, name
       FROM contacts
       WHERE session_id = ?
         AND contact_type IN ('student_parent', 'prospect_parent')
         AND (external_student_ids IS NULL OR external_student_ids = 'null')`,
      [sessionId]
    );

    let linked = 0;
    let notFound = 0;
    const results = [];

    for (const contact of contacts) {
      try {
        const students = await fetchStudentsByParentPhone(contact.phone);

        if (students.length > 0) {
          const studentIds = students.map(s => s.id);

          await connection.query(
            `UPDATE contacts
             SET external_student_ids = ?,
                 external_student_source = 'student_db_app',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [JSON.stringify(studentIds), contact.id]
          );

          linked++;
          results.push({
            contactId: contact.id,
            contactName: contact.name,
            linked: true,
            studentCount: students.length,
            students: students.map(s => ({ id: s.id, name: s.name }))
          });
        } else {
          notFound++;
          results.push({
            contactId: contact.id,
            contactName: contact.name,
            linked: false,
            message: 'No students found'
          });
        }
      } catch (error) {
        results.push({
          contactId: contact.id,
          contactName: contact.name,
          linked: false,
          error: error.message
        });
      }
    }

    return {
      success: true,
      total: contacts.length,
      linked,
      notFound,
      results
    };
  } catch (error) {
    console.error('Error auto-linking students:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get external app configuration status
 * @returns {Promise<Object>} Configuration status
 */
function getExternalAppConfig() {
  return {
    studentDbApp: {
      enabled: EXTERNAL_APP_CONFIG.studentDbApp.enabled,
      configured: !!EXTERNAL_APP_CONFIG.studentDbApp.apiKey
    },
    paymentApp: {
      enabled: EXTERNAL_APP_CONFIG.paymentApp.enabled,
      configured: !!EXTERNAL_APP_CONFIG.paymentApp.apiKey
    },
    ticketingApp: {
      enabled: EXTERNAL_APP_CONFIG.ticketingApp.enabled,
      configured: !!EXTERNAL_APP_CONFIG.ticketingApp.apiKey
    }
  };
}

export {
  fetchStudentFromApp,
  fetchStudentsByParentPhone,
  linkContactToStudents,
  fetchPaymentStatus,
  fetchTicketHistory,
  updatePaymentAppLink,
  updateTicketingAppLink,
  autoLinkStudentsByPhone,
  getExternalAppConfig
};
