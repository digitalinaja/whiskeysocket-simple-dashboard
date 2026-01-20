import mysql from 'mysql2/promise';
import 'dotenv/config.js';
import { SCHEMA_DEFINITIONS, SCHEMA_VERSION } from './schemaDefinitions.js';
import { getCurrentSchema, compareSchemas, buildCreateTableSQL } from './schemaValidation.js';
import { ensureMigrationsTable, recordMigration, backupTable, dropExtraColumns } from './migrationSystem.js';

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
 * Initialize database schema with validation and migrations
 */
async function initDatabase({ force = false, backup = false } = {}) {
  const connection = await getPool().getConnection();
  try {
    console.log('Validating and migrating database schema...');
    await ensureMigrationsTable(connection);
    const startTime = Date.now();
    const currentSchema = await getCurrentSchema(connection);
    const diff = compareSchemas(currentSchema, SCHEMA_DEFINITIONS);

    const hasChanges = Object.keys(diff).length > 0;
    if (!hasChanges) {
      await recordMigration(connection, {
        version: SCHEMA_VERSION,
        migration_name: 'auto-init-noop',
        execution_time: Date.now() - startTime,
        status: 'success',
      });
      console.log('✓ Database schema is up to date.');
      return;
    }

    if (diff.missingTables) {
      for (const table of diff.missingTables) {
        const sql = buildCreateTableSQL(table, SCHEMA_DEFINITIONS[table]);
        await connection.query(sql);
        console.log(`✓ Created missing table: ${table}`);
      }
    }

    if (backup && diff.tablesToBackup) {
      for (const [table, shouldBackup] of Object.entries(diff.tablesToBackup)) {
        if (shouldBackup) {
          await backupTable(connection, table);
          console.log(`✓ Backup created for table: ${table}`);
        }
      }
    }

    if (diff.missingColumns) {
      for (const [table, columns] of Object.entries(diff.missingColumns)) {
        for (const col of columns) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col.column}\` ${col.definition}`);
          console.log(`✓ Added column ${col.column} to ${table}`);
        }
      }
    }

    if (diff.changedColumns) {
      for (const [table, columns] of Object.entries(diff.changedColumns)) {
        for (const col of columns) {
          const safeDef = col.expected
            .replace(/\bPRIMARY KEY\b/gi, '')
            .replace(/\bUNIQUE\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          await connection.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${col.column}\` ${safeDef}`);
          console.log(`✓ Modified column ${col.column} in ${table}`);
        }
      }
    }

    if (force && diff.extraColumns) {
      for (const [table, columns] of Object.entries(diff.extraColumns)) {
        await dropExtraColumns(connection, table, columns);
        console.log(`✓ Dropped extra columns in ${table}: ${columns.join(', ')}`);
      }
    }

    if (diff.missingIndexes) {
      for (const [table, indexes] of Object.entries(diff.missingIndexes)) {
        for (const idx of indexes) {
          const cols = idx.columns.map((c) => `\`${c}\``).join(', ');
          if (idx.replace) {
            if (idx.name === 'PRIMARY') {
              await connection.query(`ALTER TABLE \`${table}\` DROP PRIMARY KEY`);
            } else {
              await connection.query(`ALTER TABLE \`${table}\` DROP INDEX ${idx.name}`);
            }
          }
          if (idx.name === 'PRIMARY') {
            await connection.query(`ALTER TABLE \`${table}\` ADD PRIMARY KEY (${cols})`);
          } else if (idx.unique) {
            await connection.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX ${idx.name} (${cols})`);
          } else {
            await connection.query(`ALTER TABLE \`${table}\` ADD INDEX ${idx.name} (${cols})`);
          }
          console.log(`✓ Added index ${idx.name} on ${table}`);
        }
      }
    }

    if (diff.missingForeignKeys) {
      for (const [table, fks] of Object.entries(diff.missingForeignKeys)) {
        for (const fk of fks) {
          const name = fk.name || `fk_${table}_${fk.column}`;
          const [rows] = await connection.query(
            `SELECT COUNT(*) AS cnt
             FROM \`${table}\` t
             LEFT JOIN \`${fk.refTable}\` r ON t.\`${fk.column}\` = r.\`${fk.refColumn}\`
             WHERE t.\`${fk.column}\` IS NOT NULL AND r.\`${fk.refColumn}\` IS NULL`
          );
          const count = Number(rows?.[0]?.cnt || 0);
          if (count > 0) {
            console.warn(`⚠ Skipping FK ${name} on ${table}: ${count} orphan rows detected. Clean data and rerun.`);
            continue;
          }
          await connection.query(
            `ALTER TABLE \`${table}\` ADD CONSTRAINT ${name} FOREIGN KEY (\`${fk.column}\`) REFERENCES \`${fk.refTable}\`(\`${fk.refColumn}\`) ON DELETE ${fk.onDelete}`
          );
          console.log(`✓ Added foreign key ${name} on ${table}`);
        }
      }
    }

    await recordMigration(connection, {
      version: SCHEMA_VERSION,
      migration_name: 'auto-init',
      execution_time: Date.now() - startTime,
      status: 'success',
    });
    console.log('Database schema validation and migration completed!');
  } catch (error) {
    await recordMigration(connection, {
      version: SCHEMA_VERSION,
      migration_name: 'auto-init',
      execution_time: 0,
      status: 'failed',
    });
    console.error('Error during schema validation/migration:', error);
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
