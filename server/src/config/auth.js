import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const AUTH_COOKIE = 'todo_token';
const TOKEN_LIFETIME = '7d';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isProduction = process.env.NODE_ENV === 'production';

// The frontend and API are often on different domains in production (for
// example a Vercel frontend and a Render API). Browsers only send the login
// cookie on those cross-site requests when it is SameSite=None; Secure, so
// that is the production default. Set COOKIE_SAMESITE=lax when the frontend
// and the API share one domain.
const SAME_SITE =
  (process.env.COOKIE_SAMESITE || '').trim().toLowerCase() || (isProduction ? 'none' : 'lax');

// The secret must never be written in the code. If JWT_SECRET is missing we
// make up a random one for this run only, so nobody can log in with a guessed
// token. People just have to log in again after a restart.
const secretFromEnv = (process.env.JWT_SECRET || '').trim();
const usingTemporarySecret = secretFromEnv.length === 0;

const JWT_SECRET = usingTemporarySecret ? crypto.randomBytes(32).toString('hex') : secretFromEnv;

export function warnAboutMissingSecret() {
  if (!usingTemporarySecret) return;
  console.warn(
    'JWT_SECRET is not set in .env, so a random secret was generated for this run. ' +
      'Add JWT_SECRET to .env so logins survive a restart.'
  );
}

/** Packs the user id and email into a signed token. */
export function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_LIFETIME });
}

/** Throws when the token is missing, expired or was changed by someone. */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * httpOnly keeps the token out of reach of page scripts, so JavaScript cannot
 * read or steal it. secure is only switched on in production because
 * http://localhost has no HTTPS.
 */
export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: SAME_SITE,
    // SameSite=None cookies are only accepted over HTTPS, so secure is forced
    // on whenever that is the setting.
    secure: isProduction || SAME_SITE === 'none',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

/** The same cookie attributes without maxAge, for clearing the cookie. */
export function clearCookieOptions() {
  const { maxAge, ...rest } = cookieOptions();
  return rest;
}

/** The only user fields that are ever sent to the browser. */
export function toSafeUser(user) {
  return { id: user.id, email: user.email };
}
