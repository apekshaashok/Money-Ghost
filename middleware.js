// Runs before every page: visitors who are not logged in go to /login.
// (API routes do their own checks in lib/api.js.)
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/jwt.js';

export async function middleware(req) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;
  const authPage = pathname === '/login' || pathname === '/register';

  if (!session && !authPage) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (session && (authPage || pathname === '/')) return NextResponse.redirect(new URL('/dashboard', req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next|favicon.ico|.*\\..*).*)'] };
