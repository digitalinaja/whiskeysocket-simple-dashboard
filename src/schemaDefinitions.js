// src/schemaDefinitions.js
// Declarative schema definition for all tables, columns, indexes, and constraints
// Used for validation and migration

export const SCHEMA_VERSION = '1.0.0';

export const SCHEMA_DEFINITIONS = {
  contacts: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      session_id: 'VARCHAR(255) NOT NULL',
      phone: 'VARCHAR(20) NOT NULL',
      whatsapp_jid: 'VARCHAR(255) NULL',
      whatsapp_lid: 'VARCHAR(255) NULL',
      name: 'VARCHAR(255) NULL',
      profile_pic_url: 'TEXT NULL',
      push_name: 'VARCHAR(255) NULL',
      is_business: 'BOOLEAN DEFAULT FALSE',
      is_blocked: 'BOOLEAN DEFAULT FALSE',
      is_group: 'BOOLEAN DEFAULT FALSE',
      group_subject: 'VARCHAR(255) NULL',
      source: "ENUM('whatsapp','google','both') DEFAULT 'whatsapp'",
      google_contact_id: 'VARCHAR(255) NULL',
      lead_status_id: 'INT NULL',
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      updated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
      last_interaction_at: 'TIMESTAMP NULL',
    },
    indexes: [
      { name: 'idx_session_phone', columns: ['session_id', 'phone'] },
      { name: 'idx_phone', columns: ['phone'] },
      { name: 'idx_whatsapp_jid', columns: ['whatsapp_jid'] },
      { name: 'idx_whatsapp_lid', columns: ['whatsapp_lid'] },
      { name: 'idx_last_interaction', columns: ['last_interaction_at'] },
      { name: 'idx_google_contact', columns: ['google_contact_id'] },
      { name: 'idx_is_group', columns: ['is_group'] },
    ],
    // No foreign keys
  },
  messages: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      session_id: 'VARCHAR(255) NOT NULL',
      contact_id: 'INT NULL',
      message_id: 'VARCHAR(100) NOT NULL UNIQUE',
      direction: "ENUM('incoming','outgoing') NOT NULL",
      message_type: "ENUM('text','image','video','audio','document','location','contact') DEFAULT 'text'",
      content: 'TEXT NULL',
      media_url: 'TEXT NULL',
      raw_message: 'JSON NULL',
      timestamp: 'TIMESTAMP NOT NULL',
      status: "ENUM('sent','delivered','read','failed') DEFAULT 'sent'",
      is_deleted: 'BOOLEAN DEFAULT FALSE',
      is_group_message: 'BOOLEAN DEFAULT FALSE',
      group_id: 'INT NULL',
      participant_jid: 'VARCHAR(255) NULL',
      participant_name: 'VARCHAR(255) NULL',
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    },
    indexes: [
      { name: 'idx_session_contact', columns: ['session_id', 'contact_id'] },
      { name: 'idx_message_id', columns: ['message_id'] },
      { name: 'idx_timestamp', columns: ['timestamp'] },
      { name: 'idx_direction', columns: ['direction'] },
      { name: 'idx_is_group_message', columns: ['is_group_message'] },
      { name: 'idx_group_id', columns: ['group_id'] },
    ],
    foreignKeys: [
      { column: 'contact_id', refTable: 'contacts', refColumn: 'id', onDelete: 'SET NULL' },
    ],
  },
  tags: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      session_id: 'VARCHAR(255) NOT NULL',
      name: 'VARCHAR(50) NOT NULL',
      color: "VARCHAR(7) DEFAULT '#06b6d4'",
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    },
    indexes: [
      { name: 'unique_tag_per_session', columns: ['session_id', 'name'], unique: true },
      { name: 'idx_session', columns: ['session_id'] },
    ],
  },
  contact_tags: {
    columns: {
      contact_id: 'INT NOT NULL',
      tag_id: 'INT NOT NULL',
      assigned_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    },
    indexes: [
      { name: 'PRIMARY', columns: ['contact_id', 'tag_id'], unique: true },
      { name: 'idx_tag', columns: ['tag_id'] },
    ],
    foreignKeys: [
      { column: 'contact_id', refTable: 'contacts', refColumn: 'id', onDelete: 'CASCADE' },
      { column: 'tag_id', refTable: 'tags', refColumn: 'id', onDelete: 'CASCADE' },
    ],
  },
  lead_statuses: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      session_id: 'VARCHAR(255) NOT NULL',
      name: 'VARCHAR(50) NOT NULL',
      order_index: 'INT DEFAULT 0',
      color: "VARCHAR(7) DEFAULT '#94a3b8'",
      is_default: 'BOOLEAN DEFAULT FALSE',
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    },
    indexes: [
      { name: 'unique_status_per_session', columns: ['session_id', 'name'], unique: true },
      { name: 'idx_session', columns: ['session_id'] },
    ],
  },
  notes: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      contact_id: 'INT NOT NULL',
      session_id: 'VARCHAR(255) NOT NULL',
      content: 'TEXT NOT NULL',
      created_by: "VARCHAR(255) DEFAULT 'system'",
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      updated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    },
    indexes: [
      { name: 'idx_contact', columns: ['contact_id'] },
      { name: 'idx_session', columns: ['session_id'] },
      { name: 'idx_created_at', columns: ['created_at'] },
    ],
    foreignKeys: [
      { column: 'contact_id', refTable: 'contacts', refColumn: 'id', onDelete: 'CASCADE' },
    ],
  },
  google_tokens: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      session_id: 'VARCHAR(255) NOT NULL',
      access_token: 'TEXT NOT NULL',
      refresh_token: 'TEXT NOT NULL',
      token_type: "VARCHAR(50) DEFAULT 'Bearer'",
      expiry_date: 'TIMESTAMP NULL',
      scope: 'TEXT NULL',
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      updated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    },
    indexes: [
      { name: 'unique_session', columns: ['session_id'], unique: true },
      { name: 'idx_session', columns: ['session_id'] },
    ],
  },
  whatsapp_groups: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      session_id: 'VARCHAR(255) NOT NULL',
      group_id: 'VARCHAR(100) NOT NULL',
      subject: 'VARCHAR(255) NULL',
      description: 'TEXT NULL',
      profile_pic_url: 'TEXT NULL',
      owner_jid: 'VARCHAR(255) NULL',
      participant_count: 'INT DEFAULT 0',
      is_broadcast: 'BOOLEAN DEFAULT FALSE',
      category: "ENUM('business','internal','personal') DEFAULT 'business'",
      created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      updated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
      last_interaction_at: 'TIMESTAMP NULL',
    },
    indexes: [
      { name: 'unique_session_group', columns: ['session_id', 'group_id'], unique: true },
      { name: 'idx_session_group', columns: ['session_id', 'group_id'] },
      { name: 'idx_session_category', columns: ['session_id', 'category'] },
      { name: 'idx_session_id', columns: ['session_id'] },
    ],
  },
  group_participants: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      group_id: 'INT NOT NULL',
      participant_jid: 'VARCHAR(255) NOT NULL',
      participant_name: 'VARCHAR(255) NULL',
      is_admin: 'BOOLEAN DEFAULT FALSE',
      is_superadmin: 'BOOLEAN DEFAULT FALSE',
      contact_id: 'INT NULL',
      joined_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    },
    indexes: [
      { name: 'unique_participant', columns: ['group_id', 'participant_jid'], unique: true },
      { name: 'idx_group_id', columns: ['group_id'] },
      { name: 'idx_participant_jid', columns: ['participant_jid'] },
      { name: 'idx_contact_id', columns: ['contact_id'] },
    ],
    foreignKeys: [
      { column: 'group_id', refTable: 'whatsapp_groups', refColumn: 'id', onDelete: 'CASCADE' },
      { column: 'contact_id', refTable: 'contacts', refColumn: 'id', onDelete: 'SET NULL' },
    ],
  },
  schema_migrations: {
    columns: {
      id: 'INT AUTO_INCREMENT PRIMARY KEY',
      version: 'VARCHAR(32) NOT NULL',
      migration_name: 'VARCHAR(255) NOT NULL',
      executed_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
      execution_time: 'INT DEFAULT 0',
      status: "ENUM('success','failed') DEFAULT 'success'",
    },
    indexes: [
      { name: 'idx_version', columns: ['version'] },
      { name: 'idx_status', columns: ['status'] },
    ],
  },
};
