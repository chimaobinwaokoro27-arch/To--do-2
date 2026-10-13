import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { nowLocalIsoString } from '../utils/dateTime.js';
import { requireAuth } from '../middleware/auth.js';
import {
  AUTH_COOKIE,
  cookieOptions,
  clearCookieOptions,
  createToken,
  toSafeUser,
} from '../config/auth.js';

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const SALT_ROUNDS = 10;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
    this.status = 401;
  }
}

function readCredentials(body) {
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const password = String(body.password || '');

  if (!email) throw new ValidationError('email is required');
  if (!EMAIL_REGEX.test(email)) throw new ValidationError('email is not a valid email address');

  if (!password) throw new ValidationError('password is required');
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  return { email, password };
}

/** Creates the signed token and puts it in the HTTP-only cookie. */
function startSession(res, user) {
  res.cookie(AUTH_COOKIE, createToken(user), cookieOptions());
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = readCredentials(req.body || {});

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      const error = new Error('An account with that email already exists');
      error.status = 409;
      throw error;
    }

    // Only the hash is stored. The plain password is never written anywhere.
    const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

    let result;
    try {
      result = await query(
        'INSERT INTO users (email, password_hash, created_at) VALUES ($1, $2, $3) RETURNING id',
        [email, passwordHash, nowLocalIsoString()]
      );
    } catch (error) {
      // Another request created the same email between the check and the insert.
      if (error?.code === '23505') {
        const conflict = new Error('An account with that email already exists');
        conflict.status = 409;
        throw conflict;
      }
      throw error;
    }

    const user = { id: result.rows[0].id, email };

    startSession(res, user);

    res.status(201).json({ user: toSafeUser(user) });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = readCredentials(req.body || {});

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0] || null;

    // The same message for "no such email" and "wrong password" so the
    // response cannot be used to find out which addresses are registered.
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new AuthError('Email or password is incorrect');
    }

    startSession(res, user);

    res.json({ user: toSafeUser(user) });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, clearCookieOptions());
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toSafeUser(req.user) });
});

export default router;