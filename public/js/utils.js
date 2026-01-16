// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Make a POST request with JSON body
 * @param {string} url
 * @param {object} body
 * @returns {Promise}
 */
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/**
 * Format timestamp to readable time
 * @param {string|number} timestamp
 * @returns {string}
 */
function formatMessageTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Format date to readable format
 * @param {string|number} timestamp
 * @returns {string}
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format date and time
 * @param {string|number} timestamp
 * @returns {string}
 */
function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get message status icon
 * @param {string} status
 * @returns {string}
 */
function getMessageStatusIcon(status) {
  const icons = {
    sent: '✓',
    delivered: '✓✓',
    read: '✓✓',
    failed: '✗'
  };
  return icons[status] || '?';
}

/**
 * Scroll container to bottom
 * @param {HTMLElement} container
 */
function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}
