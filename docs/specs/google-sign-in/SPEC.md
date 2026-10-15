# Google sign-in — Spec

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
4. The first allowed Google sign-in creates the operator (named after the
   email); later sign-ins with the same Google account return to it, even if
   the email on the account changes.

## Rules
- Only emails listed in `GOOGLE_ALLOWED_EMAILS` may sign in. An unverified
  Google email is refused.
- An operator created through Google has no password, so password sign-in
  can never reach it.
- The Google client secret stays on the API and is never sent to the browser,
  logged, or returned.
- A refused attempt is audited with its reason, never with the email.
- Password sign-in keeps working unchanged.

## Acceptance criteria
- [ ] With Google configured, the sign-in page offers it; without, it does not.
- [ ] An allowed, verified Google account signs in and gets a session.
- [ ] The same Google account signs in to the same operator every time.
- [ ] An email not on the allow-list is refused, and nothing is created.
- [ ] An unverified email is refused.
- [ ] A forged, expired, wrong-audience, wrong-issuer or replayed token is refused.
- [ ] A callback whose `state` does not match the one the app issued is refused.
- [ ] An operator created through Google cannot sign in with a password.
- [ ] Every attempt, allowed or refused, is in the audit trail.
