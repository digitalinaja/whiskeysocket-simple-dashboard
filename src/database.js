import mysql from 'mysql2/promise';
import 'dotenv/config.js';

// Connection pool configuration for TiDB Cloud
const poolConfig = {
  host: process.env.TIDB_HOST || 'gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com',
  port: process.env.TIDB_PORT || 4000,
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || 'whiskeysocket_crm',
  ssl: {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

let pool = null;

/**
 * Get or create MySQL connection pool
 */
function getPool() {
  if (!pool) {
    pool = mysql.createPool(poolConfig);
    console.log('MySQL connection pool created');
  }
  return pool;
}

/**
 * Initialize database tables
 */
async function initDatabase() {
  const connection = await getPool().getConnection();

  try {
    console.log('Initializing database tables...');

    // Create contacts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        whatsapp_jid VARCHAR(255) NULL,
        whatsapp_lid VARCHAR(255) NULL,
        name VARCHAR(255),
        profile_pic_url TEXT,
        push_name VARCHAR(255),
        is_business BOOLEAN DEFAULT FALSE,
        is_blocked BOOLEAN DEFAULT FALSE,
        is_group BOOLEAN DEFAULT FALSE,
        group_subject VARCHAR(255),
        source ENUM('whatsapp', 'google', 'both') DEFAULT 'whatsapp',
        google_contact_id VARCHAR(255) NULL,
        lead_status_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_interaction_at TIMESTAMP NULL,
        INDEX idx_session_phone (session_id, phone),
        INDEX idx_phone (phone),
        INDEX idx_whatsapp_jid (whatsapp_jid),
        INDEX idx_whatsapp_lid (whatsapp_lid),
        INDEX idx_last_interaction (last_interaction_at),
        INDEX idx_google_contact (google_contact_id),
        INDEX idx_is_group (is_group)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ contacts table created/verified');

    // Add is_group and group_subject columns if they don't exist
    try {
      await connection.query(`ALTER TABLE contacts ADD COLUMN is_group BOOLEAN DEFAULT FALSE AFTER is_blocked`);
      console.log('✓ Added is_group column to contacts table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: is_group column check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE contacts ADD COLUMN group_subject VARCHAR(255) NULL AFTER is_group`);
      console.log('✓ Added group_subject column to contacts table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: group_subject column check:', err.message);
      }
    }

    // Add whatsapp_jid and whatsapp_lid columns if they don't exist
    try {
      await connection.query(`ALTER TABLE contacts ADD COLUMN whatsapp_jid VARCHAR(255) NULL AFTER phone`);
      console.log('✓ Added whatsapp_jid column to contacts table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: whatsapp_jid column check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE contacts ADD COLUMN whatsapp_lid VARCHAR(255) NULL AFTER whatsapp_jid`);
      console.log('✓ Added whatsapp_lid column to contacts table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: whatsapp_lid column check:', err.message);
      }
    }

    // Add indexes for whatsapp_jid and whatsapp_lid if they don't exist
    try {
      await connection.query(`ALTER TABLE contacts ADD INDEX idx_whatsapp_jid (whatsapp_jid)`);
      console.log('✓ Added idx_whatsapp_jid index to contacts table');
    } catch (err) {
      if (!err.message.includes('Duplicate key name')) {
        console.log('Note: idx_whatsapp_jid index check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE contacts ADD INDEX idx_whatsapp_lid (whatsapp_lid)`);
      console.log('✓ Added idx_whatsapp_lid index to contacts table');
    } catch (err) {
      if (!err.message.includes('Duplicate key name')) {
        console.log('Note: idx_whatsapp_lid index check:', err.message);
      }
    }

    // Create messages table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        contact_id INT NULL,
        message_id VARCHAR(100) NOT NULL UNIQUE,
        direction ENUM('incoming', 'outgoing') NOT NULL,
        message_type ENUM('text', 'image', 'video', 'audio', 'document', 'location', 'contact') DEFAULT 'text',
        content TEXT,
        media_url TEXT,
        raw_message JSON,
        timestamp TIMESTAMP NOT NULL,
        status ENUM('sent', 'delivered', 'read', 'failed') DEFAULT 'sent',
        is_deleted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        INDEX idx_session_contact (session_id, contact_id),
        INDEX idx_message_id (message_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_direction (direction)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Add raw_message column if it doesn't exist (for existing databases)
    try {
      await connection.query(`
        ALTER TABLE messages ADD COLUMN raw_message JSON AFTER media_url
      `);
      console.log('✓ Added raw_message column to messages table');
    } catch (err) {
      // Column might already exist, ignore error
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: raw_message column check:', err.message);
      }
    }

    console.log('✓ messages table created/verified');

    // Create tags table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        name VARCHAR(50) NOT NULL,
        color VARCHAR(7) DEFAULT '#06b6d4',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_tag_per_session (session_id, name),
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ tags table created/verified');

    // Create contact_tags junction table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS contact_tags (
        contact_id INT NOT NULL,
        tag_id INT NOT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (contact_id, tag_id),
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        INDEX idx_tag (tag_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ contact_tags table created/verified');

    // Create lead_statuses table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS lead_statuses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        name VARCHAR(50) NOT NULL,
        order_index INT DEFAULT 0,
        color VARCHAR(7) DEFAULT '#94a3b8',
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_status_per_session (session_id, name),
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ lead_statuses table created/verified');

    // Create notes table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contact_id INT NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_by VARCHAR(255) DEFAULT 'system',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        INDEX idx_contact (contact_id),
        INDEX idx_session (session_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ notes table created/verified');

    // Create google_tokens table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS google_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        token_type VARCHAR(50) DEFAULT 'Bearer',
        expiry_date TIMESTAMP NULL,
        scope TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_session (session_id),
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ google_tokens table created/verified');

    // Create whatsapp_groups table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        group_id VARCHAR(100) NOT NULL,
        subject VARCHAR(255),
        description TEXT,
        profile_pic_url TEXT,
        owner_jid VARCHAR(255),
        participant_count INT DEFAULT 0,
        is_broadcast BOOLEAN DEFAULT FALSE,
        category ENUM('business', 'internal', 'personal') DEFAULT 'business',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_interaction_at TIMESTAMP NULL,
        UNIQUE KEY unique_session_group (session_id, group_id),
        INDEX idx_session_group (session_id, group_id),
        INDEX idx_session_category (session_id, category),
        INDEX idx_session_id (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ whatsapp_groups table created/verified');

    // Create group_participants table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        participant_jid VARCHAR(255) NOT NULL,
        participant_name VARCHAR(255),
        is_admin BOOLEAN DEFAULT FALSE,
        is_superadmin BOOLEAN DEFAULT FALSE,
        contact_id INT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
        INDEX idx_group_id (group_id),
        INDEX idx_participant_jid (participant_jid),
        INDEX idx_contact_id (contact_id),
        UNIQUE KEY unique_participant (group_id, participant_jid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✓ group_participants table created/verified');

    // Add contact_id column to group_participants if it doesn't exist
    try {
      await connection.query(`ALTER TABLE group_participants ADD COLUMN contact_id INT NULL AFTER is_superadmin`);
      console.log('✓ Added contact_id column to group_participants table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: contact_id column check:', err.message);
      }
    }

    // Add foreign key constraint for contact_id if it doesn't exist
    try {
      await connection.query(`
        ALTER TABLE group_participants
        ADD CONSTRAINT fk_group_participants_contact_id
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      `);
      console.log('✓ Added foreign key constraint for contact_id');
    } catch (err) {
      // May fail if constraint doesn't exist or already updated
      if (!err.message.includes('Foreign key constraint')) {
        console.log('Note: contact_id foreign key check:', err.message);
      }
    }

    // Add index for contact_id if it doesn't exist
    try {
      await connection.query(`ALTER TABLE group_participants ADD INDEX idx_contact_id (contact_id)`);
      console.log('✓ Added idx_contact_id index to group_participants table');
    } catch (err) {
      if (!err.message.includes('Duplicate key name')) {
        console.log('Note: idx_contact_id index check:', err.message);
      }
    }

    // Add group message columns to messages table if they don't exist
    try {
      await connection.query(`ALTER TABLE messages ADD COLUMN is_group_message BOOLEAN DEFAULT FALSE AFTER is_deleted`);
      console.log('✓ Added is_group_message column to messages table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: is_group_message column check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE messages ADD COLUMN group_id INT NULL AFTER is_group_message`);
      console.log('✓ Added group_id column to messages table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: group_id column check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE messages ADD COLUMN participant_jid VARCHAR(255) NULL AFTER group_id`);
      console.log('✓ Added participant_jid column to messages table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: participant_jid column check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE messages ADD COLUMN participant_name VARCHAR(255) NULL AFTER participant_jid`);
      console.log('✓ Added participant_name column to messages table');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: participant_name column check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE messages ADD INDEX idx_is_group_message (is_group_message)`);
      console.log('✓ Added idx_is_group_message index to messages table');
    } catch (err) {
      // Ignore if index already exists
      if (!err.message.includes('Duplicate key name')) {
        console.log('Note: idx_is_group_message index check:', err.message);
      }
    }

    try {
      await connection.query(`ALTER TABLE messages ADD INDEX idx_group_id (group_id)`);
      console.log('✓ Added idx_group_id index to messages table');
    } catch (err) {
      // Ignore if index already exists
      if (!err.message.includes('Duplicate key name')) {
        console.log('Note: idx_group_id index check:', err.message);
      }
    }

    // Modify contact_id to allow NULL for group messages
    try {
      await connection.query(`ALTER TABLE messages MODIFY COLUMN contact_id INT NULL`);
      console.log('✓ Modified contact_id to allow NULL');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.log('Note: contact_id NULL check:', err.message);
      }
    }

    // Update foreign key constraint to ON DELETE SET NULL
    try {
      await connection.query(`
        ALTER TABLE messages
        DROP FOREIGN KEY fk_1
      `);
      await connection.query(`
        ALTER TABLE messages
        ADD CONSTRAINT fk_messages_contact_id
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
      `);
      console.log('✓ Updated foreign key constraint to ON DELETE SET NULL');
    } catch (err) {
      // May fail if constraint doesn't exist or already updated
      console.log('Note: Foreign key constraint check:', err.message);
    }

    console.log('Database initialization completed successfully!');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Test database connection
 */
async function testConnection() {
  try {
    const connection = await getPool().getConnection();
    await connection.ping();
    console.log('✓ Database connection successful');
    connection.release();
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    throw error;
  }
}

/**
 * Create default lead statuses for a session
 */
async function createDefaultLeadStatuses(sessionId) {
  const connection = await getPool().getConnection();

  try {
    const defaultStatuses = [
      { name: 'New Lead', color: '#22c55e', order: 1 },
      { name: 'Contacted', color: '#06b6d4', order: 2 },
      { name: 'Qualified', color: '#3b82f6', order: 3 },
      { name: 'Proposal Sent', color: '#f59e0b', order: 4 },
      { name: 'Closed Won', color: '#10b981', order: 5 },
      { name: 'Closed Lost', color: '#ef4444', order: 6 }
    ];

    for (const status of defaultStatuses) {
      await connection.query(
        `INSERT IGNORE INTO lead_statuses (session_id, name, color, order_index, is_default)
         VALUES (?, ?, ?, ?, TRUE)`,
        [sessionId, status.name, status.color, status.order]
      );
    }

    console.log(`✓ Default lead statuses created for session: ${sessionId}`);
  } catch (error) {
    console.error('Error creating default lead statuses:', error);
    throw error;
  } finally {
    connection.release();
  }
}

export {
  getPool,
  initDatabase,
  testConnection,
  createDefaultLeadStatuses
};
