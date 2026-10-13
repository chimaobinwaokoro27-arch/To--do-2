import 'dotenv/config';
import app from './app.js';
import { initDatabase } from './config/db.js';
import { startReminderScheduler } from './services/reminderService.js';

const PORT = Number(process.env.PORT) || 5000;

// Only start server/listener and long-running cron in non-serverless (local dev)
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION;

async function start() {
  await initDatabase();

  if (!isServerless) {
    app.listen(PORT, () => {
      console.log('API listening on http://localhost:' + PORT);
      console.log('Health check: http://localhost:' + PORT + '/api/health');
    });

    startReminderScheduler();
  }
}

start().catch((error) => {
  console.error('Failed to start the API:', error?.message || error);
  if (!isServerless) {
    process.exit(1);
  }
});

export { app };

