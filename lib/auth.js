import { cookies } from 'next/headers';
import { SESSION_COOKIE, signSession, verifySession, sessionCookieOptions } from './jwt.js';

export async function startSession(user) {
  cookies().set(SESSION_COOKIE, await signSession(user), sessionCookieOptions);
}

export function endSession() {
  cookies().set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
}

/** { uid, name } of the logged-in user, or null. */
export async function getSession() {
  return verifySession(cookies().get(SESSION_COOKIE)?.value);
}
