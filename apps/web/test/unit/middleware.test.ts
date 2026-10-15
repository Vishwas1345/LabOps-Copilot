// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, middleware } from '@/middleware';

describe('middleware', () => {
  // Negative: a signed-out visitor never renders a dashboard page.
  it('redirects a request without a session to login', () => {
    const response = middleware(new NextRequest('http://localhost:3000/incidents/abc'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/login');
  });

  it('lets a request with a session through to the page', () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { cookie: 'labops_session=tok' },
    });

    expect(middleware(request).headers.get('x-middleware-next')).toBe('1');
  });

  it('never gates the login page or Next assets', () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test('/login')).toBe(false);
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
    expect(pattern.test('/incidents')).toBe(true);
  });
});
