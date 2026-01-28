// ============================================
// SESSIONS & DASHBOARD FUNCTIONALITY
// ============================================

/**
 * Update all session select elements
 */
function updateAllSessionSelects() {
  const selects = ['sendSessionSelect', 'broadcastSessionSelect', 'jobsSessionSelect', 'chatSessionSelect', 'crmSessionSelect'];
  selects.forEach(selectId => {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '';

    // Add default option for chat and crm selects
    if (selectId === 'chatSessionSelect' || selectId === 'crmSessionSelect') {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Select Session...';
      select.appendChild(opt);
    }

    Object.keys(state.sessions).forEach(sessionId => {
      const opt = document.createElement('option');
      opt.value = sessionId;
      const sess = state.sessions[sessionId];
      const statusIcon = sess.state === 'open' ? '🟢' : sess.state === 'qr' ? '🟡' : '🔴';
      opt.textContent = `${statusIcon} ${sessionId}${sess.user?.name ? ` (${sess.user.name})` : ''}`;
      select.appendChild(opt);
    });

    if (currentValue && Object.keys(state.sessions).includes(currentValue)) {
      select.value = currentValue;
    } else if (Object.keys(state.sessions).length > 0 && !state.activeSession) {
      state.activeSession = Object.keys(state.sessions)[0];
      select.value = state.activeSession;
    } else if (state.activeSession) {
      select.value = state.activeSession;
    }
  });
}

/**
 * Update dashboard statistics
 */
function updateDashboardStats() {
  const sessions = Object.values(state.sessions);
  const connected = sessions.filter(s => s.state === 'open').length;
  const jobs = Object.values(state.jobs).filter(j => j.status === 'running' || j.status === 'queued').length;

  document.getElementById('stat-total-sessions').textContent = sessions.length;
  document.getElementById('stat-connected').textContent = connected;
  document.getElementById('stat-active-jobs').textContent = jobs;

  // Calculate total messages sent
  let totalSent = 0;
  Object.values(state.jobs).forEach(job => {
    totalSent += job.totals?.sent || 0;
  });
  document.getElementById('stat-messages-sent').textContent = totalSent;

  // Update session overview on dashboard
  const overviewDiv = document.getElementById('dashboard-sessions');
  if (sessions.length === 0) {
    overviewDiv.innerHTML = '<p style="color: var(--muted);">No sessions yet. Create one to get started.</p>';
  } else {
    overviewDiv.innerHTML = sessions.map(s => `
      <div class="session-item ${s.state === 'open' ? 'active' : ''}" onclick="window.location.hash='session-detail/${s.id}'">
        <div class="session-item-info">
          <div class="session-item-name">${s.id}</div>
          <div class="session-item-status">
            <span class="status-dot ${s.state === 'open' ? 'connected' : s.state === 'qr' ? 'qr' : 'disconnected'}"></span>
            ${s.state === 'open' ? 'Connected' : s.state === 'qr' ? 'QR Available' : 'Disconnected'} ${s.user?.id ? `- ${s.user.id}` : ''}
          </div>
        </div>
        <span style="font-size: 20px;">→</span>
      </div>
    `).join('');
  }
}

/**
 * Update session detail view
 */
function updateSessionDetailView() {
  const session = state.sessions[state.activeSession];
  if (!session) return;

  document.getElementById('session-detail-name').textContent = state.activeSession;

  const statusDot = document.getElementById('session-status-dot');
  const statusText = document.getElementById('session-status-text');
  const userBadge = document.getElementById('session-user-badge');

  const statusMap = {
    open: { class: 'connected', text: 'Connected' },
    qr: { class: 'qr', text: 'QR Available' },
    close: { class: 'disconnected', text: 'Disconnected' },
    connecting: { class: 'qr', text: 'Connecting...' },
    starting: { class: 'qr', text: 'Starting...' },
  };

  const statusInfo = statusMap[session.state] || { class: 'disconnected', text: session.state || 'Unknown' };
  statusDot.className = `status-dot ${statusInfo.class}`;
  statusText.textContent = statusInfo.text;
  userBadge.textContent = `User: ${session.user?.id || '-'}`;

  // Handle QR
  const qr = state.qrMap[state.activeSession];
  if (session.hasQR && qr) {
    document.getElementById('qrPlaceholder').style.display = 'none';
    document.getElementById('qrCanvas').style.display = 'block';
    QRCode.toCanvas(document.getElementById('qrCanvas'), qr, { width: 280 }, (err) => {
      if (err) console.error(err);
    });
  } else {
    document.getElementById('qrPlaceholder').style.display = 'block';
    document.getElementById('qrCanvas').style.display = 'none';
  }
}

/**
 * Update sessions list view
 */
function updateSessionsListView(filter = '') {
  const listDiv = document.getElementById('sessions-list');
  const sessions = Object.values(state.sessions);

  // Filter sessions based on search
  const filteredSessions = sessions.filter(s =>
    s.id.toLowerCase().includes(filter.toLowerCase()) ||
    (s.user?.name && s.user.name.toLowerCase().includes(filter.toLowerCase()))
  );

  if (filteredSessions.length === 0 && sessions.length > 0) {
    listDiv.innerHTML = `
      <div style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
        <h3 style="color: var(--text); margin-bottom: 8px;">No sessions found</h3>
        <p style="color: var(--muted);">Try adjusting your search terms</p>
      </div>
    `;
    return;
  }

  if (sessions.length === 0) {
    listDiv.innerHTML = `
      <div style="text-align: center; padding: 60px 20px;">
        <div style="font-size: 64px; margin-bottom: 16px;">📱</div>
        <h3 style="color: var(--text); margin-bottom: 8px;">No Sessions Yet</h3>
        <p style="color: var(--muted); margin-bottom: 24px;">Create your first WhatsApp session to get started</p>
        <button onclick="document.getElementById('newSessionId').focus()" style="padding: 12px 24px; background: var(--primary); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
          ➕ Create Session
        </button>
      </div>
    `;
    return;
  }

  // Render sessions as clickable cards (similar to dashboard)
  listDiv.innerHTML = filteredSessions.map(s => {
    const isConnected = s.state === 'open';
    const hasQR = s.state === 'qr' || s.hasQR;

    // Status config dengan warna lebih lembut
    const statusConfig = {
      open: {
        bgColor: '#d1fae5',
        color: '#065f46',
        icon: '✅',
        text: 'Connected',
        dotColor: '#10b981'
      },
      qr: {
        bgColor: '#fef3c7',
        color: '#92400e',
        icon: '📱',
        text: 'QR Available',
        dotColor: '#f59e0b'
      },
      close: {
        bgColor: '#fee2e2',
        color: '#991b1b',
        icon: '⚠️',
        text: 'Disconnected',
        dotColor: '#ef4444'
      },
      connecting: {
        bgColor: '#dbeafe',
        color: '#1e40af',
        icon: '⏳',
        text: 'Connecting...',
        dotColor: '#3b82f6'
      },
      starting: {
        bgColor: '#dbeafe',
        color: '#1e40af',
        icon: '⏳',
        text: 'Starting...',
        dotColor: '#3b82f6'
      }
    };

    const status = statusConfig[s.state] || statusConfig.close;

    return `
      <div class="session-item ${s.state === 'open' ? 'active' : ''}"
           onclick="state.activeSession = '${s.id}'; window.location.hash='session-detail/${s.id}'"
           style="cursor: pointer;">
        <div class="session-item-info">
          <div class="session-item-name">${s.id}</div>
          <div class="session-item-status">
            <span class="status-dot ${s.state === 'open' ? 'connected' : s.state === 'qr' ? 'qr' : 'disconnected'}"></span>
            ${s.state === 'open' ? 'Connected' : s.state === 'qr' ? 'QR Available' : 'Disconnected'} ${s.user?.id ? `- ${s.user.id}` : ''}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <!-- Quick action buttons -->
          ${isConnected ? `
            <button onclick="event.stopPropagation(); logoutSessionFromCard('${s.id}')" style="padding: 4px 10px; background: #fef3c7; color: #92400e; border: none; border-radius: 4px; font-size: 11px; font-weight: 500; cursor: pointer;">
              Disconnect
            </button>
          ` : ''}
          <button onclick="event.stopPropagation(); deleteSessionFromCard('${s.id}');" style="padding: 4px 10px; background: #fee2e2; color: #991b1b; border: none; border-radius: 4px; font-size: 11px; font-weight: 500; cursor: pointer;">
            Delete
          </button>
          <span style="font-size: 20px; color: var(--muted);">→</span>
        </div>
      </div>
    `;
  }).join('');
}

// Logout session from card
async function logoutSessionFromCard(sessionId) {
  try {
    // Clear chat/group data before logout
    clearSessionChatData(sessionId);
    
    await postJson(`/sessions/${sessionId}/logout`, {});
    state.qrMap[sessionId] = null;
    // Reload sessions
    await loadInitialSessions();
    // Update sessions list
    updateSessionsListView();
  } catch (err) {
    console.error('Logout failed:', err);
    alert('Failed to logout: ' + err.message);
  }
}

// Delete session from card (called from modal after confirmation)
async function executeSessionDelete(sessionId, deleteOptions) {
  try {
    const response = await fetch(`/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteOptions })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.details || 'Failed to delete');
    }

    const data = await response.json();
    delete state.sessions[sessionId];
    delete state.qrMap[sessionId];

    // Reload sessions
    await loadInitialSessions();
    // Update sessions list
    updateSessionsListView();

    return data;
  } catch (err) {
    console.error('Delete failed:', err);
    throw err;
  }
}

// Delete session from card (show modal first)
async function deleteSessionFromCard(sessionId) {
  showDeleteSessionModal(sessionId, async (deleteOptions) => {
    try {
      await executeSessionDelete(sessionId, deleteOptions);
    } catch (err) {
      alert('Failed to delete: ' + (err.message || 'Unknown error'));
    }
  });
}

/**
 * Initialize sessions functionality
 */
function initSessions() {
  // Refresh sessions handler
  const refreshBtn = document.getElementById('refreshSessionsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ Refreshing...';
      try {
        await loadInitialSessions();
        updateSessionsListView();
        refreshBtn.textContent = '✓ Refreshed';
        setTimeout(() => {
          refreshBtn.disabled = false;
          refreshBtn.textContent = '🔄 Refresh';
        }, 2000);
      } catch (err) {
        console.error('Refresh failed:', err);
        refreshBtn.textContent = '✗ Failed';
        setTimeout(() => {
          refreshBtn.disabled = false;
          refreshBtn.textContent = '🔄 Refresh';
        }, 2000);
      }
    });
  }

  // Create session handler
  document.getElementById('createSessionBtn').addEventListener('click', async () => {
    const val = document.getElementById('newSessionId').value.trim();
    const log = document.getElementById('sessionCreateLog');
    if (!val) {
      log.textContent = 'Session ID required';
      return;
    }
    log.textContent = 'Creating session...';
    try {
      await postJson('/sessions', { id: val });
      log.textContent = `Session "${val}" created! Redirecting...`;
      setTimeout(() => {
        state.activeSession = val;
        window.location.hash = `session-detail/${val}`;
      }, 1000);
    } catch (err) {
      log.textContent = `Error: ${err.message}`;
    }
  });

  // Logout session handler
  document.getElementById('logoutSessionBtn').addEventListener('click', async () => {
    const log = document.getElementById('sessionActionLog');
    try {
      // Clear chat/group data before logout
      clearSessionChatData(state.activeSession);
      
      await postJson(`/sessions/${state.activeSession}/logout`, {});
      state.qrMap[state.activeSession] = null;
      log.textContent = 'Logged out. Please scan the new QR code.';
    } catch (err) {
      log.textContent = `Error: ${err.message}`;
    }
  });

  // Delete session handler
  document.getElementById('deleteSessionBtn').addEventListener('click', async () => {
    showDeleteSessionModal(state.activeSession, async (deleteOptions) => {
      const log = document.getElementById('sessionActionLog');
      try {
        log.textContent = 'Deleting session...';
        await executeSessionDelete(state.activeSession, deleteOptions);
        log.textContent = 'Session removed. Redirecting...';
        setTimeout(() => {
          window.location.hash = 'sessions';
        }, 1000);
      } catch (err) {
        log.textContent = `Error: ${err.message || 'Failed to remove session'}`;
      }
    });
  });

  // Session select change handlers
  document.getElementById('sendSessionSelect')?.addEventListener('change', (e) => {
    state.activeSession = e.target.value;
  });

  document.getElementById('broadcastSessionSelect')?.addEventListener('change', (e) => {
    state.activeSession = e.target.value;
  });

  document.getElementById('chatSessionSelect')?.addEventListener('change', (e) => {
    chatState.currentSession = e.target.value;
    if (e.target.value) {
      // Clear filters when switching sessions
      if (typeof clearChatFilters === 'function') {
        clearChatFilters();
      }
      loadChatContacts(chatState.currentSession);
    }
  });

  document.getElementById('crmSessionSelect')?.addEventListener('change', (e) => {
    if (e.target.value) {
      loadCRMData(e.target.value);
    }
  });

  document.getElementById('jobsSessionSelect')?.addEventListener('change', (e) => {
    const filterType = document.getElementById('jobFilterType')?.value;
    if (filterType === 'session') {
      applyCurrentJobFilter();
    }
  });
}

/**
 * Load initial sessions data
 */
async function loadInitialSessions() {
  try {
    const data = await fetch('/sessions').then(r => r.json());
    (data.sessions || []).forEach(s => {
      state.sessions[s.id] = { id: s.id, state: s.state, hasQR: s.hasQR, user: s.user };
    });

    if (data.sessions?.length) {
      state.activeSession = data.sessions[0].id;
    }

    updateAllSessionSelects();
    updateDashboardStats();

    // Update sessions list view jika ada elementnya
    if (document.getElementById('sessions-list')) {
      updateSessionsListView();
    }

    // Add search functionality
    const searchInput = document.getElementById('sessionSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        updateSessionsListView(e.target.value);
      });
    }

    // Add refresh button handler
    const refreshBtn = document.getElementById('refreshSessionsBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.textContent = '🔄 Refreshing...';
        refreshBtn.disabled = true;
        try {
          await loadInitialSessions();
        } finally {
          refreshBtn.textContent = '🔄 Refresh';
          refreshBtn.disabled = false;
        }
      });
    }
  } catch (err) {
    console.error('Failed to load sessions', err);
  }
}

/**
 * Show delete session confirmation modal with checklist
 */
async function showDeleteSessionModal(sessionId, onConfirm) {
  // Fetch delete summary first
  let summary = null;
  try {
    const response = await fetch(`/sessions/${sessionId}/delete-summary`);
    if (response.ok) {
      const data = await response.json();
      summary = data.summary;
    }
  } catch (err) {
    console.error('Failed to fetch delete summary:', err);
  }

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'deleteSessionModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 20px;
  `;

  const hasData = summary && (
    summary.groupParticipants > 0 ||
    summary.groupMessages > 0 ||
    summary.groups > 0 ||
    summary.activities > 0 ||
    summary.messages > 0 ||
    summary.contacts > 0 ||
    summary.leadStatuses > 0 ||
    summary.cloudSession > 0 ||
    summary.whatsappSession > 0
  );

  modal.innerHTML = `
    <div class="modal-content" style="
      max-width: 550px;
      width: 100%;
      background: #1e293b;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="font-size: 20px; font-weight: 600; color: #ef4444; display: flex; align-items: center; gap: 8px;">
          🗑️ Delete Session
        </h2>
        <button onclick="document.getElementById('deleteSessionModal').remove()" style="
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 24px;
          cursor: pointer;
          padding: 4px 8px;
        ">✕</button>
      </div>

      <div style="margin-bottom: 20px; padding: 12px; background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; border-radius: 4px;">
        <p style="margin: 0; color: #fca5a5; font-size: 14px;">
          ⚠️ You are about to delete session <strong>${sessionId}</strong>. This action cannot be undone.
        </p>
      </div>

      ${hasData ? `
        <div style="margin-bottom: 20px;">
          <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #e2e8f0;">
            Select data to delete:
          </p>
          <div style="max-height: 300px; overflow-y: auto; padding-right: 8px;">
            ${summary.groupParticipants > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="groupParticipants" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Group Participants</div>
                  <div style="font-size: 12px; color: #94a3b8;">${summary.groupParticipants} participants from ${summary.groups} groups</div>
                </div>
              </label>
            ` : ''}

            ${summary.groupMessages > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="groupMessages" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Group Messages</div>
                  <div style="font-size: 12px; color: #94a3b8;">${summary.groupMessages} messages from groups</div>
                </div>
              </label>
            ` : ''}

            ${summary.groups > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="groups" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Groups</div>
                  <div style="font-size: 12px; color: #94a3b8;">${summary.groups} WhatsApp groups</div>
                </div>
              </label>
            ` : ''}

            ${summary.activities > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="activities" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Activities</div>
                  <div style="font-size: 12px; color: #94a3b8;">${summary.activities} activity records</div>
                </div>
              </label>
            ` : ''}

            ${summary.messages > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="messages" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Messages</div>
                  <div style="font-size: 12px; color: #94a3b8;">${summary.messages} chat messages</div>
                </div>
              </label>
            ` : ''}

            ${summary.contacts > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="contacts" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Contacts</div>
                  <div style="font-size: 12px; color: #94a3b8;">${summary.contacts} contacts</div>
                </div>
              </label>
            ` : ''}

            ${summary.leadStatuses > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="leadStatuses" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Lead Statuses</div>
                  <div style="font-size: 12px; color: #94a3b8;">${summary.leadStatuses} lead status records</div>
                </div>
              </label>
            ` : ''}

            ${summary.cloudSession > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="cloudSession" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">Cloud Session</div>
                  <div style="font-size: 12px; color: #94a3b8;">Cloud backup record</div>
                </div>
              </label>
            ` : ''}

            ${summary.whatsappSession > 0 ? `
              <label class="delete-option-item" style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border: 1px solid #475569;
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
                transition: all 0.2s;
              ">
                <input type="checkbox" class="delete-option-checkbox" data-option="whatsappSession" checked style="
                  width: 18px;
                  height: 18px;
                  cursor: pointer;
                ">
                <div style="flex: 1;">
                  <div style="font-weight: 500; color: #e2e8f0;">WhatsApp Session</div>
                  <div style="font-size: 12px; color: #94a3b8;">Session credentials & data</div>
                </div>
              </label>
            ` : ''}
          </div>
        </div>

        <div style="margin-bottom: 20px; display: flex; gap: 12px;">
          <button id="selectAllDeleteBtn" style="
            flex: 1;
            padding: 8px 12px;
            background: #334155;
            color: #e2e8f0;
            border: 1px solid #475569;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
          ">Select All</button>
          <button id="deselectAllDeleteBtn" style="
            flex: 1;
            padding: 8px 12px;
            background: #334155;
            color: #e2e8f0;
            border: 1px solid #475569;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
          ">Deselect All</button>
        </div>
      ` : `
        <div style="margin-bottom: 20px; padding: 16px; background: #334155; border-radius: 8px; text-align: center;">
          <div style="font-size: 32px; margin-bottom: 8px;">✨</div>
          <p style="margin: 0; color: #94a3b8; font-size: 14px;">
            No database data found for this session. Only session files will be deleted.
          </p>
        </div>
      `}

      <div style="display: flex; gap: 12px;">
        <button id="cancelDeleteBtn" style="
          flex: 1;
          padding: 12px 20px;
          background: transparent;
          color: #e2e8f0;
          border: 1px solid #475569;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
        ">Cancel</button>
        <button id="confirmDeleteBtn" style="
          flex: 1;
          padding: 12px 20px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
        ">Delete Session</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add hover effect for labels
  modal.querySelectorAll('.delete-option-item').forEach(label => {
    label.addEventListener('mouseenter', () => {
      label.style.borderColor = '#06b6d4';
      label.style.background = '#1e293b';
    });
    label.addEventListener('mouseleave', () => {
      const checkbox = label.querySelector('.delete-option-checkbox');
      label.style.borderColor = '#475569';
      label.style.background = '#334155';
    });
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Cancel button
  document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    modal.remove();
  });

  // Select All button
  const selectAllBtn = document.getElementById('selectAllDeleteBtn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      modal.querySelectorAll('.delete-option-checkbox').forEach(cb => cb.checked = true);
    });
  }

  // Deselect All button
  const deselectAllBtn = document.getElementById('deselectAllDeleteBtn');
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      modal.querySelectorAll('.delete-option-checkbox').forEach(cb => cb.checked = false);
    });
  }

  // Confirm delete button
  document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
    // Collect delete options
    const deleteOptions = {};
    modal.querySelectorAll('.delete-option-checkbox').forEach(cb => {
      deleteOptions[cb.dataset.option] = cb.checked;
    });

    // Confirm with user if any options selected
    const hasSelectedOptions = Object.values(deleteOptions).some(v => v);
    if (!hasSelectedOptions && !hasData) {
      // No data to delete, just delete session files
      if (!confirm('No database data selected. Delete only session files?')) {
        return;
      }
    } else if (!hasSelectedOptions && hasData) {
      alert('Please select at least one item to delete from database.');
      return;
    }

    // Perform delete with options
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⏳ Deleting...';

    try {
      // Call the callback with deleteOptions
      await onConfirm(deleteOptions);
      modal.remove();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete: ' + (err.message || 'Unknown error'));
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete Session';
    }
  });
}

