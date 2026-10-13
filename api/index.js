import app from '../server/src/app.js';
import { initDatabase } from '../server/src/config/db.js';

let dbInit = null;
async function ensureDb() {
  if (!dbInit) {
    dbInit = initDatabase().catch((err) => {
      dbInit = null;
      throw err;
    });
  }
  return dbInit;
}

export default async function handler(req, res) {
  try {
    await ensureDb();
  } catch (err) {
    console.error('Database initialization error:', err?.message || err);
    return res.status(500).json({ error: 'Database connection failed' });
  }
  return app(req, res);
}

export const config = {
  api: {
    bodyParser: false,
  },
};
