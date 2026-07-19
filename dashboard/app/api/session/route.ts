import { NextResponse } from 'next/server';
import { createDashboardSession, DASHBOARD_SESSION_COOKIE, hasValidSecret } from '../../../lib/auth';

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const suppliedToken = form.get('token');
  const expectedToken = process.env.WARDEN_VIEW_TOKEN;

  if (!hasValidSecret(suppliedToken, expectedToken)) {
    return NextResponse.redirect(new URL('/login?error=1', request.url), 303);
  }

  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.set(DASHBOARD_SESSION_COOKIE, createDashboardSession(expectedToken!), {
    httpOnly: true,
    maxAge: 60 * 60 * 12,
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
