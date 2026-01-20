// src/scripts/dbValidate.js
import { getPool, testConnection } from '../database.js';
import { getCurrentSchema, compareSchemas } from '../schemaValidation.js';
import { SCHEMA_DEFINITIONS } from '../schemaDefinitions.js';

(async () => {
  try {
    const connection = await getPool().getConnection();
    await testConnection();
    const currentSchema = await getCurrentSchema(connection);
    const diff = compareSchemas(currentSchema, SCHEMA_DEFINITIONS);
    if (Object.keys(diff).length === 0) {
      console.log('✓ Database schema is up to date.');
    } else {
      console.log('Schema diff summary:', {
        missingTables: diff.missingTables || [],
        changedColumns: diff.changedColumns ? Object.fromEntries(Object.entries(diff.changedColumns).map(([t, cols]) => [t, cols.length])) : {},
        missingColumns: diff.missingColumns ? Object.fromEntries(Object.entries(diff.missingColumns).map(([t, cols]) => [t, cols.length])) : {},
        extraColumns: diff.extraColumns ? Object.fromEntries(Object.entries(diff.extraColumns).map(([t, cols]) => [t, cols.length])) : {},
        missingIndexes: diff.missingIndexes ? Object.fromEntries(Object.entries(diff.missingIndexes).map(([t, cols]) => [t, cols.length])) : {},
        missingForeignKeys: diff.missingForeignKeys ? Object.fromEntries(Object.entries(diff.missingForeignKeys).map(([t, cols]) => [t, cols.length])) : {},
      });

      if (diff.changedColumns) {
        console.log('Changed columns detail:');
        for (const [table, cols] of Object.entries(diff.changedColumns)) {
          for (const col of cols) {
            console.log(`- ${table}.${col.column}: expected "${col.expected}" vs current type=${col.current.type} nullable=${col.current.nullable} default=${col.current.default} extra=${col.current.extra}`);
          }
        }
      }

      if (diff.missingForeignKeys) {
        console.log('Missing foreign keys detail:');
        for (const [table, fks] of Object.entries(diff.missingForeignKeys)) {
          for (const fk of fks) {
            console.log(`- ${table}.${fk.column} -> ${fk.refTable}.${fk.refColumn} ON DELETE ${fk.onDelete}`);
          }
        }
      }
    }
    connection.release();
    process.exit(0);
  } catch (err) {
    console.error('Schema validation failed:', err);
    process.exit(1);
  }
})();
