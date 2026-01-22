// scripts/seedSchoolData.js
// Seed default data for School CRM
// Run with: node scripts/seedSchoolData.js <sessionId>

import mysql from 'mysql2/promise';
import 'dotenv/config.js';

const poolConfig = {
  host: process.env.TIDB_HOST || 'gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com',
  port: process.env.TIDB_PORT || 4000,
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || 'whiskeysocket_crm',
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  }
};

/**
 * Default enrollment funnel lead statuses for school
 */
const ENROLLMENT_FUNNEL_STATUSES = [
  { name: 'Lead', color: '#22c55e', order: 1, category: 'enrollment' },
  { name: 'Qualified', color: '#3b82f6', order: 2, category: 'enrollment' },
  { name: 'Application', color: '#eab308', order: 3, category: 'enrollment' },
  { name: 'Assessment', color: '#f97316', order: 4, category: 'enrollment' },
  { name: 'Accepted', color: '#a855f7', order: 5, category: 'enrollment' },
  { name: 'Enrolled', color: '#10b981', order: 6, category: 'enrollment' },
  { name: 'Rejected', color: '#ef4444', order: 7, category: 'enrollment' },
  { name: 'Lost', color: '#6b7280', order: 8, category: 'enrollment' }
];

/**
 * Default general funnel lead statuses
 */
const GENERAL_FUNNEL_STATUSES = [
  { name: 'New', color: '#22c55e', order: 1, category: 'general' },
  { name: 'Active', color: '#3b82f6', order: 2, category: 'general' },
  { name: 'Inactive', color: '#6b7280', order: 3, category: 'general' },
  { name: 'Archived', color: '#9ca3af', order: 4, category: 'general' }
];

/**
 * Default activity types for school
 */
const SCHOOL_ACTIVITY_TYPES = [
  { name: 'Phone Call', icon: '📞', color: '#3b82f6' },
  { name: 'WhatsApp Message', icon: '💬', color: '#22c55e' },
  { name: 'Email', icon: '📧', color: '#06b6d4' },
  { name: 'School Visit', icon: '🏫', color: '#f59e0b' },
  { name: 'Meeting', icon: '👥', color: '#8b5cf6' },
  { name: 'Note', icon: '📝', color: '#6b7280' },
  { name: 'Assessment', icon: '📋', color: '#ec4899' },
  { name: 'Follow-up', icon: '🔜', color: '#14b8a6' },
  { name: 'Parent Meeting', icon: '👨‍👩‍👧', color: '#f43f5e' },
  { name: 'Document Collection', icon: '📄', color: '#84cc16' },
  { name: 'Payment Follow-up', icon: '💰', color: '#eab308' },
  { name: 'Trial Class', icon: '📚', color: '#0ea5e9' }
];

/**
 * Seed enrollment funnel statuses for a session
 */
async function seedEnrollmentFunnel(connection, sessionId) {
  console.log(`\n📊 Seeding enrollment funnel statuses for session: ${sessionId}`);

  for (const status of ENROLLMENT_FUNNEL_STATUSES) {
    try {
      await connection.query(
        `INSERT IGNORE INTO lead_statuses (session_id, name, color, order_index, category, is_default)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [sessionId, status.name, status.color, status.order, status.category]
      );
      console.log(`  ✓ Created status: ${status.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to create status ${status.name}:`, error.message);
    }
  }
}

/**
 * Seed general funnel statuses for a session
 */
async function seedGeneralFunnel(connection, sessionId) {
  console.log(`\n🎯 Seeding general funnel statuses for session: ${sessionId}`);

  for (const status of GENERAL_FUNNEL_STATUSES) {
    try {
      await connection.query(
        `INSERT IGNORE INTO lead_statuses (session_id, name, color, order_index, category, is_default)
         VALUES (?, ?, ?, ?, ?, FALSE)`,
        [sessionId, status.name, status.color, status.order, status.category]
      );
      console.log(`  ✓ Created status: ${status.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to create status ${status.name}:`, error.message);
    }
  }
}

/**
 * Seed school activity types for a session
 */
async function seedSchoolActivityTypes(connection, sessionId) {
  console.log(`\n📝 Seeding school activity types for session: ${sessionId}`);

  for (const type of SCHOOL_ACTIVITY_TYPES) {
    try {
      await connection.query(
        `INSERT IGNORE INTO activity_types (session_id, name, icon, color)
         VALUES (?, ?, ?, ?)`,
        [sessionId, type.name, type.icon, type.color]
      );
      console.log(`  ✓ Created activity type: ${type.name} ${type.icon}`);
    } catch (error) {
      console.error(`  ✗ Failed to create activity type ${type.name}:`, error.message);
    }
  }
}

/**
 * Create sample contacts for testing (optional)
 */
async function createSampleContacts(connection, sessionId) {
  console.log(`\n👥 Creating sample contacts for session: ${sessionId}`);

  const sampleContacts = [
    {
      name: 'Budi Santoso',
      phone: '6281234567801',
      contactType: 'prospect_parent',
      leadStatus: 'Lead',
      source: 'whatsapp'
    },
    {
      name: 'Siti Rahayu',
      phone: '6281234567802',
      contactType: 'student_parent',
      leadStatus: 'Enrolled',
      source: 'whatsapp'
    },
    {
      name: 'Ahmad Wijaya',
      phone: '6281234567803',
      contactType: 'prospect_parent',
      leadStatus: 'Qualified',
      source: 'google'
    },
    {
      name: 'Dewi Lestari',
      phone: '6281234567804',
      contactType: 'alumni_parent',
      leadStatus: 'Closed Won',
      source: 'whatsapp'
    },
    {
      name: 'Rudi Hartono',
      phone: '6281234567805',
      contactType: 'prospect_parent',
      leadStatus: 'Application',
      source: 'both'
    }
  ];

  // Get lead status IDs
  const [statuses] = await connection.query(
    `SELECT id, name FROM lead_statuses WHERE session_id = ?`,
    [sessionId]
  );

  const statusMap = {};
  statuses.forEach(s => {
    const key = s.name.toLowerCase().replace(/\s+/g, '_');
    statusMap[s.name] = s.id;
  });

  for (const contact of sampleContacts) {
    try {
      const statusId = statusMap[contact.leadStatus];
      if (!statusId) {
        console.log(`  ⚠ Skipping ${contact.name} - status ${contact.leadStatus} not found`);
        continue;
      }

      await connection.query(
        `INSERT IGNORE INTO contacts
         (session_id, phone, name, contact_type, source, lead_status_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [sessionId, contact.phone, contact.name, contact.contactType, contact.source, statusId]
      );
      console.log(`  ✓ Created contact: ${contact.name} (${contact.contactType})`);
    } catch (error) {
      console.error(`  ✗ Failed to create contact ${contact.name}:`, error.message);
    }
  }
}

/**
 * Create sample activities for testing (optional)
 */
async function createSampleActivities(connection, sessionId) {
  console.log(`\n📋 Creating sample activities for session: ${sessionId}`);

  // Get activity types
  const [types] = await connection.query(
    `SELECT id, name FROM activity_types WHERE session_id = ?`,
    [sessionId]
  );

  const typeMap = {};
  types.forEach(t => {
    typeMap[t.name] = t.id;
  });

  // Get contacts
  const [contacts] = await connection.query(
    `SELECT id, name FROM contacts WHERE session_id = ? LIMIT 5`,
    [sessionId]
  );

  if (contacts.length === 0) {
    console.log(`  ⚠ No contacts found, skipping sample activities`);
    return;
  }

  const sampleActivities = [
    { contactId: contacts[0]?.id, typeName: 'Phone Call', title: 'Initial inquiry call', description: 'Parent asked about admission process' },
    { contactId: contacts[1]?.id, typeName: 'School Visit', title: 'Campus tour', description: 'Family visited the school' },
    { contactId: contacts[2]?.id, typeName: 'Meeting', title: 'Meeting with principal', description: 'Discussed enrollment options' },
  ];

  for (const activity of sampleActivities) {
    if (!activity.contactId) continue;
    const typeId = typeMap[activity.typeName];
    if (!typeId) continue;

    try {
      await connection.query(
        `INSERT INTO activities
         (session_id, contact_id, activity_type_id, title, description, activity_date, created_by)
         VALUES (?, ?, ?, ?, ?, NOW(), 'system')`,
        [sessionId, activity.contactId, typeId, activity.title, activity.description]
      );
      console.log(`  ✓ Created activity: ${activity.title}`);
    } catch (error) {
      console.error(`  ✗ Failed to create activity ${activity.title}:`, error.message);
    }
  }
}

/**
 * Main function to seed all school CRM data
 */
async function seedSchoolData(sessionId) {
  const connection = await mysql.createConnection(poolConfig);

  try {
    console.log('========================================');
    console.log('🏫 School CRM Data Seeding');
    console.log('========================================');
    console.log(`Session ID: ${sessionId}`);

    await connection.query('USE ?', [poolConfig.database]);

    // Seed enrollment funnel statuses
    await seedEnrollmentFunnel(connection, sessionId);

    // Seed general funnel statuses
    await seedGeneralFunnel(connection, sessionId);

    // Seed school activity types
    await seedSchoolActivityTypes(connection, sessionId);

    // Optional: Create sample contacts and activities
    const args = process.argv.slice(2);
    const withSamples = args.includes('--with-samples') || args.includes('-s');

    if (withSamples) {
      await createSampleContacts(connection, sessionId);
      await createSampleActivities(connection, sessionId);
    }

    console.log('\n========================================');
    console.log('✅ School CRM data seeding completed!');
    console.log('========================================');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.error('Usage: node scripts/seedSchoolData.js <sessionId> [--with-samples]');
    console.error('Example: node scripts/seedSchoolData.js default --with-samples');
    process.exit(1);
  }

  seedSchoolData(sessionId);
}

export { seedSchoolData };
