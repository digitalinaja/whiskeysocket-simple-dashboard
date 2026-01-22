// public/js/activities.js
// Activities module for CRM Boarding School

/**
 * Activities state
 */
const activitiesState = {
  currentContactId: null,
  activities: [],
  activityTypes: [],
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  },
  filters: {
    activityTypeId: null,
    startDate: null,
    endDate: null
  }
};

/**
 * Initialize activities module
 */
function initActivities() {
  // Setup activity modal handlers if they exist
  setupActivityModalHandlers();
}

/**
 * Setup activity modal handlers
 */
function setupActivityModalHandlers() {
  const modal = document.getElementById('activityModal');
  if (!modal) return;

  const form = document.getElementById('activityForm');
  const closeBtn = document.getElementById('closeActivityModal');

  if (form) {
    form.addEventListener('submit', handleActivitySubmit);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  // Close modal when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
}

/**
 * Fetch activities for a contact
 */
async function fetchContactActivities(contactId) {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const params = new URLSearchParams({ sessionId });
    Object.entries(activitiesState.filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });

    const response = await fetch(`/api/contacts/${contactId}/activities?${params}`);
    const data = await response.json();

    if (response.ok) {
      activitiesState.activities = data.activities || [];
      activitiesState.currentContactId = contactId;
      renderActivities();
    } else {
      console.error('Failed to fetch activities:', data.error);
    }
  } catch (error) {
    console.error('Error fetching activities:', error);
  }
}

/**
 * Fetch all activities
 */
async function fetchActivities() {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const params = new URLSearchParams({
      sessionId,
      page: activitiesState.pagination.page,
      limit: activitiesState.pagination.limit
    });

    Object.entries(activitiesState.filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });

    const response = await fetch(`/api/activities?${params}`);
    const data = await response.json();

    if (response.ok) {
      activitiesState.activities = data.activities || [];
      activitiesState.pagination = data.pagination || activitiesState.pagination;
      renderActivities();
    } else {
      console.error('Failed to fetch activities:', data.error);
    }
  } catch (error) {
    console.error('Error fetching activities:', error);
  }
}

/**
 * Fetch activity types
 */
async function fetchActivityTypes() {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/activity-types?sessionId=${sessionId}`);
    const data = await response.json();

    if (response.ok) {
      activitiesState.activityTypes = data.activityTypes || [];
      renderActivityTypeOptions();
    }
  } catch (error) {
    console.error('Error fetching activity types:', error);
  }
}

/**
 * Render activities list
 */
function renderActivities() {
  const container = document.getElementById('activitiesList');
  if (!container) return;

  if (activitiesState.activities.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--muted);">
        <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
        <p>No activities yet</p>
        <button onclick="openActivityModal()" class="btn-sm" style="margin-top: 16px;">
          + Add First Activity
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = activitiesState.activities.map(activity => `
    <div class="activity-item" style="padding: 12px 16px; border-bottom: 1px solid var(--border);">
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="font-size: 24px; flex-shrink: 0;">
          ${activity.activityType?.icon || '📝'}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; color: var(--text); margin-bottom: 4px;">
            ${escapeHtml(activity.title)}
          </div>
          ${activity.description ? `
            <div style="font-size: 14px; color: var(--muted); margin-bottom: 8px;">
              ${escapeHtml(activity.description)}
            </div>
          ` : ''}
          <div style="display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--muted);">
            <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 4px; background: ${activity.activityType?.color || '#6366f1'}20; color: ${activity.activityType?.color || '#6366f1'};">
              ${escapeHtml(activity.activityType?.name || 'Activity')}
            </span>
            <span>📅 ${formatDateTime(activity.activityDate)}</span>
            ${activity.createdBy ? `<span>👤 ${escapeHtml(activity.createdBy)}</span>` : ''}
          </div>
          ${activity.nextAction ? `
            <div style="margin-top: 8px; padding: 8px; background: var(--bg); border-radius: 4px; font-size: 13px;">
              <strong>Next Action:</strong> ${escapeHtml(activity.nextAction)}
              ${activity.nextActionDate ? `<span style="color: var(--muted);"> (${formatDate(activity.nextActionDate)})</span>` : ''}
            </div>
          ` : ''}
        </div>
        <div style="flex-shrink: 0;">
          <button onclick="editActivity(${activity.id})" class="btn-icon" title="Edit">✏️</button>
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Render activity type options in select
 */
function renderActivityTypeOptions() {
  const select = document.getElementById('activityTypeId');
  if (!select) return;

  select.innerHTML = '<option value="">Select type...</option>' +
    activitiesState.activityTypes.map(type =>
      `<option value="${type.id}">${type.icon || ''} ${escapeHtml(type.name)}</option>`
    ).join('');
}

/**
 * Open activity modal for creating new activity
 */
function openActivityModal(contactId = null) {
  const modal = document.getElementById('activityModal');
  const form = document.getElementById('activityForm');
  if (!modal || !form) return;

  // Reset form
  form.reset();

  // Set contact ID if provided
  if (contactId) {
    const contactIdInput = document.getElementById('activityContactId');
    if (contactIdInput) contactIdInput.value = contactId;
  }

  // Fetch activity types if not loaded
  if (activitiesState.activityTypes.length === 0) {
    fetchActivityTypes();
  } else {
    renderActivityTypeOptions();
  }

  modal.style.display = 'block';
}

/**
 * Edit existing activity
 */
async function editActivity(activityId) {
  try {
    const sessionId = window.currentSessionId;
    const response = await fetch(`/api/activities/${activityId}?sessionId=${sessionId}`);
    const data = await response.json();

    if (response.ok) {
      const activity = data.activity;

      // Open modal and populate form
      openActivityModal();

      const form = document.getElementById('activityForm');
      if (form) {
        form.querySelector('[name="id"]').value = activity.id;
        form.querySelector('[name="activityTypeId"]').value = activity.activityType?.id || '';
        form.querySelector('[name="title"]').value = activity.title || '';
        form.querySelector('[name="description"]').value = activity.description || '';
        form.querySelector('[name="activityDate"]').value = activity.activityDate ? new Date(activity.activityDate).toISOString().slice(0, 16) : '';
        form.querySelector('[name="outcome"]').value = activity.outcome || '';
        form.querySelector('[name="nextAction"]').value = activity.nextAction || '';
        form.querySelector('[name="nextActionDate"]').value = activity.nextActionDate || '';
      }
    }
  } catch (error) {
    console.error('Error fetching activity:', error);
  }
}

/**
 * Handle activity form submit
 */
async function handleActivitySubmit(e) {
  e.preventDefault();

  const form = e.target;
  const formData = new FormData(form);
  const activityId = formData.get('id');

  const payload = {
    sessionId: window.currentSessionId,
    contactId: formData.get('contactId') || activitiesState.currentContactId,
    activityTypeId: formData.get('activityTypeId'),
    title: formData.get('title'),
    description: formData.get('description') || null,
    activityDate: formData.get('activityDate') || new Date().toISOString(),
    outcome: formData.get('outcome') || null,
    nextAction: formData.get('nextAction') || null,
    nextActionDate: formData.get('nextActionDate') || null
  };

  try {
    const url = activityId ? `/api/activities/${activityId}` : '/api/activities';
    const method = activityId ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      // Close modal
      document.getElementById('activityModal').style.display = 'none';

      // Refresh activities
      if (activitiesState.currentContactId) {
        fetchContactActivities(activitiesState.currentContactId);
      } else {
        fetchActivities();
      }

      showNotification('Activity saved successfully!', 'success');
    } else {
      showNotification('Failed to save activity: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error saving activity:', error);
    showNotification('Failed to save activity', 'error');
  }
}

/**
 * Delete activity
 */
async function deleteActivity(activityId) {
  if (!confirm('Are you sure you want to delete this activity?')) return;

  try {
    const sessionId = window.currentSessionId;
    const response = await fetch(`/api/activities/${activityId}?sessionId=${sessionId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showNotification('Activity deleted', 'success');

      // Refresh activities
      if (activitiesState.currentContactId) {
        fetchContactActivities(activitiesState.currentContactId);
      } else {
        fetchActivities();
      }
    } else {
      showNotification('Failed to delete activity', 'error');
    }
  } catch (error) {
    console.error('Error deleting activity:', error);
    showNotification('Failed to delete activity', 'error');
  }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
  // Check if existing notification function exists
  if (typeof window.showNotification === 'function') {
    window.showNotification(message, type);
  } else {
    // Fallback: create temporary notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed; bottom: 20px; right: 20px;
      padding: 12px 24px; border-radius: 8px;
      background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white; z-index: 10000; animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
}

// Export functions for global access
window.initActivities = initActivities;
window.fetchContactActivities = fetchContactActivities;
window.fetchActivities = fetchActivities;
window.fetchActivityTypes = fetchActivityTypes;
window.openActivityModal = openActivityModal;
window.editActivity = editActivity;
window.deleteActivity = deleteActivity;
