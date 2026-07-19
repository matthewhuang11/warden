import { NextResponse } from 'next/server';
import { DASHBOARD_SESSION_COOKIE } from '../../../../lib/auth';

export function POST(request: Request): Response {
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.set(DASHBOARD_SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
