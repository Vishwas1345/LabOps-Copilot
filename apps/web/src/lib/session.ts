// The session cookie the web app holds on its own origin (BFF, agreed D1).
// The browser never sees the API's cookie; the Next server forwards this one.

export const SESSION_COOKIE = 'labops_session';

/** Secure unless explicitly turned off for local http, like the API's flag. */
export const sessionCookieSecure = (env: string | undefined = process.env.SESSION_COOKIE_SECURE) =>
  env !== 'false';
