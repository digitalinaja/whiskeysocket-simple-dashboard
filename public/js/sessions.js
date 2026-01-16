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
      opt.textContent = sessionId + (sess.user?.name ? ` (${sess.user.name})` : '');
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

  // Update session overview
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
function updateSessionsListView() {
  const listDiv = document.getElementById('sessions-list');
  const sessions = Object.values(state.sessions);

  if (sessions.length === 0) {
    listDiv.innerHTML = '<p style="color: var(--muted);">No sessions yet.</p>';
    return;
  }

  listDiv.innerHTML = sessions.map(s => `
    <div class="session-item ${state.activeSession === s.id ? 'active' : ''}" onclick="state.activeSession = '${s.id}'; window.location.hash='session-detail/${s.id}'">
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

/**
 * Initialize sessions functionality
 */
function initSessions() {
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
    updateSessionsListView();
  } catch (err) {
    console.error('Failed to load sessions', err);
  }
}
