import 'dotenv/config';
import path from 'path';
import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH || './data/synapse.db';

// One shared connection (better-sqlite3 is synchronous)
let db;

export function getDB() {
  if (!db) {
    const resolved = path.resolve(process.cwd(), dbPath);
    db = new Database(resolved);
  }
  return db;
}
