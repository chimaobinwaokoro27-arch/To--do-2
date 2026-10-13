// ============================================================================
// One-time migration: copy the existing SQLite database into PostgreSQL
// (Supabase). Run from the server/ directory:
//
//   node scripts/copy-sqlite-to-postgres.mjs
//
// Requirements:
//   * server/.env has DATABASE_URL (your Supabase connection string).
//   * The target tables exist (run the schema first).
//   * The SQLite file still exists at server/data/todo.db (or DB_PATH).
//
// This script only ever READS the SQLite file. It never modifies or deletes
// it, and the password hashes are copied as-is (they stay valid).
// ============================================================================
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import pg from 'pg';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(currentDir, '..', 'data', 'todo.db');
const sqlitePath = process.env.DB_PATH || defaultDbPath;

const connectionString = (process.env.DATABASE_URL || '').trim();

if (!connectionString) {
  console.error('DATABASE_URL is not set. Add your Supabase connection string to server/.env first.');
  process.exit(1);
}

if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite database not found at ${sqlitePath}. Nothing to copy.`);
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

console.log(`Reading SQLite database (read-only): ${sqlitePath}`);

const userRows = sqlite.prepare('SELECT * FROM users ORDER BY id').all();
const taskRows = sqlite.prepare('SELECT * FROM tasks ORDER BY id').all();
console.log(`Found ${userRows.length} user(s) and ${taskRows.length} task(s)`);

const client = await pool.connect();

let copiedUsers = 0;
let copiedTasks = 0;

try {
  await client.query('BEGIN');

  for (const user of userRows) {
    // ON CONFLICT DO NOTHING makes the script safe to re-run: rows that are
    // already present (same id or same email) are skipped.
    const result = await client.query(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [user.id, user.email, user.passwordHash, user.createdAt]
    );
    copiedUsers += result.rowCount;
  }

  for (const task of taskRows) {
    const result = await client.query(
      `INSERT INTO tasks
        (id, title, description, deadline, reminder_minutes, reminder_at, recipient_email,
         completed, email_sent, created_at, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING`,
      [
        task.id,
        task.title,
        task.description,
        task.deadline,
        task.reminderMinutes,
        task.reminderAt,
        task.recipientEmail,
        task.completed,
        task.emailSent,
        task.createdAt,
        task.userId,
      ]
    );
    copiedTasks += result.rowCount;
  }

  // Make sure new auto-generated ids never collide with the copied ones.
  await client.query(
    "SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1), true)"
  );
  await client.query(
    "SELECT setval(pg_get_serial_sequence('tasks', 'id'), COALESCE((SELECT MAX(id) FROM tasks), 1), true)"
  );

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Copy failed, nothing was changed in PostgreSQL:', error?.message || error);
  process.exitCode = 1;
} finally {
  client.release();
  sqlite.close();
  await pool.end();
}

console.log(`Finished: ${copiedUsers} user(s) and ${copiedTasks} task(s) copied into PostgreSQL.`);
console.log('The SQLite file was not modified. Keep it as a backup.');