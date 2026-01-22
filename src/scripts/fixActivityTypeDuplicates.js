// src/scripts/fixActivityTypeDuplicates.js
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
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

(async () => {
  const pool = mysql.createPool(poolConfig);
  const connection = await pool.getConnection();
  
  try {
    console.log('Checking for duplicate activity_types...');
    
    // Check duplicates
    const [duplicates] = await connection.query(`
      SELECT session_id, name, COUNT(*) as cnt
      FROM activity_types
      GROUP BY session_id, name
      HAVING cnt > 1;
    `);
    
    if (duplicates.length > 0) {
      console.log(`Found ${duplicates.length} duplicate groups. Cleaning up...`);
      
      // Drop the unique index first if it exists
      try {
        await connection.query(`ALTER TABLE activity_types DROP INDEX unique_activity_type_per_session;`);
        console.log('Dropped existing unique index');
      } catch (e) {
        console.log('Index did not exist or could not be dropped');
      }
      
      // Delete duplicates, keep the first one
      for (const dup of duplicates) {
        const [allRows] = await connection.query(
          `SELECT id FROM activity_types WHERE session_id = ? AND name = ? ORDER BY id;`,
          [dup.session_id, dup.name]
        );
        
        if (allRows.length > 1) {
          const idsToDelete = allRows.slice(1).map(r => r.id);
          console.log(`Keeping id ${allRows[0].id}, deleting: ${idsToDelete.join(', ')}`);
          
          for (const id of idsToDelete) {
            await connection.query(`DELETE FROM activity_types WHERE id = ?;`, [id]);
          }
        }
      }
      
      console.log('Cleanup completed');
    } else {
      console.log('No duplicates found');
    }
    
    // Verify cleanup
    const [afterCheck] = await connection.query(`
      SELECT session_id, name, COUNT(*) as cnt
      FROM activity_types
      GROUP BY session_id, name
      HAVING cnt > 1;
    `);
    
    if (afterCheck.length === 0) {
      console.log('✓ All duplicates removed');
    }
    
    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await connection.end();
    process.exit(1);
  }
})();
