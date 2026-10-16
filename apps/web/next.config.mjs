// Plain JavaScript on purpose: the runtime image omits dev dependencies, so a
// next.config.ts would make `next start` try to install TypeScript at boot.

// Set here, not only at a proxy, so every host sends them: the single-container
// deploy has no Caddy in front. The same set as deploy/Caddyfile.
const securityHeaders = [
  // Never framed: a framed dashboard lets another page trick a click on Approve.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Browsers ignore this over plain http, so local development is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
