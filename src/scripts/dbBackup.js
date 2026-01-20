// src/scripts/dbBackup.js
import { getPool } from '../database.js';
import { backupTable } from '../migrationSystem.js';
import { SCHEMA_DEFINITIONS } from '../schemaDefinitions.js';

(async () => {
  try {
    const connection = await getPool().getConnection();
    for (const table of Object.keys(SCHEMA_DEFINITIONS)) {
      await backupTable(connection, table);
      console.log(`✓ Backup created for table: ${table}`);
    }
    connection.release();
    process.exit(0);
  } catch (err) {
    console.error('Database backup failed:', err);
    process.exit(1);
  }
})();
