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
  checkOutlookConnection();
}

/**
 * Load CRM contacts
 */
async function loadCRMContacts(sessionId) {
  try {
    const params = new URLSearchParams({
      sessionId,
      page: crmState.pagination.page,
      limit: crmState.pagination.limit
    });

    if (crmState.filters.search) {
      params.set('search', crmState.filters.search);
    }

    if (crmState.filters.statusId) {
      params.set('statusId', crmState.filters.statusId);
    }

    if (crmState.filters.tagIds?.length) {
      params.set('tagIds', crmState.filters.tagIds.join(','));
    }

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
    } else {
      console.error('Failed to load CRM contacts:', data.error || data.message);
      alert(`Gagal memuat contacts: ${data.error || data.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Failed to load CRM contacts:', err);
    alert('Gagal memuat contacts. Silakan coba lagi atau hubungi admin.');
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
    const latestNote = contact.latestNote;
    const displayName = contact.name || contact.phone;
    const avatarInitial = displayName ? displayName[0] : '?';

    const statusMarkup = status
      ? `<span class="lead-status-pill" style="--status-color:${status.color}">${status.name}</span>`
      : '<span class="lead-status-empty">No status</span>';

    const tagsMarkup = tags.length
      ? tags.map(tag => `<span class="tag-badge" style="background: ${tag.color}20; color: ${tag.color}">${tag.name}</span>`).join('')
      : '<span class="tag-empty">No tags</span>';

    const latestNoteMarkup = latestNote ? `
      <div class="contact-card-note">
        <div class="note-icon">📝</div>
        <div class="note-content">
          <div class="note-text">${escapeHtml(truncateText(latestNote.content, 90))}</div>
          <div class="note-time">${formatDateTime(latestNote.createdAt)}</div>
        </div>
      </div>
    ` : '';

    return `
      <div class="contact-card" data-contact-id="${contact.id}">
        <div class="contact-card-header">
          <div class="contact-card-avatar">${avatarInitial}</div>
          <div class="contact-card-info">
            <div class="contact-card-name">${displayName}</div>
            <div class="contact-card-phone">${contact.phone}</div>
          </div>
        </div>
        <div class="contact-card-status">
          <span class="status-label">Lead Status</span>
          ${statusMarkup}
        </div>
        <div class="contact-card-tags">
          ${tagsMarkup}
        </div>
        ${latestNoteMarkup}
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

function truncateText(text, maxLength = 80) {
  if (!text) return '';
  const clean = text.trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
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

  const selected = new Set(crmState.filters.tagIds);

  container.innerHTML = `
    <div class="tag-filter-controls">
      <input type="text" id="tagFilterSearch" class="tag-filter-search" placeholder="Search tags...">
      <button type="button" id="clearTagFilters" class="tag-filter-clear" ${selected.size ? '' : 'disabled'}>Clear</button>
    </div>
    <div class="tag-filter-chips" id="tagFilterChipList">
      ${tags.map(tag => `
        <button type="button"
          class="tag-filter-chip ${selected.has(tag.id) ? 'active' : ''}"
          data-tag-id="${tag.id}"
          data-tag-name="${escapeHtml(tag.name)}"
          style="--chip-color:${tag.color};">
          <span class="chip-dot" style="background:${tag.color}"></span>
          ${escapeHtml(tag.name)}
        </button>
      `).join('')}
    </div>
  `;

  const chipList = container.querySelector('#tagFilterChipList');
  chipList?.querySelectorAll('.tag-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = parseInt(chip.dataset.tagId, 10);
      if (!id) return;

      if (selected.has(id)) {
        selected.delete(id);
        chip.classList.remove('active');
      } else {
        selected.add(id);
        chip.classList.add('active');
      }

      crmState.filters.tagIds = Array.from(selected);
      crmState.pagination.page = 1;
      loadCRMContacts(crmState.currentSession);

      const clearBtn = container.querySelector('#clearTagFilters');
      if (clearBtn) {
        clearBtn.disabled = selected.size === 0;
      }
    });
  });

  container.querySelector('#clearTagFilters')?.addEventListener('click', () => {
    if (!selected.size) return;
    crmState.filters.tagIds = [];
    crmState.pagination.page = 1;
    renderCRMTagFilters();
    loadCRMContacts(crmState.currentSession);
  });

  container.querySelector('#tagFilterSearch')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    chipList?.querySelectorAll('.tag-filter-chip').forEach(chip => {
      const name = chip.dataset.tagName?.toLowerCase() || '';
      chip.style.display = name.includes(term) ? '' : 'none';
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
async function showContactDetailModal(contactId, sessionId = null) {
  const modal = document.getElementById('contactDetailModal');
  modal.classList.add('active');

  // Use provided sessionId or fall back to crmState.currentSession
  const activeSessionId = sessionId || crmState.currentSession;

  // Ensure CRM data is loaded before showing modal
  if (!crmState.currentSession || crmState.currentSession !== activeSessionId) {
    crmState.currentSession = activeSessionId;
    await loadCRMTags(activeSessionId);
    await loadCRMLeadStatuses(activeSessionId);
  }

  try {
    const res = await fetch(`/api/contacts/${contactId}?sessionId=${activeSessionId}`);
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
      <div class="contact-detail-info">
        <h3 id="contactNameHeading">${contact.name || 'Unnamed Contact'}</h3>
        <p class="text-muted">${contact.phone}</p>
        <div class="form-group mt-4">
          <label for="contactNameInput">Display Name</label>
          <input id="contactNameInput" type="text" value="${escapeHtml(contact.name || '')}" placeholder="Enter contact name">
        </div>
        <div class="helper-text">Update the display name used across chat and CRM.</div>
        <button id="saveContactNameBtn" class="btn-sm" style="margin-top: 8px;">💾 Save Name</button>
      </div>
    </div>

    <div class="contact-detail-section">
      <h4>Lead Status</h4>
      <select id="contactStatusSelect" class="form-group">
        ${Object.values(crmState.leadStatuses).map(s =>
          `<option value="${s.id}" ${s.id === contact.leadStatusId ? 'selected' : ''}>${s.name}</option>`
        ).join('')}
      </select>
    </div>

    <div class="contact-detail-section">
      <h4>Tags</h4>
      <div class="contact-tags-list">
        ${tags.map(tag =>
          `<span class="tag-badge" style="background: ${tag.color}20; color: ${tag.color};">${tag.name}</span>`
        ).join('')}
      </div>
      <div class="tag-management">
        <div class="form-group">
          <label for="existingTagSelect">Add Existing Tag</label>
          <div class="tag-input-row">
            <select id="existingTagSelect">
              <option value="">Select tag...</option>
              ${Object.values(crmState.tags).map(tag =>
                `<option value="${tag.id}">${escapeHtml(tag.name)}</option>`
              ).join('')}
            </select>
            <button id="addExistingTagBtn" class="btn-sm">＋ Add</button>
          </div>
        </div>
        <div class="form-group">
          <label>Create & Assign Tag</label>
          <div class="tag-input-row">
            <input id="newTagNameInput" type="text" placeholder="Tag name">
            <input id="newTagColorInput" type="color" value="#06b6d4" title="Pick tag color">
            <button id="createTagBtn" class="btn-sm">✨ Create</button>
          </div>
          <div class="helper-text">Creating a tag automatically assigns it to this contact.</div>
        </div>
      </div>
    </div>

    <div class="contact-detail-section">
      <h4>Notes</h4>
      <div id="contactNotesList">
        ${(contact.notes || []).map(note =>
          `<div class="note-item">
            <div class="text-muted text-xs mb-1">${formatDateTime(note.createdAt)}</div>
            <div>${escapeHtml(note.content)}</div>
          </div>`
        ).join('')}
      </div>
      <textarea id="newNoteContent" placeholder="Add a note..." rows="2" class="mb-3"></textarea>
      <button id="addNoteToContact" class="btn-sm">Add Note</button>
    </div>

    <div class="modal-actions">
      <button id="openChatFromModal" class="btn-primary">Open Chat</button>
    </div>
  `;

  const nameInput = document.getElementById('contactNameInput');
  const nameHeading = document.getElementById('contactNameHeading');
  const saveNameBtn = document.getElementById('saveContactNameBtn');
  const existingTagSelect = document.getElementById('existingTagSelect');
  const addExistingTagBtn = document.getElementById('addExistingTagBtn');
  const newTagNameInput = document.getElementById('newTagNameInput');
  const newTagColorInput = document.getElementById('newTagColorInput');
  const createTagBtn = document.getElementById('createTagBtn');

  nameInput?.addEventListener('input', () => {
    if (!nameHeading) return;
    const preview = nameInput.value.trim();
    nameHeading.textContent = preview || 'Unnamed Contact';
  });

  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNameBtn?.click();
    }
  });

  document.getElementById('contactStatusSelect')?.addEventListener('change', async (e) => {
    await updateContactStatus(contact.id, e.target.value);
  });

  saveNameBtn?.addEventListener('click', async () => {
    await updateContactName(contact.id, nameInput?.value || '');
  });

  addExistingTagBtn?.addEventListener('click', async () => {
    const selectedId = parseInt(existingTagSelect?.value || '', 10);
    if (!selectedId) {
      alert('Select a tag first');
      return;
    }
    await assignTagToContact(contact.id, { tagId: selectedId });
  });

  createTagBtn?.addEventListener('click', async () => {
    const name = newTagNameInput?.value.trim();
    const color = newTagColorInput?.value || '#06b6d4';
    if (!name) {
      alert('Enter a tag name');
      return;
    }
    await assignTagToContact(contact.id, { name, color });
    if (newTagNameInput) newTagNameInput.value = '';
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
 * Update contact name
 */
async function updateContactName(contactId, name) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    alert('Please enter a contact name');
    return;
  }

  try {
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: crmState.currentSession, name: trimmedName })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update contact name');
    }

    if (chatState.contacts?.[contactId]) {
      chatState.contacts[contactId].name = trimmedName;
    }

    if (chatState.currentContact?.id === contactId) {
      chatState.currentContact.name = trimmedName;
      const nameEl = document.getElementById('chatContactName');
      const avatarEl = document.getElementById('chatContactAvatar');
      if (nameEl) nameEl.textContent = trimmedName;
      if (avatarEl) avatarEl.textContent = trimmedName[0] || '?';
    }

    if (typeof renderChatContactsList === 'function') {
      renderChatContactsList();
    }

    alert('Name updated!');

    if (crmState.currentSession) {
      await loadCRMContacts(crmState.currentSession);
    }

    await showContactDetailModal(contactId, crmState.currentSession);
  } catch (err) {
    alert(err.message || 'Failed to update contact name');
  }
}

/**
 * Assign tag (existing or new) to contact
 */
async function assignTagToContact(contactId, { tagId, name, color }) {
  if (!crmState.currentSession) {
    alert('Select a session first');
    return;
  }

  if (!tagId && !name) {
    alert('Provide a tag or name');
    return;
  }

  try {
    const res = await fetch(`/api/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: crmState.currentSession,
        tagId,
        name,
        color
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to assign tag');
    }

    // Refresh tags when creating new ones
    if (name && !crmState.tags[data.tagId]) {
      await loadCRMTags(crmState.currentSession);
    }

    alert('Tag added!');

    await showContactDetailModal(contactId, crmState.currentSession);
    await loadCRMContacts(crmState.currentSession);
  } catch (err) {
    alert(err.message || 'Failed to assign tag');
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
 * Check Outlook/Office 365 connection
 */
async function checkOutlookConnection() {
  if (!crmState.currentSession) return;

  try {
    const res = await fetch(`/api/outlook/sync-status?sessionId=${crmState.currentSession}`);
    const data = await res.json();

    if (data.connected) {
      document.getElementById('outlookStatus').style.display = 'flex';
      document.getElementById('outlookNotConnected').style.display = 'none';
    } else {
      document.getElementById('outlookStatus').style.display = 'none';
      document.getElementById('outlookNotConnected').style.display = 'flex';
    }
  } catch (err) {
    console.error('Failed to check Outlook connection:', err);
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
      btn.textContent = '📇 Sync';
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

  // Outlook/Office 365 handlers
  document.getElementById('connectOutlookBtn')?.addEventListener('click', () => {
    if (!crmState.currentSession) {
      alert('Please select a session first');
      return;
    }
    window.location.href = `/auth/microsoft?session=${encodeURIComponent(crmState.currentSession)}`;
  });

  document.getElementById('disconnectOutlookBtn')?.addEventListener('click', async () => {
    if (!crmState.currentSession) return;

    try {
      const res = await fetch('/api/outlook/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: crmState.currentSession })
      });

      if (res.ok) checkOutlookConnection();
    } catch (err) {
      console.error('Failed to disconnect Outlook:', err);
    }
  });

  document.getElementById('syncOutlookBtn')?.addEventListener('click', async () => {
    if (!crmState.currentSession) {
      alert('Please select a session first');
      return;
    }

    const btn = document.getElementById('syncOutlookBtn');
    btn.disabled = true;
    btn.textContent = '🔄 Syncing...';

    try {
      const res = await fetch('/api/outlook/sync-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: crmState.currentSession })
      });

      const data = await res.json();

      if (data.success) {
        alert(`Successfully synced ${data.synced || 0} new, ${data.updated || 0} updated, ${data.merged || 0} merged contacts!`);
        await loadCRMContacts(crmState.currentSession);
      } else {
        alert('Failed to sync: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to sync Outlook contacts: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '📧 Sync';
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
