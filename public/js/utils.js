// ============================================
// UTILITY FUNCTIONS
// ============================================

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

/**
 * Check if user is authenticated
 * @returns {Promise<{authenticated: boolean, user: object|null}>}
 */
async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    return data;
  } catch (error) {
    console.error('Auth check failed:', error);
    return { authenticated: false, user: null };
  }
}

/**
 * Redirect to SSO login page if not authenticated
 * @param {string} ssoLoginUrl - URL of external SSO login page
 * @returns {Promise<boolean>} - true if authenticated, false if redirected
 */
async function redirectIfNotAuthenticated(ssoLoginUrl) {
  const authStatus = await checkAuthStatus();

  if (!authStatus.authenticated) {
    // Redirect to external SSO login page
    window.location.href = ssoLoginUrl;
    return false;
  }

  return true;
}

/**
 * Protect a menu/route - check authentication before allowing access
 * Call this function when user clicks on a menu item
 * @param {string} ssoLoginUrl - URL of external SSO login page
 * @param {Function} callback - Function to execute if authenticated
 */
async function protectRoute(ssoLoginUrl, callback) {
  const isAuthenticated = await redirectIfNotAuthenticated(ssoLoginUrl);

  if (isAuthenticated && typeof callback === 'function') {
    callback();
  }
}

/**
 * Wrapper for fetch API that handles authentication errors
 * Automatically redirects to login page on 401/403 responses
 * @param {string} url
 * @param {object} options - Fetch options
 * @param {string} ssoLoginUrl - URL to redirect on auth failure
 * @returns {Promise<Response>}
 */
async function authenticatedFetch(url, options = {}, ssoLoginUrl) {
  try {
    const res = await fetch(url, options);

    // Handle authentication failures
    if (res.status === 401 || res.status === 403) {
      if (ssoLoginUrl) {
        window.location.href = ssoLoginUrl;
      }
      throw new Error('Authentication failed');
    }

    return res;
  } catch (error) {
    console.error('Authenticated fetch error:', error);
    throw error;
  }
}

/**
 * Make an authenticated POST request
 * @param {string} url
 * @param {object} body
 * @param {string} ssoLoginUrl - URL to redirect on auth failure
 * @returns {Promise}
 */
async function authenticatedPostJson(url, body, ssoLoginUrl) {
  const res = await authenticatedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, ssoLoginUrl);

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/**
 * Make an authenticated GET request
 * @param {string} url
 * @param {string} ssoLoginUrl - URL to redirect on auth failure
 * @returns {Promise}
 */
async function authenticatedGetJson(url, ssoLoginUrl) {
  const res = await authenticatedFetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  }, ssoLoginUrl);

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ============================================
// GENERAL UTILITY FUNCTIONS
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
