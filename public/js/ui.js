// ============================================
// THEME & UI INITIALIZATION
// ============================================

/**
 * Initialize theme toggle
 */
function initTheme() {
  const themeToggle = document.getElementById('themeToggle');
  const themeText = themeToggle?.querySelector('.theme-text');

  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeText(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      updateThemeText(newTheme);
    });
  }

  function updateThemeText(theme) {
    if (themeText) {
      themeText.textContent = theme === 'dark' ? 'Dark Mode' : 'Light Mode';
    }
  }
}

/**
 * Initialize sidebar collapse
 */
function initSidebar() {
  const sidebarCollapse = document.getElementById('sidebarCollapse');
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.querySelector('.main-content');

  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
  if (sidebarCollapsed) {
    sidebar?.classList.add('collapsed');
    mainContent?.classList.add('expanded');
    updateCollapseIcon(true);
  }

  if (sidebarCollapse) {
    sidebarCollapse.addEventListener('click', () => {
      const isCollapsed = sidebar?.classList.toggle('collapsed');
      mainContent?.classList.toggle('expanded', isCollapsed);
      localStorage.setItem('sidebarCollapsed', isCollapsed);
      updateCollapseIcon(isCollapsed);
    });
  }

  function updateCollapseIcon(collapsed) {
    if (sidebarCollapse) {
      const svg = sidebarCollapse.querySelector('svg');
      if (collapsed) {
        svg.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>';
      } else {
        svg.innerHTML = '<polyline points="15 18 9 12 15 6"></polyline>';
      }
    }
  }
}

/**
 * Initialize Socket.io event listeners
 */
function initSocketIO(socket) {
  // QR code received
  socket.on('qr', ({ sessionId, qr }) => {
    state.qrMap[sessionId] = qr;
    state.sessions[sessionId] = { ...(state.sessions[sessionId] || {}), id: sessionId, hasQR: true };
    if (!state.activeSession) state.activeSession = sessionId;

    if (state.currentView === 'session-detail' && state.activeSession === sessionId) {
      updateSessionDetailView();
    }

    updateDashboardStats();
    updateSessionsListView();
  });

  // Status update
  socket.on('status', (data) => {
    const { sessionId, ...rest } = data;
    state.sessions[sessionId] = { ...(state.sessions[sessionId] || {}), id: sessionId, ...rest };

    if (state.currentView === 'session-detail' && state.activeSession === sessionId) {
      updateSessionDetailView();
    }

    updateDashboardStats();
    updateSessionsListView();
  });

  // Broadcast update
  socket.on('broadcastUpdate', ({ sessionId, job }) => {
    state.jobs[job.id] = job;
    if (state.currentView === 'jobs') {
      renderJobList();
    }
    updateDashboardStats();
  });

  // Session removed
  socket.on('sessionRemoved', ({ sessionId }) => {
    delete state.sessions[sessionId];
    delete state.qrMap[sessionId];
    if (state.activeSession === sessionId) {
      state.activeSession = Object.keys(state.sessions)[0] || null;
    }
    updateDashboardStats();
    updateSessionsListView();
    updateAllSessionSelects();
  });

  // Chat new message
  socket.on('chat.newMessage', (data) => {
    const { sessionId, message, contact } = data;

    console.log('📨 Socket.io received chat.newMessage:', {
      sessionId,
      messageId: message.messageId,
      direction: message.direction,
      hasQuote: !!(message.quotedMessageId && message.quotedContent),
      quotedMessageId: message.quotedMessageId,
      quotedContent: message.quotedContent,
      quotedParticipant: message.quotedParticipant
    });

    if (sessionId === chatState.currentSession) {
      chatState.contacts[contact.id] = contact;

      // Handle reaction messages
      if (message.type === 'reaction' && message.reactionTargetMessageId) {
        if (chatState.currentContact?.id === contact.id) {
          // Call addIncomingReaction if it exists (from chat.js)
          if (typeof addIncomingReaction === 'function') {
            addIncomingReaction(message);
          }
        }
        return;
      }

      if (!chatState.messages[contact.id]) {
        chatState.messages[contact.id] = [];
      }

      // Check for duplicate to prevent adding same message twice
      // (can happen when optimistic UI reloads messages, then Socket.io also emits)
      const exists = chatState.messages[contact.id].some(msg =>
        msg.messageId === message.messageId || msg.id === message.messageId
      );

      if (!exists) {
        chatState.messages[contact.id].push(message);
        console.log(`💾 Message pushed to chatState.messages[${contact.id}], total: ${chatState.messages[contact.id].length}`);
      } else {
        console.log(`⚠️ Duplicate message skipped (Socket.io): ${message.messageId}`);
      }

      if (chatState.currentContact?.id === contact.id) {
        console.log('🎨 Rendering messages for current contact...');
        renderMessages();
        scrollToBottom(document.getElementById('messagesContainer'));
      }

      renderChatContactsList();
    }
  });

  // Message deleted
  socket.on('chat.messageDeleted', (data) => {
    const { sessionId, messageId, contactId } = data;

    if (sessionId === chatState.currentSession && chatState.messages[contactId]) {
      const messageIndex = chatState.messages[contactId].findIndex(msg =>
        (msg.messageId === messageId || msg.id === messageId)
      );

      if (messageIndex !== -1) {
        chatState.messages[contactId][messageIndex].content = '[This message was deleted]';
        chatState.messages[contactId][messageIndex].isDeleted = true;

        if (chatState.currentContact?.id === contactId) {
          renderMessages();
        }
      }
    }
  });

  // History sync
  socket.on('chat.historySync', async (data) => {
    const { sessionId, updatedContactIds } = data;

    if (sessionId === chatState.currentSession) {
      await loadChatContacts(sessionId);

      if (chatState.currentContact && updatedContactIds.includes(chatState.currentContact.id)) {
        await loadContactMessages(chatState.currentContact.id);
        renderMessages();
        scrollToBottom(document.getElementById('messagesContainer'));
      }
    }
  });

  // Google contacts synced
  socket.on('google.contactsSynced', (data) => {
    if (data.sessionId === crmState.currentSession) {
      loadCRMContacts(data.sessionId);
    }
  });
}
