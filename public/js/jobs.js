// ============================================
// BROADCAST & JOBS FUNCTIONALITY
// ============================================

/**
 * Apply current job filter
 */
async function applyCurrentJobFilter() {
  const filterType = document.getElementById('jobFilterType')?.value;
  const sessionId = document.getElementById('jobsSessionSelect')?.value;
  const startDate = document.getElementById('jobStartDate')?.value;
  const endDate = document.getElementById('jobEndDate')?.value;
  const limit = document.getElementById('jobLimit')?.value;

  const filters = {};
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  if (limit) filters.limit = limit;
  if (filterType === 'session' && sessionId) filters.sessionId = sessionId;

  await fetchAllJobs(filters);
}

/**
 * Fetch all jobs with filters
 */
async function fetchAllJobs(filters = {}) {
  try {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.limit) params.append('limit', filters.limit);

    const url = `/jobs${params.toString() ? '?' + params.toString() : ''}`;
    const data = await fetch(url).then(r => r.json());

    (data.jobs || []).forEach(j => { state.jobs[j.id] = j; });

    let jobsToRender = data.jobs || [];
    if (filters.sessionId) {
      jobsToRender = jobsToRender.filter(j => j.sessionId === filters.sessionId);
    }

    renderJobList(jobsToRender);
  } catch (err) {
    console.error('Failed to fetch jobs', err);
  }
}

/**
 * Render job list
 */
function renderJobList(jobListParam = null) {
  const target = document.getElementById('jobList');

  const list = jobListParam || Object.values(state.jobs).sort((a, b) =>
    (b.startedAt || b.requestedAt || 0) - (a.startedAt || a.requestedAt || 0)
  );

  document.getElementById('jobCount').textContent = list.length;

  if (!list.length) {
    target.innerHTML = '<p class="text-muted">No jobs yet.</p>';
    return;
  }

  target.innerHTML = list.map(j => {
    const totals = j.totals || { sent: 0, skipped: 0, failed: 0, total: 0 };
    const phase = j.phase || j.status;
    const statusClass = j.status === 'completed' ? 'success' : j.status === 'failed' ? 'error' : 'warning';
    const next = j.nextResumeAt ? `<div class="job-next">Cooldown until ${new Date(j.nextResumeAt).toLocaleTimeString()}</div>` : '';

    const date = new Date(j.completedAt || j.startedAt || j.requestedAt);
    const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
      <div class="job-item" onclick="viewJobDetail('${j.id}', '${j.sessionId}')">
        <div class="job-item-header">
          <span class="job-item-id">${j.id.substring(0, 8)}...</span>
          <span class="status-badge ${statusClass}">${j.status} (${phase})</span>
          <span class="job-item-date">${dateStr}</span>
        </div>
        <div class="job-item-stats">
          <div class="job-stat">
            <div class="job-stat-label">Sent</div>
            <div class="job-stat-value">${totals.sent}</div>
          </div>
          <div class="job-stat">
            <div class="job-stat-label">Skipped</div>
            <div class="job-stat-value">${totals.skipped}</div>
          </div>
          <div class="job-stat">
            <div class="job-stat-label">Failed</div>
            <div class="job-stat-value">${totals.failed}</div>
          </div>
          <div class="job-stat">
            <div class="job-stat-label">Total</div>
            <div class="job-stat-value">${totals.total}</div>
          </div>
        </div>
        ${next}
        <div class="job-item-footer">Session: ${j.sessionId} | Click to view details →</div>
      </div>
    `;
  }).join('');
}

/**
 * View job detail
 */
window.viewJobDetail = async function(jobId, sessionId) {
  try {
    const res = await fetch(`/sessions/${sessionId}/broadcast/${jobId}`).then(r => r.json());
    currentJob = res.job;
    state.jobs[jobId] = currentJob;

    document.getElementById('jobDetailId').textContent = jobId.substring(0, 8) + '...';
    document.getElementById('jobDetailStatus').textContent = currentJob.status;
    document.getElementById('jobDetailPhase').textContent = currentJob.phase || currentJob.status;

    const statusClass = currentJob.status === 'completed' ? 'success' :
                      currentJob.status === 'failed' ? 'error' : 'warning';
    document.getElementById('jobDetailStatus').className = `status-badge ${statusClass}`;

    const totals = currentJob.totals || { sent: 0, skipped: 0, failed: 0, total: 0 };
    document.getElementById('jobDetailSent').textContent = totals.sent;
    document.getElementById('jobDetailSkipped').textContent = totals.skipped;
    document.getElementById('jobDetailFailed').textContent = totals.failed;
    document.getElementById('jobDetailTotal').textContent = totals.total;

    renderJobResults(currentJob.results || []);
    navigateTo('job-detail');
  } catch (err) {
    console.error('Failed to load job details:', err);
    alert('Failed to load job details');
  }
};

/**
 * Render job results table
 */
function renderJobResults(results, filter = '') {
  const target = document.getElementById('jobResultsList');

  if (!results || results.length === 0) {
    target.innerHTML = '<p style="color: var(--muted);">No results yet.</p>';
    return;
  }

  let filteredResults = results;
  if (filter) {
    filteredResults = results.filter(r => r.number && r.number.includes(filter));
  }

  target.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr style="border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.02);">
          <th style="text-align: left; padding: 10px; position: sticky; top: 0; background: #0f172a;">#</th>
          <th style="text-align: left; padding: 10px; position: sticky; top: 0; background: #0f172a;">Phone</th>
          <th style="text-align: left; padding: 10px; position: sticky; top: 0; background: #0f172a;">Status</th>
          <th style="text-align: left; padding: 10px; position: sticky; top: 0; background: #0f172a;">Info</th>
        </tr>
      </thead>
      <tbody>
        ${filteredResults.map((r, i) => {
          const statusClass = r.status === 'sent' ? 'success' :
                            r.status === 'failed' ? 'error' : 'warning';
          const statusIcon = r.status === 'sent' ? '✅' :
                           r.status === 'failed' ? '❌' : '⏭️';
          return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
              <td style="padding: 10px;">${i + 1}</td>
              <td style="padding: 10px; font-family: monospace;">${r.number || '-'}</td>
              <td style="padding: 10px;">
                <span class="status-badge ${statusClass}">${statusIcon} ${r.status}</span>
              </td>
              <td style="padding: 10px; color: var(--muted); max-width: 300px; word-wrap: break-word;">
                ${r.reason || r.error || '-'}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top: 12px; color: var(--muted); font-size: 13px;">
      Showing ${filteredResults.length} of ${results.length} results
    </div>
  `;
}

/**
 * Setup job detail view handlers
 */
function setupJobDetailHandlers() {
  document.getElementById('backToJobs')?.addEventListener('click', () => {
    window.location.hash = 'jobs';
  });

  document.getElementById('jobFilterType')?.addEventListener('change', (e) => {
    const sessionFilter = document.getElementById('jobSessionFilter');
    if (e.target.value === 'session') {
      sessionFilter.style.display = 'block';
    } else {
      sessionFilter.style.display = 'none';
    }
  });

  document.getElementById('applyJobFilter')?.addEventListener('click', applyCurrentJobFilter);

  document.getElementById('resetJobFilter')?.addEventListener('click', async () => {
    document.getElementById('jobFilterType').value = 'all';
    document.getElementById('jobSessionFilter').style.display = 'none';
    document.getElementById('jobStartDate').value = '';
    document.getElementById('jobEndDate').value = '';
    document.getElementById('jobLimit').value = '100';
    await fetchAllJobs({ limit: 100 });
  });

  document.getElementById('refreshJobs')?.addEventListener('click', applyCurrentJobFilter);

  document.getElementById('exportJobResults')?.addEventListener('click', () => {
    if (!currentJob || !currentJob.results) {
      alert('No results to export');
      return;
    }

    const results = currentJob.results;
    const csv = 'phone,status,reason,error\n' +
      results.map(r =>
        `${r.number || ''},${r.status || ''},"${r.reason || ''}","${r.error || ''}"`
      ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `broadcast_results_${currentJob.id.substring(0, 8)}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('jobResultsFilter')?.addEventListener('input', (e) => {
    const filter = e.target.value.trim();
    if (currentJob && currentJob.results) {
      renderJobResults(currentJob.results, filter);
    }
  });
}

/**
 * Poll job status
 */
async function pollJob(jobId, sessionId, logEl) {
  const poll = async () => {
    try {
      const res = await fetch(`/sessions/${sessionId}/broadcast/${jobId}`).then(r => r.json());
      const job = res.job;
      state.jobs[job.id] = job;
      renderJobList();

      const jobSummary = `Status: ${job.status}\nSent: ${job.totals.sent}/${job.totals.total}\nSkipped: ${job.totals.skipped}\nFailed: ${job.totals.failed}`;
      logEl.textContent = jobSummary;

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        updateDashboardStats();
        return;
      }
      setTimeout(poll, 1000);
    } catch (err) {
      logEl.textContent = `Error polling job: ${err.message}`;
    }
  };
  poll();
}
