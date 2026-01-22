// ============================================
// APPLICATION INITIALIZATION
// ============================================

/**
 * Initialize the entire application
 */
async function initApp() {
  try {
    // Initialize Socket.io connection
    const socket = io();

    // Initialize theme and UI
    initTheme();
    initSidebar();
    initSocketIO(socket);

    // Initialize navigation
    initNavigation();

    // Initialize sessions
    initSessions();
    await loadInitialSessions();

    // Initialize broadcast
    initBroadcast();

    // Initialize chat
    initChat();

    // Initialize CRM
    initCRM();

    // Initialize Activities
    if (typeof initActivities === 'function') {
      initActivities();
    }

    // Initialize Analytics
    if (typeof initAnalytics === 'function') {
      initAnalytics();
    }

    // Initialize Prospects
    if (typeof initProspects === 'function') {
      initProspects();
    }

    // Initialize External Apps
    if (typeof initExternalApps === 'function') {
      initExternalApps();
    }

    // Setup job detail handlers
    setupJobDetailHandlers();

    // Initial navigation
    handleHashChange();

    console.log('✅ Application initialized successfully');
  } catch (err) {
    console.error('❌ Failed to initialize application:', err);
  }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
