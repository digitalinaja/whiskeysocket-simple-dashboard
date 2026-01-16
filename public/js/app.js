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
