# Google sign-in — Spec

**Status:** built (#34). Off until configured; it has not yet been run against
a real Google client.

## Problem
Operators sign in with a password seeded by an administrator. They should also
be able to sign in with their Google account, without letting any Google
account in.

## Who it is for
Operators whose email the deployment has allowed. Nobody else.

## How it works
1. The sign-in page shows **Sign in with Google** when the API has Google
   configured; otherwise nothing changes.
2. Google asks the person to choose an account and consent, then sends them
   back to the app.
3. The app confirms with Google who they are. If the account's email is
   verified and on the allow-list, they are signed in exactly as with a
   password: the same server-side session, the same audit entry (marked as a
   Google sign-in).
4. The first allowed Google sign-in links to the operator whose username is
   that email, creating one (named after the email) if none exists; later
   sign-ins with the same Google account return to it, even if the email on
   the account changes.

## Rules
- Only emails listed in `GOOGLE_ALLOWED_EMAILS` may sign in. An unverified
  Google email is refused.
- An operator created through Google has no password, so password sign-in
  cannot reach it unless an administrator later seeds a password for that
  username.
- The Google client secret stays on the API and is never sent to the browser,
  logged, or returned.
- A refused attempt is audited with its reason, never with the email.
- Password sign-in keeps working unchanged.

## Turning it on
Set all four variables on the API (all or none, or it refuses to start):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and
`GOOGLE_ALLOWED_EMAILS`. The redirect is `https://<host>/auth/google/callback`
(locally `http://localhost:3000/auth/google/callback`) and must be registered
on the OAuth client exactly. On Render, set them in the service's
environment; locally, in `apps/api/.env` or the root `.env` for compose.

## Acceptance criteria
Each is proven by `apps/api/test/integration/platform/auth/google.int.test.ts`,
except the `state` check, in `apps/web/test/unit/app/auth/google/routes.test.ts`.

- [x] With Google configured, the sign-in page offers it; without, it does not.
- [x] An allowed, verified Google account signs in and gets a session.
- [x] The same Google account signs in to the same operator every time.
- [x] An email not on the allow-list is refused, and nothing is created.
- [x] An unverified email is refused.
- [x] A forged, expired, wrong-audience, wrong-issuer or replayed token is refused.
- [x] A callback whose `state` does not match the one the app issued is refused.
- [x] An operator created through Google cannot sign in with a password.
- [x] Every attempt that reaches the API's verification step, allowed or
  refused, is in the audit trail. A callback the web server refuses first (a
  cancel, a missing code, a `state` mismatch) never reaches the API and is not
  audited.
