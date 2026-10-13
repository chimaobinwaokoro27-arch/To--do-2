import { checkReminders } from '../server/src/services/reminderService.js';
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
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : auth;

  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await ensureDb();
    const sent = await checkReminders();
    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error('Cron job error:', err?.message || err);
    return res.status(500).json({ error: 'Cron job failed' });
  }
}
