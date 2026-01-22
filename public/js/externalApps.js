// public/js/externalApps.js
// External apps integration UI for CRM Boarding School

/**
 * External apps state
 */
const externalAppsState = {
  config: null,
  currentContactId: null,
  syncStatus: {
    students: null,
    payments: null,
    tickets: null
  }
};

/**
 * Initialize external apps module
 */
function initExternalApps() {
  fetchExternalAppConfig();
}

/**
 * Fetch external app configuration status
 */
async function fetchExternalAppConfig() {
  try {
    const response = await fetch('/api/external/config');
    const data = await response.json();

    if (response.ok) {
      externalAppsState.config = data.config;
      renderExternalAppConfig();
    }
  } catch (error) {
    console.error('Error fetching external app config:', error);
  }
}

/**
 * Render external app configuration status
 */
function renderExternalAppConfig() {
  const container = document.getElementById('externalAppConfig');
  if (!container) return;

  const apps = [
    { key: 'studentDbApp', name: 'Student Database', icon: '🎓' },
    { key: 'paymentApp', name: 'Payment App', icon: '💰' },
    { key: 'ticketingApp', name: 'Ticketing App', icon: '🎫' }
  ];

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px;">
      ${apps.map(app => {
        const config = externalAppsState.config?.[app.key] || {};
        const statusColor = config.enabled ? '#22c55e' : '#6b7280';
        const statusText = config.enabled ? (config.configured ? 'Connected' : 'Enabled (Not Configured)') : 'Not Enabled';

        return `
          <div style="border: 1px solid var(--border); border-radius: 8px; padding: 16px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="font-size: 24px;">${app.icon}</span>
              <strong>${app.name}</strong>
              <span style="margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};"></span>
            </div>
            <div style="font-size: 13px; color: var(--muted);">
              Status: ${statusText}
            </div>
            ${!config.configured ? `
              <div style="font-size: 12px; color: var(--muted); margin-top: 8px;">
                Configure in .env file to enable
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Auto-sync students from external app
 */
async function autoSyncStudents() {
  const sessionId = window.currentSessionId;
  if (!sessionId) {
    showNotification('Please select a session first', 'error');
    return;
  }

  if (!confirm('This will automatically link contacts to students based on phone number. Continue?')) {
    return;
  }

  const btn = document.getElementById('autoSyncStudentsBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing...';
  }

  try {
    const response = await fetch('/api/external/sync-students-auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });

    const data = await response.json();

    if (response.ok) {
      showNotification(
        `Sync complete: ${data.linked} contacts linked, ${data.notFound} not found`,
        'success'
      );

      // Refresh current view
      if (typeof window.refreshCRM === 'function') {
        window.refreshCRM();
      }
    } else {
      showNotification('Sync failed: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error syncing students:', error);
    showNotification('Sync failed', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Auto-Sync Students';
    }
  }
}

/**
 * Link contact to students
 */
async function linkContactToStudents(contactId, studentIds) {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch('/api/external/link-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        contactId,
        studentIds: Array.isArray(studentIds) ? studentIds : [studentIds]
      })
    });

    const data = await response.json();

    if (response.ok) {
      showNotification('Students linked successfully', 'success');

      // Refresh contact details
      if (typeof window.refreshContactDetail === 'function') {
        window.refreshContactDetail(contactId);
      }
    } else {
      showNotification('Failed to link students: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error linking students:', error);
    showNotification('Failed to link students', 'error');
  }
}

/**
 * Fetch payment status for contact
 */
async function fetchPaymentStatus(contactId) {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/external/contacts/${contactId}/payment?sessionId=${sessionId}`);
    const data = await response.json();

    if (response.ok) {
      externalAppsState.syncStatus.payments = data;
      renderPaymentStatus(data);
    } else {
      showNotification('Failed to fetch payment status', 'error');
    }
  } catch (error) {
    console.error('Error fetching payment status:', error);
  }
}

/**
 * Render payment status in contact detail
 */
function renderPaymentStatus(data) {
  const container = document.getElementById('contactPaymentStatus');
  if (!container) return;

  if (!data.enabled) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 13px;">Payment App not configured</p>';
    return;
  }

  if (!data.payments || data.payments.length === 0) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 13px;">No payment data available</p>';
    return;
  }

  container.innerHTML = data.payments.map(studentPayment => `
    <div style="padding: 8px; background: var(--bg); border-radius: 4px; margin-bottom: 8px;">
      <div style="font-weight: 500; font-size: 13px;">Student ID: ${studentPayment.studentId}</div>
      ${studentPayment.payments && studentPayment.payments.length > 0 ? `
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
          ${studentPayment.payments.length} payment record(s)
        </div>
      ` : studentPayment.error ? `
        <div style="font-size: 12px; color: #ef4444; margin-top: 4px;">
          ${escapeHtml(studentPayment.error)}
        </div>
      ` : '<p style="font-size: 12px; color: var(--muted);">No payments</p>'}
    </div>
  `).join('');
}

/**
 * Fetch ticket history for contact
 */
async function fetchTicketHistory(contactId) {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/external/contacts/${contactId}/tickets?sessionId=${sessionId}`);
    const data = await response.json();

    if (response.ok) {
      externalAppsState.syncStatus.tickets = data;
      renderTicketHistory(data);
    }
  } catch (error) {
    console.error('Error fetching ticket history:', error);
  }
}

/**
 * Render ticket history in contact detail
 */
function renderTicketHistory(data) {
  const container = document.getElementById('contactTicketHistory');
  if (!container) return;

  if (!data.enabled) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 13px;">Ticketing App not configured</p>';
    return;
  }

  if (!data.tickets || data.tickets.length === 0) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 13px;">No tickets found</p>';
    return;
  }

  container.innerHTML = data.tickets.map(ticket => `
    <div style="padding: 8px; background: var(--bg); border-radius: 4px; margin-bottom: 8px;">
      <div style="font-weight: 500; font-size: 13px;">#${ticket.id || 'N/A'}: ${escapeHtml(ticket.subject || ticket.title || 'No subject')}</div>
      <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
        Status: ${escapeHtml(ticket.status || 'Unknown')}
      </div>
    </div>
  `).join('');
}

/**
 * Update payment app link for contact
 */
async function updatePaymentAppLink(contactId, paymentLink) {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/external/contacts/${contactId}/payment-link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, paymentLink })
    });

    const data = await response.json();

    if (response.ok) {
      showNotification('Payment link updated', 'success');
      return true;
    } else {
      showNotification('Failed to update link: ' + (data.error || 'Unknown error'), 'error');
      return false;
    }
  } catch (error) {
    console.error('Error updating payment link:', error);
    showNotification('Failed to update link', 'error');
    return false;
  }
}

/**
 * Update ticketing app link for contact
 */
async function updateTicketingAppLink(contactId, ticketingLink) {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/external/contacts/${contactId}/ticketing-link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ticketingLink })
    });

    const data = await response.json();

    if (response.ok) {
      showNotification('Ticketing link updated', 'success');
      return true;
    } else {
      showNotification('Failed to update link: ' + (data.error || 'Unknown error'), 'error');
      return false;
    }
  } catch (error) {
    console.error('Error updating ticketing link:', error);
    showNotification('Failed to update link', 'error');
    return false;
  }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  if (typeof window.showNotification === 'function') {
    window.showNotification(message, type);
  } else {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed; bottom: 20px; right: 20px;
      padding: 12px 24px; border-radius: 8px;
      background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white; z-index: 10000;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

// Export functions
window.initExternalApps = initExternalApps;
window.fetchExternalAppConfig = fetchExternalAppConfig;
window.autoSyncStudents = autoSyncStudents;
window.linkContactToStudents = linkContactToStudents;
window.fetchPaymentStatus = fetchPaymentStatus;
window.fetchTicketHistory = fetchTicketHistory;
window.updatePaymentAppLink = updatePaymentAppLink;
window.updateTicketingAppLink = updateTicketingAppLink;
