#!/usr/bin/env node

/**
 * Cloud Session Sync - Testing & Management CLI
 * 
 * Usage:
 *   npm run cloud:list           - List all cloud sessions
 *   npm run cloud:sync :id       - Sync session to cloud
 *   npm run cloud:restore :id    - Restore session from cloud
 *   npm run cloud:delete :id     - Delete session from cloud
 *   npm run cloud:status :id     - Check session sync status
 */

import dotenv from 'dotenv';
import * as sessionStorage from '../src/sessionStorage.js';

dotenv.config();

const command = process.argv[2];
const sessionId = process.argv[3];

async function main() {
  try {
    switch (command) {
      case 'list':
        console.log('📋 Listing all cloud sessions...\n');
        const sessions = await sessionStorage.listSessionsFromCloud();
        
        if (sessions.length === 0) {
          console.log('No sessions found in cloud');
        } else {
          console.log(`Found ${sessions.length} session(s):\n`);
          sessions.forEach(s => {
            console.log(`  Session: ${s.session_id}`);
            console.log(`  Created:  ${s.created_at}`);
            console.log(`  Updated:  ${s.updated_at}`);
            console.log(`  Synced:   ${s.last_synced_at || 'Never'}`);
            console.log('');
          });
        }
        break;

      case 'status':
        if (!sessionId) {
          console.error('❌ Session ID required. Usage: npm run cloud:status <sessionId>');
          process.exit(1);
        }
        
        console.log(`📊 Checking status for session: ${sessionId}\n`);
        const list = await sessionStorage.listSessionsFromCloud();
        const session = list.find(s => s.session_id === sessionId);
        
        if (session) {
          console.log(`✓ Session found in cloud`);
          console.log(`  Created:  ${session.created_at}`);
          console.log(`  Updated:  ${session.updated_at}`);
          console.log(`  Synced:   ${session.last_synced_at || 'Never'}`);
        } else {
          console.log(`✗ Session not found in cloud`);
        }
        break;

      case 'delete':
        if (!sessionId) {
          console.error('❌ Session ID required. Usage: npm run cloud:delete <sessionId>');
          process.exit(1);
        }
        
        console.log(`🗑️  Deleting session: ${sessionId}`);
        await sessionStorage.deleteSessionFromCloud(sessionId);
        console.log('✓ Session deleted from cloud');
        break;

      default:
        console.log('Cloud Session Sync - CLI Tool');
        console.log('\nCommands:');
        console.log('  list                 - List all cloud sessions');
        console.log('  status <sessionId>   - Check session sync status');
        console.log('  delete <sessionId>   - Delete session from cloud');
        console.log('\nUsage:');
        console.log('  node scripts/cloudSessionCli.js list');
        console.log('  node scripts/cloudSessionCli.js status personal');
        console.log('  node scripts/cloudSessionCli.js delete business');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
