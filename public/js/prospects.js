// public/js/prospects.js
// Prospects funnel management module for CRM Boarding School

/**
 * Prospects state
 */
const prospectsState = {
  contacts: [],
  funnelStages: [],
  selectedStage: null,
  filters: {
    contactType: 'prospect_parent',
    search: '',
    academicYear: null
  },
  pagination: {
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  }
};

/**
 * Initialize prospects module
 */
function initProspects() {
  console.log('Prospects module initialized');
}

/**
 * Fetch prospects (contacts filtered by type)
 */
async function fetchProspects() {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const params = new URLSearchParams({
      sessionId,
      contactType: prospectsState.filters.contactType,
      page: prospectsState.pagination.page,
      limit: prospectsState.pagination.limit
    });

    if (prospectsState.filters.search) {
      params.append('search', prospectsState.filters.search);
    }

    const response = await fetch(`/api/contacts?${params}`);
    const data = await response.json();

    if (response.ok) {
      prospectsState.contacts = data.contacts || [];
      prospectsState.pagination = data.pagination || prospectsState.pagination;
      renderProspectsFunnel();
    } else {
      console.error('Failed to fetch prospects:', data.error);
    }
  } catch (error) {
    console.error('Error fetching prospects:', error);
  }
}

/**
 * Fetch funnel stages (lead statuses)
 */
async function fetchFunnelStages() {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/lead-statuses?sessionId=${sessionId}`);
    const data = await response.json();

    if (response.ok) {
      // Filter for enrollment category if available
      prospectsState.funnelStages = (data.statuses || [])
        .filter(s => !s.category || s.category === 'enrollment' || s.category === 'general')
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

      renderFunnelFilters();
    }
  } catch (error) {
    console.error('Error fetching funnel stages:', error);
  }
}

/**
 * Render prospects funnel view (Kanban-style)
 */
function renderProspectsFunnel() {
  const container = document.getElementById('prospectsFunnelContainer');
  if (!container) return;

  if (prospectsState.funnelStages.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 40px;">No funnel stages configured. Please create lead statuses first.</p>';
    return;
  }

  // Group contacts by stage
  const stagesWithContacts = prospectsState.funnelStages.map(stage => ({
    ...stage,
    contacts: prospectsState.contacts.filter(c => c.leadStatus?.id === stage.id)
  }));

  container.innerHTML = `
    <div style="display: flex; gap: 16px; overflow-x: auto; padding: 16px 0;">
      ${stagesWithContacts.map(stage => renderFunnelStage(stage)).join('')}
    </div>
  `;
}

/**
 * Render single funnel stage column
 */
function renderFunnelStage(stage) {
  return `
    <div style="flex: 0 0 280px; background: var(--bg); border-radius: 8px; padding: 12px; height: fit-content; max-height: calc(100vh - 200px); overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 12px; height: 12px; border-radius: 50%; background: ${stage.color};"></span>
          <strong>${escapeHtml(stage.name)}</strong>
        </div>
        <span style="background: var(--border); padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">
          ${stage.contacts.length}
        </span>
      </div>

      ${stage.contacts.map(contact => renderProspectCard(contact, stage.id)).join('')}
    </div>
  `;
}

/**
 * Render prospect contact card
 */
function renderProspectCard(contact, stageId) {
  return `
    <div class="prospect-card" data-contact-id="${contact.id}" style="background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 8px; cursor: pointer;"
         onclick="viewContactDetails(${contact.id})">
      <div style="font-weight: 500; margin-bottom: 4px;">${escapeHtml(contact.name || 'Unknown')}</div>
      <div style="font-size: 13px; color: var(--muted); margin-bottom: 8px;">
        📱 ${escapeHtml(contact.phone || '')}
      </div>
      ${contact.externalStudentIds && JSON.parse(contact.externalStudentIds || '[]').length > 0 ? `
        <div style="font-size: 12px; color: var(--muted);">
          👨‍👩‍👧 ${JSON.parse(contact.externalStudentIds).length} student(s) linked
        </div>
      ` : ''}
      ${contact.latestNote ? `
        <div style="font-size: 12px; color: var(--muted); margin-top: 8px; padding: 8px; background: var(--bg); border-radius: 4px;">
          📝 ${escapeHtml(contact.latestNote.content?.substring(0, 60) || '')}${contact.latestNote.content?.length > 60 ? '...' : ''}
        </div>
      ` : ''}
      <div style="display: flex; gap: 4px; margin-top: 8px;">
        <button onclick="event.stopPropagation(); quickStatusChange(${contact.id}, ${stageId})" class="btn-sm" style="flex: 1; font-size: 11px;">
          Move Stage
        </button>
        <button onclick="event.stopPropagation(); openContactChat('${contact.phone}')" class="btn-sm" style="flex: 1; font-size: 11px;">
          💬
        </button>
      </div>
    </div>
  `;
}

/**
 * Render funnel filters
 */
function renderFunnelFilters() {
  const container = document.getElementById('prospectsFunnelFilters');
  if (!container) return;

  container.innerHTML = `
    <select id="prospectsStageFilter" onchange="filterByStage(this.value)" style="padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text);">
      <option value="">All Stages</option>
      ${prospectsState.funnelStages.map(stage =>
        `<option value="${stage.id}">${stage.icon ? stage.icon + ' ' : ''}${escapeHtml(stage.name)}</option>`
      ).join('')}
    </select>
  `;
}

/**
 * Filter prospects by stage
 */
function filterByStage(stageId) {
  prospectsState.selectedStage = stageId || null;
  renderProspectsFunnel();
}

/**
 * Quick status change for a contact
 */
async function quickStatusChange(contactId, currentStageId) {
  // Show next stage options
  const currentIndex = prospectsState.funnelStages.findIndex(s => s.id === currentStageId);
  const nextStages = prospectsState.funnelStages.filter((_, i) => i !== currentIndex);

  if (nextStages.length === 0) {
    showNotification('No other stages available', 'error');
    return;
  }

  const stageNames = nextStages.map(s => `${s.id}:${s.name}`).join('\n');
  const selection = prompt(`Move to stage:\n${stageNames.map(s => s.split(':')[1]).join('\n')}\n\nEnter stage number or name:`);

  if (!selection) return;

  const selectedStage = nextStages.find(s =>
    s.id.toString() === selection.trim() ||
    s.name.toLowerCase().includes(selection.trim().toLowerCase())
  );

  if (!selectedStage) {
    showNotification('Invalid stage selected', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/contacts/${contactId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: window.currentSessionId,
        statusId: selectedStage.id
      })
    });

    if (response.ok) {
      showNotification(`Moved to ${selectedStage.name}`, 'success');
      fetchProspects(); // Refresh
    } else {
      showNotification('Failed to update status', 'error');
    }
  } catch (error) {
    console.error('Error updating status:', error);
    showNotification('Failed to update status', 'error');
  }
}

/**
 * Open contact chat
 */
function openContactChat(phone) {
  window.location.hash = `chat?phone=${phone}`;
}

/**
 * View contact details
 */
function viewContactDetails(contactId) {
  // Open contact detail modal
  if (typeof window.showContactDetail === 'function') {
    window.showContactDetail(contactId);
  } else {
    window.location.hash = `contacts?detail=${contactId}`;
  }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  if (typeof window.showNotification === 'function') {
    window.showNotification(message, type);
  } else {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed; bottom: 20px; right: 20px;
      padding: 12px 24px; border-radius: 8px;
      background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white; z-index: 10000;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

// Export functions
window.initProspects = initProspects;
window.fetchProspects = fetchProspects;
window.fetchFunnelStages = fetchFunnelStages;
window.filterByStage = filterByStage;
window.quickStatusChange = quickStatusChange;
