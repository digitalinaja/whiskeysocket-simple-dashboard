// src/migrationSystem.js
// Migration runner, backup logic, force mode, and migration history
import { getDropColumnSQL } from './schemaValidation.js';

/**
 * Ensure schema_migrations table exists
 */
export async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      version VARCHAR(32) NOT NULL,
      migration_name VARCHAR(255) NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      execution_time INT DEFAULT 0,
      status ENUM('success','failed') DEFAULT 'success',
      INDEX idx_version (version),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/**
 * Record a migration event
 */
export async function recordMigration(connection, { version, migration_name, execution_time, status }) {
  await connection.query(
    `INSERT INTO schema_migrations (version, migration_name, execution_time, status) VALUES (?, ?, ?, ?)`,
    [version, migration_name, execution_time, status]
  );
}

/**
 * Backup a table before migration
 */
export async function backupTable(connection, table) {
  const backupName = `backup_${table}_${Date.now()}`;
  await connection.query(`CREATE TABLE IF NOT EXISTS \`${backupName}\` LIKE \`${table}\``);
  await connection.query(`INSERT INTO \`${backupName}\` SELECT * FROM \`${table}\``);
}

/**
 * Drop extra columns (force mode)
 */
export async function dropExtraColumns(connection, table, columns) {
  for (const col of columns) {
    const sql = getDropColumnSQL(table, col);
    await connection.query(sql);
  }
}

// More migration planning and execution logic will be added here
