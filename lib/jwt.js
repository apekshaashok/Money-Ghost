// JWT helpers that work in both the Node.js runtime and the Edge middleware.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'mg_session';
const SESSION_HOURS = 12;

function key() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set (32+ characters) in .env.local');
  return new TextEncoder().encode(secret);
}

export async function signSession(user) {
  return new SignJWT({ uid: user.user_id, name: user.full_name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { uid: payload.uid, name: payload.name };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,                 // not readable from JavaScript (XSS)
  sameSite: 'lax',                // not sent on cross-site POSTs (CSRF)
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_HOURS * 3600,
};
