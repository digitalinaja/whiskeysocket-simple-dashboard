// src/schemaValidation.js
// Functions for schema validation, diff, and migration planning
import { SCHEMA_DEFINITIONS } from './schemaDefinitions.js';

/**
 * Get current schema info from INFORMATION_SCHEMA for all tables in SCHEMA_DEFINITIONS
 */
export async function getCurrentSchema(connection) {
  const dbName = connection.config.database;
  const tables = Object.keys(SCHEMA_DEFINITIONS);
  const schema = {};

  const [existingTables] = await connection.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=?`,
    [dbName]
  );
  const existingSet = new Set(existingTables.map((row) => row.TABLE_NAME));

  for (const table of tables) {
    if (!existingSet.has(table)) {
      schema[table] = { exists: false, columns: [], indexes: [], fks: [] };
      continue;
    }

    const [columns] = await connection.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
      [dbName, table]
    );
    const [indexes] = await connection.query(
      `SHOW INDEX FROM \`${table}\``
    );
    const [fks] = await connection.query(
      `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, kcu.CONSTRAINT_NAME, rc.UPDATE_RULE, rc.DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
       ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
       WHERE kcu.TABLE_SCHEMA=? AND kcu.TABLE_NAME=? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName, table]
    );
    schema[table] = { exists: true, columns, indexes, fks };
  }
  return schema;
}

function parseColumnDefinition(def) {
  const upper = def.toUpperCase();
  const typeMatch = def.match(/^[A-Z]+(\([^\)]+\))?/i);
  const columnType = typeMatch ? typeMatch[0].toLowerCase() : '';
  let isNullable = upper.includes('NOT NULL') ? 'NO' : 'YES';

  let columnDefault = null;
  const defaultMatch = def.match(/DEFAULT\s+([^\s]+(?:\s+CURRENT_TIMESTAMP)?)/i);
  if (defaultMatch) {
    const raw = defaultMatch[1].replace(/,$/, '');
    columnDefault = raw.replace(/^'/, '').replace(/'$/, '');
  }

  const extraParts = [];
  if (upper.includes('AUTO_INCREMENT')) extraParts.push('auto_increment');
  if (upper.includes('ON UPDATE CURRENT_TIMESTAMP')) extraParts.push('on update CURRENT_TIMESTAMP');
  const extra = extraParts.join(' ');

  if (upper.includes('PRIMARY KEY') || upper.includes('AUTO_INCREMENT')) {
    isNullable = 'NO';
  }

  return { columnType, isNullable, columnDefault, extra };
}

function normalizeColumnType(type) {
  if (!type) return '';
  let t = String(type).toLowerCase().trim();
  if (t === 'bool') return 'boolean';
  if (t === 'boolean') return 'boolean';
  if (t === 'tinyint(1)') return 'boolean';
  t = t.replace(/(int|bigint|smallint|mediumint|tinyint)\(\d+\)/g, '$1');
  t = t.replace(/\s+unsigned\b/g, '').trim();
  return t;
}

function normalizeDefault(value, columnType) {
  if (value === null || value === undefined) return null;
  const v = String(value);
  const t = normalizeColumnType(columnType);
  if (t === 'boolean') {
    const lower = v.toLowerCase();
    if (lower === 'false' || lower === '0') return '0';
    if (lower === 'true' || lower === '1') return '1';
  }
  if (v.toLowerCase() === 'current_timestamp') return 'current_timestamp';
  return v;
}

function normalizeIndexRows(indexes) {
  const map = new Map();
  for (const row of indexes) {
    const name = row.Key_name;
    if (!map.has(name)) {
      map.set(name, { name, unique: row.Non_unique === 0, columns: [] });
    }
    map.get(name).columns[row.Seq_in_index - 1] = row.Column_name;
  }
  return map;
}

function normalizeForeignKeys(fks) {
  return fks.map((fk) => ({
    column: fk.COLUMN_NAME,
    refTable: fk.REFERENCED_TABLE_NAME,
    refColumn: fk.REFERENCED_COLUMN_NAME,
    onDelete: fk.DELETE_RULE,
  }));
}

export function buildCreateTableSQL(table, definition) {
  const columns = Object.entries(definition.columns).map(
    ([name, def]) => `\`${name}\` ${def}`
  );
  const indexes = (definition.indexes || []).map((idx) => {
    if (idx.name === 'PRIMARY') {
      return `PRIMARY KEY (${idx.columns.map((c) => `\`${c}\``).join(', ')})`;
    }
    const cols = idx.columns.map((c) => `\`${c}\``).join(', ');
    if (idx.unique) {
      return `UNIQUE KEY ${idx.name} (${cols})`;
    }
    return `INDEX ${idx.name} (${cols})`;
  });
  const fks = (definition.foreignKeys || []).map((fk, i) => {
    const name = fk.name || `fk_${table}_${fk.column}_${i}`;
    return `CONSTRAINT ${name} FOREIGN KEY (\`${fk.column}\`) REFERENCES \`${fk.refTable}\`(\`${fk.refColumn}\`) ON DELETE ${fk.onDelete}`;
  });

  const all = [...columns, ...indexes, ...fks];
  return `CREATE TABLE IF NOT EXISTS \`${table}\` (\n  ${all.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

/**
 * Compare current schema with expected schema, return diff object
 */
export function compareSchemas(current, expected) {
  const diff = {
    missingTables: [],
    missingColumns: {},
    changedColumns: {},
    extraColumns: {},
    missingIndexes: {},
    missingForeignKeys: {},
    tablesToBackup: {},
  };

  for (const [table, def] of Object.entries(expected)) {
    const currentTable = current[table];
    if (!currentTable || !currentTable.exists) {
      diff.missingTables.push(table);
      diff.tablesToBackup[table] = false;
      continue;
    }

    const currentCols = new Map(currentTable.columns.map((c) => [c.COLUMN_NAME, c]));
    const expectedCols = def.columns;

    for (const [colName, colDef] of Object.entries(expectedCols)) {
      if (!currentCols.has(colName)) {
        diff.missingColumns[table] = diff.missingColumns[table] || [];
        diff.missingColumns[table].push({ column: colName, definition: colDef });
        diff.tablesToBackup[table] = true;
        continue;
      }

      const cur = currentCols.get(colName);
      const parsed = parseColumnDefinition(colDef);
      const currentType = normalizeColumnType(cur.COLUMN_TYPE || '');
      const expectedType = normalizeColumnType(parsed.columnType);
      const currentNullable = cur.IS_NULLABLE;
      const currentDefault = normalizeDefault(cur.COLUMN_DEFAULT, cur.COLUMN_TYPE);
      const currentExtra = (cur.EXTRA || '').toLowerCase();

      const expectedDefault = normalizeDefault(parsed.columnDefault, parsed.columnType);

      if (
        currentType !== expectedType ||
        currentNullable !== parsed.isNullable ||
        currentDefault !== expectedDefault ||
        (parsed.extra && !currentExtra.includes(parsed.extra.toLowerCase()))
      ) {
        diff.changedColumns[table] = diff.changedColumns[table] || [];
        diff.changedColumns[table].push({
          column: colName,
          expected: colDef,
          current: {
            type: currentType,
            nullable: currentNullable,
            default: currentDefault,
            extra: currentExtra,
          },
        });
        diff.tablesToBackup[table] = true;
      }
    }

    // Extra columns
    for (const colName of currentCols.keys()) {
      if (!expectedCols[colName]) {
        diff.extraColumns[table] = diff.extraColumns[table] || [];
        diff.extraColumns[table].push(colName);
        diff.tablesToBackup[table] = true;
      }
    }

    // Indexes
    const currentIndexMap = normalizeIndexRows(currentTable.indexes);
    for (const idx of def.indexes || []) {
      const currentIdx = currentIndexMap.get(idx.name);
      if (!currentIdx) {
        diff.missingIndexes[table] = diff.missingIndexes[table] || [];
        diff.missingIndexes[table].push({ ...idx, replace: false });
        diff.tablesToBackup[table] = true;
        continue;
      }
      const sameCols = (idx.columns || []).join(',') === (currentIdx.columns || []).join(',');
      const sameUnique = Boolean(idx.unique) === Boolean(currentIdx.unique);
      if (!sameCols || !sameUnique) {
        diff.missingIndexes[table] = diff.missingIndexes[table] || [];
        diff.missingIndexes[table].push({ ...idx, replace: true });
        diff.tablesToBackup[table] = true;
      }
    }

    // Foreign keys
    const currentFks = normalizeForeignKeys(currentTable.fks);
    for (const fk of def.foreignKeys || []) {
      const exists = currentFks.some(
        (c) =>
          c.column === fk.column &&
          c.refTable === fk.refTable &&
          c.refColumn === fk.refColumn &&
          String(c.onDelete).toUpperCase() === String(fk.onDelete).toUpperCase()
      );
      if (!exists) {
        diff.missingForeignKeys[table] = diff.missingForeignKeys[table] || [];
        diff.missingForeignKeys[table].push(fk);
        diff.tablesToBackup[table] = true;
      }
    }
  }

  // Clean empty sections
  for (const key of ['missingColumns', 'changedColumns', 'extraColumns', 'missingIndexes', 'missingForeignKeys']) {
    if (Object.keys(diff[key]).length === 0) delete diff[key];
  }
  if (diff.missingTables.length === 0) delete diff.missingTables;
  if (Object.keys(diff.tablesToBackup).length === 0) delete diff.tablesToBackup;

  return diff;
}

/**
 * Generate SQL for backup of a table
 */
export function getBackupTableSQL(table) {
  return `CREATE TABLE IF NOT EXISTS backup_${table}_${Date.now()} AS SELECT * FROM \`${table}\``;
}

/**
 * Generate SQL for dropping extra columns (force mode)
 */
export function getDropColumnSQL(table, column) {
  return `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``;
}

// More functions for migration planning and execution will be added here
