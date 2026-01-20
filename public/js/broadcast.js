// ============================================
// BROADCAST MESSAGING FUNCTIONALITY
// ============================================

/**
 * Initialize broadcast functionality
 */
function initBroadcast() {
  // Send message form
  document.getElementById('sendForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sessionId = document.getElementById('sendSessionSelect').value;
    if (!sessionId) {
      document.getElementById('sendResult').textContent = 'Please select a session first';
      return;
    }

    const number = document.getElementById('sendNumber').value.trim();
    const message = document.getElementById('sendMessage').value.trim();
    const log = document.getElementById('sendResult');
    log.textContent = 'Sending...';

    try {
      const res = await postJson(`/sessions/${sessionId}/send`, { number, message });
      log.textContent = `✓ Message sent successfully!\n${JSON.stringify(res, null, 2)}`;

      let totalSent = parseInt(document.getElementById('stat-messages-sent').textContent) || 0;
      document.getElementById('stat-messages-sent').textContent = totalSent + 1;
    } catch (err) {
      log.textContent = `✗ Error: ${err.message}`;
    }
  });

  // Broadcast form
  document.getElementById('broadcastForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sessionId = document.getElementById('broadcastSessionSelect').value;
    if (!sessionId) {
      document.getElementById('broadcastResult').textContent = 'Please select a session first';
      return;
    }

    let numbers = [];
    let messageTemplate = document.getElementById('broadcastMessage').value.trim();
    const delayMin = parseInt(document.getElementById('delayMin').value) || 3000;
    const delayMax = parseInt(document.getElementById('delayMax').value) || 8000;
    const cooldownAfter = parseInt(document.getElementById('cooldownAfter').value) || 30;
    const cooldownMin = parseInt(document.getElementById('cooldownMin').value) || 120000;
    const cooldownMax = parseInt(document.getElementById('cooldownMax').value) || 300000;

    const log = document.getElementById('broadcastResult');

    // Get numbers based on input method
    if (broadcastInputMethod === 'csv') {
      if (csvBroadcastData.length === 0) {
        log.textContent = '✗ Upload CSV file dulu!';
        return;
      }

      const hasPersonalization = messageTemplate.includes('{name}') && csvBroadcastData.some(d => d.name);

      if (hasPersonalization) {
        log.textContent = '⚠️ Memulai personalized broadcast...\nMohon tunggu...';

        try {
          const res = await postJson(`/sessions/${sessionId}/broadcast-personalized`, {
            csvData: csvBroadcastData,
            messageTemplate: messageTemplate,
            delayMinMs: delayMin,
            delayMaxMs: delayMax,
            cooldownAfter: cooldownAfter,
            cooldownMinMs: cooldownMin,
            cooldownMaxMs: cooldownMax,
          });
          log.textContent = `✓ Personalized broadcast job queued!\nJob ID: ${res.jobId}\nTotal: ${res.totals.total}`;
          state.currentJobId = res.jobId;
          pollJob(res.jobId, sessionId, log);
        } catch (err) {
          log.textContent = `✗ Error: ${err.message}`;
        }
        return;
      } else {
        numbers = csvBroadcastData.map(d => d.phone);
      }
    } else {
      const numbersRaw = document.getElementById('broadcastNumbers').value.trim();
      numbers = numbersRaw.split(/\r?\n/).map(n => n.trim()).filter(Boolean);
    }

    if (numbers.length === 0) {
      log.textContent = '✗ Masukkan nomor tujuan!';
      return;
    }

    log.textContent = 'Queuing broadcast job...';

    try {
      const res = await postJson(`/sessions/${sessionId}/broadcast`, {
        numbers,
        message: messageTemplate,
        delayMinMs: delayMin,
        delayMaxMs: delayMax,
        cooldownAfter,
        cooldownMinMs: cooldownMin,
        cooldownMaxMs: cooldownMax,
      });
      log.textContent = `✓ Broadcast job queued!\nJob ID: ${res.jobId}\nTotal numbers: ${res.totals.total}`;
      state.currentJobId = res.jobId;
      pollJob(res.jobId, sessionId, log);
    } catch (err) {
      log.textContent = `✗ Error: ${err.message}`;
    }
  });

  // Initialize broadcast presets
  initBroadcastPresets();
  initBroadcastCSV();
}

/**
 * Initialize broadcast preset configuration
 */
function initBroadcastPresets() {
  const broadcastPreset = document.getElementById('broadcastPreset');
  const presetDescription = document.getElementById('presetDescription');
  const delayMinInput = document.getElementById('delayMin');
  const delayMaxInput = document.getElementById('delayMax');
  const cooldownAfterInput = document.getElementById('cooldownAfter');
  const cooldownMinInput = document.getElementById('cooldownMin');
  const cooldownMaxInput = document.getElementById('cooldownMax');

  function applyPreset(preset) {
    const config = BROADCAST_PRESETS[preset];
    if (!config) return;

    delayMinInput.value = config.delayMin;
    delayMaxInput.value = config.delayMax;
    cooldownAfterInput.value = config.cooldownAfter;
    cooldownMinInput.value = config.cooldownMin;
    cooldownMaxInput.value = config.cooldownMax;
    presetDescription.textContent = config.description;

    const isCustom = preset === 'custom';
    cooldownMinInput.disabled = !isCustom;
    cooldownMaxInput.disabled = !isCustom;

    updateEstimatedTime();
  }

  function updateEstimatedTime() {
    let numbersCount = 0;

    if (broadcastInputMethod === 'csv') {
      numbersCount = csvBroadcastData.length;
    } else {
      const numbersRaw = document.getElementById('broadcastNumbers').value.trim();
      numbersCount = numbersRaw ? numbersRaw.split(/\r?\n/).filter(Boolean).length : 0;
    }

    if (numbersCount === 0) {
      document.getElementById('estimatedTime').textContent = 'Masukkan nomor untuk melihat estimasi';
      return;
    }

    const delayMin = parseInt(delayMinInput.value) || 3000;
    const delayMax = parseInt(delayMaxInput.value) || 8000;
    const cooldownAfter = parseInt(cooldownAfterInput.value) || 30;
    const cooldownMin = parseInt(cooldownMinInput.value) || 120000;
    const cooldownMax = parseInt(cooldownMaxInput.value) || 300000;

    const avgDelay = (delayMin + delayMax) / 2;
    const avgCooldown = (cooldownMin + cooldownMax) / 2;
    const cooldownCount = Math.floor(numbersCount / cooldownAfter);
    const totalDelayMs = (numbersCount * avgDelay) + (cooldownCount * avgCooldown);

    const hours = Math.floor(totalDelayMs / 3600000);
    const minutes = Math.floor((totalDelayMs % 3600000) / 60000);
    const seconds = Math.floor((totalDelayMs % 60000) / 1000);

    let timeString = '';
    if (hours > 0) timeString += `${hours} jam `;
    if (minutes > 0) timeString += `${minutes} menit `;
    if (seconds > 0 || timeString === '') timeString += `${seconds} detik`;

    document.getElementById('estimatedTime').innerHTML =
      `<strong>Estimasi waktu:</strong> ${timeString} untuk ${numbersCount} nomor`;
  }

  document.getElementById('broadcastNumbers')?.addEventListener('input', updateEstimatedTime);
  delayMinInput?.addEventListener('input', updateEstimatedTime);
  delayMaxInput?.addEventListener('input', updateEstimatedTime);
  cooldownAfterInput?.addEventListener('input', updateEstimatedTime);
  cooldownMinInput?.addEventListener('input', updateEstimatedTime);
  cooldownMaxInput?.addEventListener('input', updateEstimatedTime);

  broadcastPreset?.addEventListener('change', (e) => {
    applyPreset(e.target.value);
  });

  // Apply default preset
  applyPreset('moderate');
}

/**
 * Initialize CSV broadcast handling
 */
function initBroadcastCSV() {
  const methodManualBtn = document.getElementById('methodManual');
  const methodCsvBtn = document.getElementById('methodCsv');

  methodManualBtn?.addEventListener('click', () => {
    broadcastInputMethod = 'manual';
    document.getElementById('manualInput').style.display = 'block';
    document.getElementById('csvInput').style.display = 'none';
    methodManualBtn.style.background = 'var(--accent)';
    methodManualBtn.style.color = 'var(--bg)';
    methodCsvBtn.style.background = 'transparent';
    methodCsvBtn.style.color = 'var(--muted)';
    document.getElementById('personalizationHelper').style.display = 'none';
  });

  methodCsvBtn?.addEventListener('click', () => {
    broadcastInputMethod = 'csv';
    document.getElementById('manualInput').style.display = 'none';
    document.getElementById('csvInput').style.display = 'block';
    methodCsvBtn.style.background = 'var(--accent)';
    methodCsvBtn.style.color = 'var(--bg)';
    methodManualBtn.style.background = 'transparent';
    methodManualBtn.style.color = 'var(--muted)';
  });

  // Download template
  document.getElementById('downloadTemplate')?.addEventListener('click', () => {
    const template = 'phone;name\n6281234567890;Budi Santoso\n6289876543210;Siti Wijaya\n6285555555555;Ahmad Rahman\n\n# Notes:\n# - Kolom "phone" WAJIB (format: country code + nomor)\n# - Kolom "name" OPSIONAL (untuk personalisasi pesan)\n# - Gunakan {name} dalam pesan untuk personalisasi';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'broadcast_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Preview CSV
  document.getElementById('previewCsv')?.addEventListener('click', () => {
    if (csvBroadcastData.length === 0) {
      alert('Upload CSV file dulu!');
      return;
    }

    const previewBody = document.getElementById('previewBody');
    const previewDiv = document.getElementById('csvPreview');
    const preview = csvBroadcastData.slice(0, 10);

    previewBody.innerHTML = preview.map((row, i) => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
        <td style="padding: 8px;">${i + 1}</td>
        <td style="padding: 8px;">${row.phone}</td>
        <td style="padding: 8px;">${row.name || '-'}</td>
      </tr>
    `).join('');

    document.getElementById('previewCount').textContent = csvBroadcastData.length;
    previewDiv.style.display = 'block';

    if (csvBroadcastData.some(d => d.name)) {
      document.getElementById('personalizationHelper').style.display = 'block';
    }
  });

  // CSV file upload
  document.getElementById('csvFile')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      parseCSV(event.target.result);
    };
    reader.readAsText(file);
  });

  // Initialize manual button state
  methodManualBtn?.click();
}

/**
 * Parse CSV file
 */
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  if (lines.length < 2) {
    alert('CSV tidak valid. Minimal harus ada header + 1 data.');
    return;
  }

  const headers = lines[0].split(';').map(h => h.trim().toLowerCase());
  const phoneIndex = headers.findIndex(h => h === 'phone' || h === 'nomor' || h === 'number' || h === 'whatsapp');
  const nameIndex = headers.findIndex(h => h === 'name' || h === 'nama');

  if (phoneIndex === -1) {
    alert('CSV harus punya kolom "phone"!');
    return;
  }

  csvBroadcastData = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.trim());
    const phone = values[phoneIndex]?.replace(/\D/g, '');
    const name = nameIndex !== -1 ? values[nameIndex] : '';

    if (phone && phone.length >= 8) {
      csvBroadcastData.push({ phone, name });
    }
  }

  const validCount = csvBroadcastData.length;
  const withName = csvBroadcastData.filter(d => d.name).length;

  document.getElementById('csvStats').innerHTML =
    `✅ Valid: ${validCount} contacts | 🏷️ Dengan nama: ${withName}`;
}
