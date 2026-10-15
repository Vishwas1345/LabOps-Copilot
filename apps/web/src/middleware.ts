// A cheap gate before rendering: no session cookie means the login page.
// The real check is the API's, on every request; a stale cookie gets a 401
// there and the page redirects to login (lib/api.ts).

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!login|auth/|_next/|favicon.ico).*)'],
};
