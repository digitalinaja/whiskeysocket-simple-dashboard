// public/js/analytics.js
// Analytics dashboard module for CRM Boarding School

/**
 * Analytics state
 */
const analyticsState = {
  dashboard: null,
  funnel: null,
  conversion: null,
  period: '30'
};

/**
 * Initialize analytics module
 */
function initAnalytics() {
  // Analytics initialization happens when view is activated
  console.log('Analytics module initialized');
}

/**
 * Fetch dashboard data
 */
async function fetchDashboard() {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/analytics/dashboard?sessionId=${sessionId}`);
    const data = await response.json();

    if (response.ok) {
      analyticsState.dashboard = data;
      renderDashboard();
    } else {
      console.error('Failed to fetch dashboard:', data.error);
    }
  } catch (error) {
    console.error('Error fetching dashboard:', error);
  }
}

/**
 * Fetch funnel data
 */
async function fetchFunnel(category = null) {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const params = new URLSearchParams({ sessionId });
    if (category) params.append('category', category);

    const response = await fetch(`/api/analytics/funnel?${params}`);
    const data = await response.json();

    if (response.ok) {
      analyticsState.funnel = data;
      renderFunnel();
    } else {
      console.error('Failed to fetch funnel:', data.error);
    }
  } catch (error) {
    console.error('Error fetching funnel:', error);
  }
}

/**
 * Fetch conversion metrics
 */
async function fetchConversion(period = '30') {
  const sessionId = window.currentSessionId;
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/analytics/conversion?sessionId=${sessionId}&period=${period}`);
    const data = await response.json();

    if (response.ok) {
      analyticsState.conversion = data;
      renderConversion();
    }
  } catch (error) {
    console.error('Error fetching conversion:', error);
  }
}

/**
 * Render dashboard
 */
function renderDashboard() {
  const data = analyticsState.dashboard;
  if (!data) return;

  // Render contact type cards
  const contactTypesContainer = document.getElementById('analyticsContactTypes');
  if (contactTypesContainer) {
    const typeLabels = {
      student_parent: '👨‍👩‍👧 Student Parents',
      prospect_parent: '🎯 Prospect Parents',
      alumni_parent: '🎓 Alumni Parents',
      external: '👥 External'
    };

    contactTypesContainer.innerHTML = Object.entries(data.contactTypes || {}).map(([type, count]) => `
      <div class="stat-card">
        <div class="stat-icon">${typeLabels[type]?.split(' ')[0] || '👤'}</div>
        <div class="stat-content">
          <div class="stat-label">${typeLabels[type]?.split(' ').slice(1).join(' ') || type}</div>
          <div class="stat-value">${count}</div>
        </div>
      </div>
    `).join('');
  }

  // Render lead status breakdown
  const leadStatusesContainer = document.getElementById('analyticsLeadStatuses');
  if (leadStatusesContainer) {
    leadStatusesContainer.innerHTML = (data.leadStatuses || []).map(status => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 12px; height: 12px; border-radius: 50%; background: ${status.color};"></span>
          <span>${escapeHtml(status.name)}</span>
        </div>
        <span style="font-weight: 600;">${status.count}</span>
      </div>
    `).join('');
  }

  // Render recent activities
  const recentActivitiesContainer = document.getElementById('analyticsRecentActivities');
  if (recentActivitiesContainer) {
    if (data.recentActivities.length === 0) {
      recentActivitiesContainer.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">No recent activities</p>';
    } else {
      recentActivitiesContainer.innerHTML = data.recentActivities.map(activity => `
        <div style="padding: 8px 0; border-bottom: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">${activity.typeIcon || '📝'}</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(activity.title)}
              </div>
              <div style="font-size: 12px; color: var(--muted);">
                ${activity.contactName ? `with ${escapeHtml(activity.contactName)}` : ''}
              </div>
            </div>
            <div style="font-size: 11px; color: var(--muted); white-space: nowrap;">
              ${formatDateTime(activity.activityDate)}
            </div>
          </div>
        </div>
      `).join('');
    }
  }

  // Render upcoming actions
  const upcomingActionsContainer = document.getElementById('analyticsUpcomingActions');
  if (upcomingActionsContainer) {
    if (data.upcomingActions.length === 0) {
      upcomingActionsContainer.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 20px;">No upcoming actions</p>';
    } else {
      upcomingActionsContainer.innerHTML = data.upcomingActions.map(action => `
        <div style="padding: 8px 0; border-bottom: 1px solid var(--border);">
          <div style="font-weight: 500;">${escapeHtml(action.title)}</div>
          <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">
            ${escapeHtml(action.nextAction || '')}
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
            📅 ${formatDate(action.nextActionDate)} • ${escapeHtml(action.contactName || '')}
          </div>
        </div>
      `).join('');
    }
  }
}

/**
 * Render funnel
 */
function renderFunnel() {
  const data = analyticsState.funnel;
  if (!data) return;

  const container = document.getElementById('analyticsFunnel');
  if (!container) return;

  const maxCount = Math.max(...(data.funnel || []).map(s => s.count));

  container.innerHTML = (data.funnel || []).map((stage, index) => {
    const width = maxCount > 0 ? (stage.count / maxCount * 100) : 0;
    const conversion = stage.conversionRate !== null ? `<span style="color: var(--muted); margin-left: 8px;">(${stage.conversionRate}% from prev)</span>` : '';

    return `
      <div style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 600;">${escapeHtml(stage.name)}</span>
            ${conversion}
          </div>
          <div style="font-weight: 600;">${stage.count}</div>
        </div>
        <div style="height: 24px; background: var(--bg); border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; background: ${stage.color}; width: ${width}%; transition: width 0.3s ease;"></div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render conversion metrics
 */
function renderConversion() {
  const data = analyticsState.conversion;
  if (!data) return;

  // Overall conversion rate
  const overallContainer = document.getElementById('analyticsConversionOverall');
  if (overallContainer) {
    overallContainer.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon">📊</div>
        <div class="stat-content">
          <div class="stat-label">Conversion Rate</div>
          <div class="stat-value">${data.overall.conversionRate}%</div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
            ${data.overall.totalConverted} of ${data.overall.totalContacts} contacts
          </div>
        </div>
      </div>
    `;
  }

  // Conversion by type
  const byTypeContainer = document.getElementById('analyticsConversionByType');
  if (byTypeContainer) {
    byTypeContainer.innerHTML = (data.byType || []).map(item => `
      <div style="padding: 12px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <strong>${formatContactType(item.contactType)}</strong>
          <span style="font-weight: 600;">${item.conversionRate}%</span>
        </div>
        <div style="height: 6px; background: var(--bg); border-radius: 3px; overflow: hidden;">
          <div style="height: 100%; background: #3b82f6; width: ${item.conversionRate}%;"></div>
        </div>
        <div style="font-size: 12px; color: var(--muted); margin-top: 4px;">
          ${item.converted} converted of ${item.total} total
        </div>
      </div>
    `).join('');
  }
}

/**
 * Format contact type for display
 */
function formatContactType(type) {
  const labels = {
    student_parent: '👨‍👩‍👧 Student Parents',
    prospect_parent: '🎯 Prospect Parents',
    alumni_parent: '🎓 Alumni Parents',
    external: '👥 External'
  };
  return labels[type] || type;
}

// Export functions
window.initAnalytics = initAnalytics;
window.fetchDashboard = fetchDashboard;
window.fetchFunnel = fetchFunnel;
window.fetchConversion = fetchConversion;
