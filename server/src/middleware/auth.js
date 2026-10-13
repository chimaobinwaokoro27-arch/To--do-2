import { AUTH_COOKIE, verifyToken, clearCookieOptions } from '../config/auth.js';

/**
 * Stops the request unless a valid JWT cookie is present.
 * On success it adds req.user = { id, email } for the routes to use.
 */
export function requireAuth(req, res, next) {
  const token = req.cookies ? req.cookies[AUTH_COOKIE] : undefined;

  if (!token) {
    return res.status(401).json({ error: 'You must be logged in' });
  }

  try {
    const payload = verifyToken(token);

    req.user = {
      id: Number(payload.sub),
      email: payload.email,
    };

    return next();
  } catch {
    // Expired or tampered token: the cookie is useless, so drop it.
    res.clearCookie(AUTH_COOKIE, clearCookieOptions());
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

export default requireAuth;
