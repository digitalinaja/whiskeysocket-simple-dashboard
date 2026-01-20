// src/scripts/dbMigrate.js
import { initDatabase } from '../database.js';

(async () => {
  const force = process.env.FORCE_DB_MIGRATION === 'true' || process.argv.includes('--force');
  const backup = process.argv.includes('--backup');
  try {
    await initDatabase({ force, backup });
    console.log('Database migration completed.');
    process.exit(0);
  } catch (err) {
    console.error('Database migration failed:', err);
    process.exit(1);
  }
})();
