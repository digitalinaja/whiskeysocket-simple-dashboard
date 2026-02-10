// ============================================
// NAVIGATION & ROUTING
// ============================================

/**
 * Navigate to a specific view
 * @param {string} viewId
 * @param {string} sessionId - Optional session ID for session detail view
 */
function navigateTo(viewId, sessionId = null) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Update nav items (only for main nav items)
  if (['dashboard', 'sessions', 'send-message', 'broadcast', 'jobs', 'chat', 'groups', 'contacts', 'cs-performance'].includes(viewId)) {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.view === viewId) {
        item.classList.add('active');
      }
    });
  }

  // Show target view
  let targetView = document.getElementById(`view-${viewId}`);
  if (viewId === 'session-detail' && sessionId) {
    state.activeSession = sessionId;
    updateSessionDetailView();
    targetView = document.getElementById('view-session-detail');
  } else if (viewId === 'job-detail') {
    targetView = document.getElementById('view-job-detail');
  }

  if (targetView) {
    targetView.classList.add('active');
    state.currentView = viewId;
  }

  // Close mobile menu
  document.getElementById('sidebar').classList.remove('open');

  // Update session selects
  updateAllSessionSelects();

  // Load data on view switch
  if (viewId === 'jobs') {
    applyCurrentJobFilter();
  } else if (viewId === 'sessions') {
    updateSessionsListView();
  } else if (viewId === 'chat') {
    // Auto-select first session if none selected
    if (!chatState.currentSession) {
      const selectEl = document.getElementById('chatSessionSelect');
      const firstSession = selectEl?.querySelector('option:not([value=""])')?.value;
      if (firstSession) {
        selectEl.value = firstSession;
        chatState.currentSession = firstSession;
      }
    }
    if (chatState.currentSession) {
      const pending = window.pendingChatOpen;
      loadChatContacts(chatState.currentSession).then(() => {
        if (!pending) return;
        if (pending.sessionId && pending.sessionId !== chatState.currentSession) return;

        if (pending.contactId && !chatState.contacts[pending.contactId] && pending.contact) {
          chatState.contacts[pending.contactId] = pending.contact;
        }

        if (pending.contactId) {
          openChatContact(pending.contactId);
        }

        window.pendingChatOpen = null;
      });
    }
  } else if (viewId === 'contacts') {
    // Auto-select first session if none selected
    if (!crmState.currentSession) {
      const selectEl = document.getElementById('crmSessionSelect');
      const firstSession = selectEl?.querySelector('option:not([value=""])')?.value;
      if (firstSession) {
        selectEl.value = firstSession;
        crmState.currentSession = firstSession;
      }
    }
    if (crmState.currentSession) {
      loadCRMData(crmState.currentSession);
    }
  } else if (viewId === 'groups') {
    // Call Groups.onNavigate to refresh sessions and load groups
    if (Groups.onNavigate) {
      Groups.onNavigate();
    }
  } else if (viewId === 'cs-performance') {
    // Initialize CS Performance module and auto-select session
    if (typeof initCSPerformance === 'function') {
      initCSPerformance();
    }
    // Auto-select first session if none selected (check if state exists)
    if (typeof csPerformanceState !== 'undefined' && !csPerformanceState.currentSession) {
      const selectEl = document.getElementById('csPerformanceSessionSelect');
      const firstSession = selectEl?.querySelector('option:not([value=""])')?.value;
      if (firstSession) {
        selectEl.value = firstSession;
        csPerformanceState.currentSession = firstSession;
      }
    }
    if (typeof csPerformanceState !== 'undefined' && csPerformanceState.currentSession && typeof fetchCSPerformance === 'function') {
      fetchCSPerformance('7d'); // Load with default 7-day period
    }
  }
}

/**
 * Handle hash-based routing
 */
function handleHashChange() {
  const hash = window.location.hash.slice(1) || 'dashboard';

  // Handle session-detail route with parameter
  if (hash.startsWith('session-detail/')) {
    const sessionId = hash.split('/')[1];
    navigateTo('session-detail', sessionId);
  } else {
    navigateTo(hash);
  }
}

/**
 * Initialize navigation event listeners
 */
function initNavigation() {
  window.addEventListener('hashchange', handleHashChange);

  // Mobile menu toggle
  document.getElementById('mobileMenuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Navigation items click handler
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      window.location.hash = view;
    });
  });

  // Initial navigation
  handleHashChange();
}
