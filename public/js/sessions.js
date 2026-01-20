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
          <button onclick="event.stopPropagation(); if(confirm('Delete session "${s.id}"?')) { deleteSessionFromCard('${s.id}'); }" style="padding: 4px 10px; background: #fee2e2; color: #991b1b; border: none; border-radius: 4px; font-size: 11px; font-weight: 500; cursor: pointer;">
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

// Delete session from card
async function deleteSessionFromCard(sessionId) {
  try {
    await fetch(`/sessions/${sessionId}`, { method: 'DELETE' }).then(r => r.json());
    delete state.sessions[sessionId];
    delete state.qrMap[sessionId];
    // Reload sessions
    await loadInitialSessions();
    // Update sessions list
    updateSessionsListView();
  } catch (err) {
    console.error('Delete failed:', err);
    alert('Failed to delete: ' + (err.message || 'Unknown error'));
  }
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
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    const log = document.getElementById('sessionActionLog');
    try {
      await postJson(`/sessions/${state.activeSession}/logout`, {});
      state.qrMap[state.activeSession] = null;
      log.textContent = 'Logged out. Please scan the new QR code.';
    } catch (err) {
      log.textContent = `Error: ${err.message}`;
    }
  });

  // Delete session handler
  document.getElementById('deleteSessionBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to remove this session?')) return;
    const log = document.getElementById('sessionActionLog');
    try {
      await fetch(`/sessions/${state.activeSession}`, { method: 'DELETE' }).then(r => r.json());
      delete state.sessions[state.activeSession];
      delete state.qrMap[state.activeSession];
      log.textContent = 'Session removed. Redirecting...';
      setTimeout(() => {
        window.location.hash = 'sessions';
      }, 1000);
    } catch (err) {
      log.textContent = `Error: ${err.message || 'Failed to remove session'}`;
    }
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
