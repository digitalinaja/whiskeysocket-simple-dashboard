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
 * CS Performance state
 */
const csPerformanceState = {
  currentSession: null,
  currentPeriod: '7d',
  responseTime: null,
  messageVolume: null,
  hourlyPerformance: null,
  topContacts: null,
  loading: false
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

/**
 * Fetch CS Performance data
 */
async function fetchCSPerformance(period = '7d') {
  const sessionId = csPerformanceState.currentSession;
  if (!sessionId) {
    console.warn('No session ID available for CS Performance');
    return;
  }

  csPerformanceState.loading = true;
  csPerformanceState.currentPeriod = period;

  try {
    // Fetch all metrics in parallel
    const [responseTime, volume, hourly, contacts] = await Promise.all([
      fetch(`/api/analytics/cs/response-time?sessionId=${sessionId}&period=${period}`).then(r => r.json()),
      fetch(`/api/analytics/cs/message-volume?sessionId=${sessionId}&period=${period}`).then(r => r.json()),
      fetch(`/api/analytics/cs/hourly-performance?sessionId=${sessionId}&period=${period}`).then(r => r.json()),
      fetch(`/api/analytics/cs/top-contacts?sessionId=${sessionId}&period=${period}&limit=10`).then(r => r.json())
    ]);

    csPerformanceState.responseTime = responseTime;
    csPerformanceState.messageVolume = volume;
    csPerformanceState.hourlyPerformance = hourly;
    csPerformanceState.topContacts = contacts;

    renderCSPerformance();
  } catch (error) {
    console.error('Error fetching CS performance:', error);
  } finally {
    csPerformanceState.loading = false;
  }
}

/**
 * Render all CS Performance visualizations
 */
function renderCSPerformance() {
  renderCSResponseTimeCard();
  renderCSMessageVolumeChart();
  renderCSHourlyPerformance();
  renderCSTopContacts();
}

/**
 * Render Response Time Card
 */
function renderCSResponseTimeCard() {
  const data = csPerformanceState.responseTime;
  if (!data) return;

  // Average response time
  const avgResponseEl = document.getElementById('cs-avg-response');
  if (avgResponseEl) {
    avgResponseEl.textContent = data.averageResponseTime.formatted;
  }

  // Trend
  const trendEl = document.getElementById('cs-response-trend');
  if (trendEl) {
    trendEl.textContent = data.averageResponseTime.trend;
  }

  // Response distribution
  const under1MinEl = document.getElementById('cs-under-1min');
  if (under1MinEl) {
    under1MinEl.textContent = `${data.responseDistribution.under1Min}% < 1m`;
  }

  const under5MinEl = document.getElementById('cs-under-5min');
  if (under5MinEl) {
    under5MinEl.textContent = `${data.responseDistribution.under5Min}% < 5m`;
  }

  // Total conversations
  const totalConversationsEl = document.getElementById('cs-total-conversations');
  if (totalConversationsEl) {
    totalConversationsEl.textContent = data.totalConversations || 0;
  }

  // Fastest response
  const fastestEl = document.getElementById('cs-fastest-response');
  if (fastestEl) {
    fastestEl.textContent = `Fastest: ${data.fastestResponse || '-'}`;
  }
}

/**
 * Render Message Volume Chart
 */
function renderCSMessageVolumeChart() {
  const data = csPerformanceState.messageVolume;
  if (!data || !data.dailyVolumes) return;

  const container = document.getElementById('volume-chart');
  if (!container) return;

  const volumes = data.dailyVolumes;
  if (volumes.length === 0) {
    container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 200px; color: var(--muted);">No data available</div>';
    return;
  }

  const maxVolume = Math.max(...volumes.map(d => d.total));

  // Update stats
  const avgDailyEl = document.getElementById('cs-avg-daily');
  if (avgDailyEl) {
    avgDailyEl.textContent = data.summary.averagePerDay || 0;
  }

  const peakDayEl = document.getElementById('cs-peak-day');
  if (peakDayEl && data.summary.peakDay) {
    const peakDate = new Date(data.summary.peakDay);
    const formattedDate = peakDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    peakDayEl.textContent = `Peak: ${formattedDate}`;
  }

  // Create CSS-based bar chart
  container.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: flex-end; height: 200px; padding: 16px; overflow-x: auto;">
      ${volumes.map(day => {
        const date = new Date(day.date);
        const label = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const incomingHeight = maxVolume > 0 ? (day.incoming / maxVolume) * 100 : 0;
        const outgoingHeight = maxVolume > 0 ? (day.outgoing / maxVolume) * 100 : 0;

        return `
          <div style="display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 40px;">
            <div style="font-size: 11px; color: var(--muted); margin-bottom: 4px;">${day.total}</div>
            <div style="display: flex; gap: 2px; height: 150px; align-items: flex-end;">
              <div style="width: 12px; height: ${incomingHeight}%; background: var(--color-primary, #3b82f6); border-radius: 4px 4px 0 0; transition: height 0.3s ease; min-height: 4px;" title="Incoming: ${day.incoming}"></div>
              <div style="width: 12px; height: ${outgoingHeight}%; background: var(--color-secondary, #8b5cf6); border-radius: 4px 4px 0 0; transition: height 0.3s ease; min-height: 4px;" title="Outgoing: ${day.outgoing}"></div>
            </div>
            <div style="font-size: 10px; color: var(--muted); margin-top: 4px; text-align: center; transform: rotate(-45deg); transform-origin: center; white-space: nowrap;">${label}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render Hourly Performance
 */
function renderCSHourlyPerformance() {
  const data = csPerformanceState.hourlyPerformance;
  if (!data || !data.hourlyData) return;

  const container = document.getElementById('hourly-chart');
  if (!container) return;

  const hourlyData = data.hourlyData;

  // Update peak hour stats
  if (data.peakHour) {
    const peakHourEl = document.getElementById('cs-peak-hour');
    if (peakHourEl) {
      peakHourEl.textContent = `${data.peakHour.hour}:00`;
    }

    const peakVolumeEl = document.getElementById('cs-peak-volume');
    if (peakVolumeEl) {
      peakVolumeEl.textContent = `${data.peakHour.volume} pesan`;
    }
  }

  // Create 24-hour heatmap
  const maxVolume = Math.max(...hourlyData.map(h => h.totalMessages || 0));

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(24, 1fr); gap: 4px; padding: 16px;">
      ${hourlyData.map(hour => {
        const volume = hour.totalMessages || 0;
        const percentage = maxVolume > 0 ? (volume / maxVolume) * 100 : 0;
        let bgClass = 'background: #22c55e;'; // green - low
        if (volume > 100) {
          bgClass = 'background: #ef4444;'; // red - high
        } else if (volume > 30) {
          bgClass = 'background: #eab308;'; // yellow - medium
        }

        return `
          <div style="aspect-ratio: 1; border-radius: 4px; ${bgClass} display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: 600; position: relative; cursor: default;" title="${hour.hour}:00 - ${volume} messages">
            ${hour.hour}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render Top Contacts
 */
function renderCSTopContacts() {
  const data = csPerformanceState.topContacts;
  if (!data || !data.contacts) return;

  const container = document.getElementById('top-contacts-list');
  if (!container) return;

  const contacts = data.contacts;

  if (contacts.length === 0) {
    container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 200px; color: var(--muted);">No contacts data available</div>';
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${contacts.map((contact, index) => `
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg);">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--color-primary, #3b82f6); color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px;">
            ${index + 1}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(contact.name)}
            </div>
            <div style="font-size: 12px; color: var(--muted);">
              ${contact.messageCount} pesan • ${contact.lastMessageFormatted || '-'}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; color: var(--muted);">
              <span style="color: var(--color-primary, #3b82f6);">↓ ${contact.incomingCount}</span> •
              <span style="color: var(--color-secondary, #8b5cf6);">↑ ${contact.outgoingCount}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Initialize CS Performance module
 */
function initCSPerformance() {
  // Set up session selector
  const sessionSelect = document.getElementById('csPerformanceSessionSelect');
  if (sessionSelect) {
    sessionSelect.addEventListener('change', (e) => {
      const sessionId = e.target.value;
      csPerformanceState.currentSession = sessionId;
      if (sessionId) {
        fetchCSPerformance(csPerformanceState.currentPeriod);
      }
    });
  }

  // Set up period filter buttons
  const periodButtons = document.querySelectorAll('.period-filter-btn');
  periodButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Update active state
      periodButtons.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      // Fetch data for selected period
      const period = e.target.dataset.period;
      fetchCSPerformance(period);
    });
  });
}

// Export functions
window.initAnalytics = initAnalytics;
window.fetchDashboard = fetchDashboard;
window.fetchFunnel = fetchFunnel;
window.fetchConversion = fetchConversion;
window.fetchCSPerformance = fetchCSPerformance;
window.initCSPerformance = initCSPerformance;
window.csPerformanceState = csPerformanceState;
