import 'dotenv/config';
import app from './app.js';
import { initDatabase } from './config/db.js';
import { pool } from './config/db.js';
import { startReminderScheduler } from './services/reminderService.js';

const PORT = Number(process.env.PORT) || 5000;

// Only start server/listener and long-running cron in non-serverless (local dev)
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION;

let server = null;
let cronJob = null;

async function start() {
  await initDatabase();

  if (!isServerless) {
    server = app.listen(PORT, () => {
      console.log('API listening on http://localhost:' + PORT);
      console.log('Health check: http://localhost:' + PORT + '/api/health');
    });

    cronJob = startReminderScheduler();
  }
}

// Graceful shutdown
async function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  
  if (cronJob) {
    cronJob.stop();
    console.log('Reminder scheduler stopped');
  }
  
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    console.log('HTTP server closed');
  }
  
  await pool.end();
  console.log('Database pool closed');
  
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  console.error('Failed to start the API:', error?.message || error);
  if (!isServerless) {
    process.exit(1);
  }
});

export { app };

