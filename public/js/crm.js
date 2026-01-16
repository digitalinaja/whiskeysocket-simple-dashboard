// ============================================
// CRM (CONTACTS & LEADS) FUNCTIONALITY
// ============================================

/**
 * Load all CRM data
 */
async function loadCRMData(sessionId) {
  if (!sessionId) return;

  crmState.currentSession = sessionId;
  await Promise.all([
    loadCRMContacts(sessionId),
    loadCRMTags(sessionId),
    loadCRMLeadStatuses(sessionId)
  ]);

  checkGoogleConnection();
}

/**
 * Load CRM contacts
 */
async function loadCRMContacts(sessionId) {
  try {
    const params = new URLSearchParams({
      sessionId,
      page: crmState.pagination.page,
      limit: crmState.pagination.limit,
      ...crmState.filters
    });

    const res = await fetch(`/api/contacts?${params}`);
    const data = await res.json();

    if (res.ok) {
      if (data.pagination) {
        crmState.pagination = {
          page: data.pagination.page,
          limit: data.pagination.limit,
          total: data.pagination.total,
          totalPages: data.pagination.totalPages
        };
      }
      renderCRMContacts(data.contacts);
      renderPagination();
    }
  } catch (err) {
    console.error('Failed to load CRM contacts:', err);
  }
}

/**
 * Load CRM tags
 */
async function loadCRMTags(sessionId) {
  try {
    const res = await fetch(`/api/tags?sessionId=${sessionId}`);
    const data = await res.json();

    if (res.ok) {
      crmState.tags = {};
      data.tags.forEach(tag => {
        crmState.tags[tag.id] = tag;
      });

      renderCRMTagFilters();
    }
  } catch (err) {
    console.error('Failed to load tags:', err);
  }
}

/**
 * Load CRM lead statuses
 */
async function loadCRMLeadStatuses(sessionId) {
  try {
    const res = await fetch(`/api/lead-statuses?sessionId=${sessionId}`);
    const data = await res.json();

    if (res.ok) {
      crmState.leadStatuses = {};
      data.statuses.forEach(status => {
        crmState.leadStatuses[status.id] = status;
      });

      renderCRMStatusFilters();
    }
  } catch (err) {
    console.error('Failed to load lead statuses:', err);
  }
}

/**
 * Render CRM contacts grid
 */
function renderCRMContacts(contacts) {
  const gridDiv = document.getElementById('crmContactsCards');
  const { page, limit, total } = crmState.pagination;

  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  document.getElementById('crmContactCount').textContent = `Showing ${start}-${end} of ${total} contacts`;

  if (contacts.length === 0) {
    gridDiv.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 40px;">No contacts found</div>';
    return;
  }

  gridDiv.innerHTML = contacts.map(contact => {
    const status = crmState.leadStatuses[contact.leadStatusId];
    const tags = (contact.tagIds || []).map(tagId => crmState.tags[tagId]).filter(Boolean);

    return `
      <div class="contact-card" data-contact-id="${contact.id}">
        <div class="contact-card-header">
          <div class="contact-card-avatar">${contact.name ? contact.name[0] : '?'}</div>
          <div class="contact-card-info">
            <div class="contact-card-name">${contact.name || contact.phone}</div>
            <div class="contact-card-phone">${contact.phone}</div>
          </div>
        </div>
        <div class="contact-card-tags">
          ${status ? `<span class="lead-status-badge" style="background: ${status.color}20; color: ${status.color}">${status.name}</span>` : ''}
          ${tags.map(tag => `<span class="tag-badge" style="background: ${tag.color}20; color: ${tag.color}">${tag.name}</span>`).join('')}
        </div>
        <div class="contact-card-meta">
          <span>Last interaction: ${contact.lastInteraction ? formatDate(contact.lastInteraction) : 'Never'}</span>
          <span>${contact.messageCount || 0} messages</span>
        </div>
      </div>
    `;
  }).join('');

  gridDiv.querySelectorAll('.contact-card').forEach(card => {
    card.addEventListener('click', () => {
      const contactId = parseInt(card.dataset.contactId);
      showContactDetailModal(contactId);
    });
  });
}

/**
 * Render pagination
 */
function renderPagination() {
  const { page, totalPages } = crmState.pagination;
  const container = document.getElementById('crmPagination');

  if (!container || totalPages <= 1) {
    if (container) container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';

  let pageNumbers = [];
  const maxVisible = 5;
  let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }

  container.innerHTML = `
    <button class="pagination-btn" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">
      ‹ Previous
    </button>
    ${startPage > 1 ? '<span class="pagination-ellipsis">...</span>' : ''}
    ${pageNumbers.map(p => `
      <button class="pagination-btn ${p === page ? 'active' : ''}" data-page="${p}">
        ${p}
      </button>
    `).join('')}
    ${endPage < totalPages ? '<span class="pagination-ellipsis">...</span>' : ''}
    <button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} data-page="${page + 1}">
      Next ›
    </button>
  `;

  container.querySelectorAll('.pagination-btn').forEach(btn => {
    if (!btn.disabled) {
      btn.addEventListener('click', () => {
        const newPage = parseInt(btn.dataset.page);
        crmState.pagination.page = newPage;
        loadCRMContacts(crmState.currentSession);
      });
    }
  });
}

/**
 * Render tag filters
 */
function renderCRMTagFilters() {
  const container = document.getElementById('crmTagsFilter');
  const tags = Object.values(crmState.tags);

  if (tags.length === 0) {
    container.innerHTML = '<div style="color: var(--muted); font-size: 13px;">No tags</div>';
    return;
  }

  container.innerHTML = tags.map(tag => `
    <label class="tag-checkbox">
      <input type="checkbox" value="${tag.id}" data-tag-name="${tag.name}">
      <span style="color: ${tag.color}">${tag.name}</span>
    </label>
  `).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      crmState.filters.tagIds = Array.from(container.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
      crmState.pagination.page = 1;
      loadCRMContacts(crmState.currentSession);
    });
  });
}

/**
 * Render status filters
 */
function renderCRMStatusFilters() {
  const select = document.getElementById('crmStatusFilter');
  const statuses = Object.values(crmState.leadStatuses);

  select.innerHTML = '<option value="">All Statuses</option>' +
    statuses.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

  select.addEventListener('change', (e) => {
    crmState.filters.statusId = e.target.value;
    crmState.pagination.page = 1;
    loadCRMContacts(crmState.currentSession);
  });
}

/**
 * Show contact detail modal
 */
async function showContactDetailModal(contactId) {
  const modal = document.getElementById('contactDetailModal');
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/contacts/${contactId}?sessionId=${crmState.currentSession}`);
    const data = await res.json();

    if (res.ok) {
      renderContactDetailModal(data.contact);
    }
  } catch (err) {
    console.error('Failed to load contact details:', err);
  }
}

/**
 * Render contact detail modal
 */
function renderContactDetailModal(contact) {
  const modalBody = document.getElementById('contactDetailModalBody');

  const status = crmState.leadStatuses[contact.leadStatusId];
  const tags = contact.tags || [];

  modalBody.innerHTML = `
    <div class="contact-detail-header">
      <div class="contact-avatar">${contact.name ? contact.name[0] : '?'}</div>
      <h3>${contact.name || 'Unknown'}</h3>
      <p style="color: var(--muted);">${contact.phone}</p>
    </div>

    <div class="contact-detail-section">
      <h4>Lead Status</h4>
      <select id="contactStatusSelect">
        ${Object.values(crmState.leadStatuses).map(s =>
          `<option value="${s.id}" ${s.id === contact.leadStatusId ? 'selected' : ''}>${s.name}</option>`
        ).join('')}
      </select>
    </div>

    <div class="contact-detail-section">
      <h4>Tags</h4>
      <div class="contact-tags-list">
        ${tags.map(tag =>
          `<span class="tag-badge" style="background: ${tag.color}20; color: ${tag.color}; padding: 6px 12px;">
            ${tag.name}
          </span>`
        ).join('')}
      </div>
    </div>

    <div class="contact-detail-section">
      <h4>Notes</h4>
      <div id="contactNotesList">
        ${(contact.notes || []).map(note =>
          `<div class="note-item">
            <div style="font-size: 12px; color: var(--muted); margin-bottom: 4px;">${formatDateTime(note.createdAt)}</div>
            <div>${escapeHtml(note.content)}</div>
          </div>`
        ).join('')}
      </div>
      <textarea id="newNoteContent" placeholder="Add a note..." rows="2" style="margin-bottom: 8px;"></textarea>
      <button id="addNoteToContact" class="btn-sm">Add Note</button>
    </div>

    <div class="modal-actions">
      <button id="openChatFromModal" class="btn-primary">Open Chat</button>
    </div>
  `;

  document.getElementById('contactStatusSelect')?.addEventListener('change', async (e) => {
    await updateContactStatus(contact.id, e.target.value);
  });

  document.getElementById('addNoteToContact')?.addEventListener('click', async () => {
    const content = document.getElementById('newNoteContent').value.trim();
    if (content) {
      await addNoteToContact(contact.id, content);
    }
  });

  document.getElementById('openChatFromModal')?.addEventListener('click', async () => {
    if (!chatState.contacts[contact.id]) {
      chatState.contacts[contact.id] = contact;
    }

    if (!chatState.currentSession) {
      chatState.currentSession = contact.sessionId;
    }

    const modal = document.getElementById('contactDetailModal');
    modal.classList.remove('active');
    window.location.hash = 'chat';

    setTimeout(() => {
      openChatContact(contact.id);
    }, 200);
  });
}

/**
 * Update contact status
 */
async function updateContactStatus(contactId, statusId) {
  try {
    const res = await fetch(`/api/contacts/${contactId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: crmState.currentSession, statusId })
    });

    if (res.ok) {
      alert('Status updated!');
      loadCRMContacts(crmState.currentSession);
    }
  } catch (err) {
    alert('Failed to update status');
  }
}

/**
 * Add note to contact
 */
async function addNoteToContact(contactId, content) {
  try {
    const res = await fetch(`/api/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: crmState.currentSession, content })
    });

    if (res.ok) {
      document.getElementById('newNoteContent').value = '';
      showContactDetailModal(contactId);
    }
  } catch (err) {
    alert('Failed to add note');
  }
}

/**
 * Check Google Contacts connection
 */
async function checkGoogleConnection() {
  if (!crmState.currentSession) return;

  try {
    const res = await fetch(`/api/google/sync-status?sessionId=${crmState.currentSession}`);
    const data = await res.json();

    if (data.connected) {
      document.getElementById('googleStatus').style.display = 'flex';
      document.getElementById('googleNotConnected').style.display = 'none';
    } else {
      document.getElementById('googleStatus').style.display = 'none';
      document.getElementById('googleNotConnected').style.display = 'flex';
    }
  } catch (err) {
    console.error('Failed to check Google connection:', err);
  }
}

/**
 * Initialize CRM functionality
 */
function initCRM() {
  document.getElementById('crmSearchInput')?.addEventListener('input', (e) => {
    crmState.filters.search = e.target.value;
    crmState.pagination.page = 1;
    setTimeout(() => loadCRMContacts(crmState.currentSession), 300);
  });

  // Google Contacts handlers
  document.getElementById('connectGoogleBtn')?.addEventListener('click', () => {
    window.location.href = '/auth/google';
  });

  document.getElementById('disconnectGoogleBtn')?.addEventListener('click', async () => {
    if (!crmState.currentSession) return;

    try {
      const res = await fetch('/api/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: crmState.currentSession })
      });

      if (res.ok) checkGoogleConnection();
    } catch (err) {
      console.error('Failed to disconnect Google:', err);
    }
  });

  document.getElementById('syncGoogleBtn')?.addEventListener('click', async () => {
    if (!crmState.currentSession) {
      alert('Please select a session first');
      return;
    }

    const btn = document.getElementById('syncGoogleBtn');
    btn.disabled = true;
    btn.textContent = '🔄 Syncing...';

    try {
      const res = await fetch('/api/google/sync-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: crmState.currentSession })
      });

      const data = await res.json();

      if (data.success) {
        alert(`Successfully synced ${data.synced} new contacts, ${data.merged} merged!`);
        await loadCRMContacts(crmState.currentSession);
      } else {
        alert('Failed to sync: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to sync Google contacts: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '📇 Sync Google Contacts';
    }
  });

  document.getElementById('syncWhatsAppBtn')?.addEventListener('click', async () => {
    if (!crmState.currentSession) {
      alert('Please select a session first');
      return;
    }

    const btn = document.getElementById('syncWhatsAppBtn');
    btn.disabled = true;
    btn.textContent = '📱 Syncing...';

    try {
      const res = await fetch('/api/whatsapp/sync-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: crmState.currentSession })
      });

      const data = await res.json();

      if (data.success) {
        alert(`Successfully synced ${data.synced || 0} new contacts, ${data.updated || 0} updated!`);
        await loadCRMContacts(crmState.currentSession);
      } else {
        alert('Failed to sync: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to sync WhatsApp contacts: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '📱 Sync WhatsApp';
    }
  });

  // Modal close handlers
  document.getElementById('closeContactModal')?.addEventListener('click', () => {
    document.getElementById('contactDetailModal').classList.remove('active');
  });

  document.getElementById('contactDetailModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'contactDetailModal') {
      e.target.classList.remove('active');
    }
  });
}
