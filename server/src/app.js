import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bodyParser from 'body-parser';
import authRoutes from './routes/authRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import { warnAboutMissingSecret } from './config/auth.js';

const app = express();

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Use body-parser directly
app.use(bodyParser.json({ limit: '10mb' }));
app.use(cookieParser());

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      const error = new Error('Origin not allowed by CORS');
      error.status = 403;
      return callback(error);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

warnAboutMissingSecret();

app.use('/api/auth', authLimiter);
app.use('/api/tasks', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'todo-reminder-api' });
});

app.get('/', (req, res) => {
  res.json({ status: 'success', message: 'API is running smoothly' });
});

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const status = error.status || 500;
  if (status >= 500) {
    console.error('Server error:', error?.message || error);
  }

  const message =
    error.type === 'entity.parse.failed'
      ? 'Request body is not valid JSON'
      : status >= 500
        ? 'Something went wrong'
        : error.message;

  res.status(status).json({ error: message });
});

export default app;
