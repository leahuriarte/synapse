import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || './data/synapse.db';
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

// ensure data directory exists
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const db = new Database(DB_PATH);
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

db.exec('BEGIN;');
try {
  db.exec(schema);
  db.exec('COMMIT;');
  console.log(`[migrate] Database ready at ${DB_PATH}`);
} catch (e) {
  db.exec('ROLLBACK;');
  console.error('[migrate] Failed:', e.message);
  process.exit(1);
} finally {
  db.close();
}
