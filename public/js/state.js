// ============================================
// STATE MANAGEMENT
// ============================================

// Global state object
const state = {
  sessions: {},
  qrMap: {},
  activeSession: null,
  jobs: {},
  currentJobId: null,
  currentView: 'dashboard'
};

// Chat state
const chatState = {
  currentSession: null,
  currentContact: null,
  contacts: {},
  messages: {}
};

// CRM state
const crmState = {
  currentSession: null,
  tags: {},
  leadStatuses: {},
  filters: {
    search: '',
    statusId: '',
    tagIds: []
  },
  pagination: {
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  }
};

// Broadcast presets configuration
const BROADCAST_PRESETS = {
  moderate: {
    delayMin: 3000,
    delayMax: 8000,
    cooldownAfter: 30,
    cooldownMin: 120000,
    cooldownMax: 300000,
    description: 'Simulasi behavior manusia natural. Speed: 3-8 detik/pesan. Cooldown setiap 30 pesan (2-5 menit). Risiko: Medium. Cocok untuk broadcast 50-200 nomor.'
  },
  conservative: {
    delayMin: 5000,
    delayMax: 15000,
    cooldownAfter: 20,
    cooldownMin: 180000,
    cooldownMax: 600000,
    description: 'Konfigurasi aman untuk broadcast besar. Speed: 5-15 detik/pesan. Cooldown setiap 20 pesan (3-10 menit). Risiko: Low. Cocok untuk broadcast 200-1000 nomor.'
  },
  'very-conservative': {
    delayMin: 10000,
    delayMax: 30000,
    cooldownAfter: 15,
    cooldownMin: 300000,
    cooldownMax: 900000,
    description: 'Sangat konservatif untuk nomor berharga. Speed: 10-30 detik/pesan. Cooldown setiap 15 pesan (5-15 menit). Risiko: Very Low. Cocok untuk >1000 nomor atau nomor business penting.'
  },
  custom: {
    delayMin: 3000,
    delayMax: 8000,
    cooldownAfter: 30,
    cooldownMin: 120000,
    cooldownMax: 300000,
    description: 'Konfigurasi manual sesuai kebutuhan. Bebas mengatur semua parameter. Pastikan understand risiko sebelum mengubah.'
  }
};

// CSV broadcast data
let csvBroadcastData = [];
let broadcastInputMethod = 'manual';

// Current job data for detail view
let currentJob = null;
