#!/usr/bin/env node

import { execSync } from 'child_process';
import { unlinkSync, existsSync, readdirSync } from 'fs';
import path from 'path';

console.log('🧹 Resetting Synapse...');

try {
  // Kill server on port 3001
  try {
    execSync('lsof -ti:3001 | xargs kill -9', { stdio: 'ignore' });
    console.log('✅ Server killed');
  } catch {
    console.log('ℹ️  No server running on port 3001');
  }

  // Remove database files
  try {
    const dataDir = 'data';
    if (existsSync(dataDir)) {
      const files = readdirSync(dataDir);
      const dbFiles = files.filter(f => f.startsWith('synapse.db'));
      for (const file of dbFiles) {
        const fullPath = path.join(dataDir, file);
        if (existsSync(fullPath)) {
          unlinkSync(fullPath);
        }
      }
    }
    console.log('✅ Database files cleared');
  } catch (e) {
    console.log('ℹ️  No database files to clear');
  }

  // Remove topic file
  if (existsSync('.synapse-topic')) {
    unlinkSync('.synapse-topic');
  }
  console.log('✅ Topic file cleared');

  // Reinitialize database
  console.log('🔧 Reinitializing database...');
  try {
    execSync('npm run db:migrate', { stdio: 'inherit' });
    console.log('✅ Database reinitialized');
  } catch (e) {
    console.error('⚠️  Database migration failed');
  }

  console.log('🚀 Synapse reset complete! Run `npm run learn` to start fresh.');

} catch (error) {
  console.error('❌ Reset failed:', error.message);
  process.exit(1);
}