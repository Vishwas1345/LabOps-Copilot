# Google sign-in — Plan

**Status:** built (#34).

OpenID Connect authorization code flow with PKCE, behind the web BFF. The web
holds the flow's state; the API alone talks to Google with the client secret,
verifies the ID token and creates the session.

## Flow
1. `GET web /auth/google/start`: generates `state`, a PKCE verifier and a
   `nonce`, keeps them in a short-lived httpOnly cookie (10 min, path
   `/auth/google`), asks the API for Google's authorization URL, redirects.
2. `GET web /auth/google/callback?code&state`: checks `state` against the
   cookie, clears it, posts `{ code, codeVerifier, nonce }` to the API.
3. `POST api /api/auth/google` (public, rate limited at 5 a minute like
   password sign-in, and like it shared by all callers, since every call comes
   from the web server):
   exchanges the code at Google's token endpoint, verifies the ID token with
   `jose` against Google's published keys (issuer, audience, expiry, signature),
   then checks `nonce`, `email_verified` and the allow-list. Finds the
   operator by `OperatorIdentity(provider, subject)`; on the first allowed
   sign-in, links the operator whose username is that email, or creates one;
   creates the session; writes `auth.login`.
4. The web copies the session cookie, as password sign-in does.

## Changes
- **Migration:** `Operator.passwordHash` nullable; new `OperatorIdentity`
  (`provider`, `subject` unique together, `operatorId`, `email`).
- **API:** `platform/auth/google.ts` (exchange and verification, with
  injectable `fetch` and key set for tests); `signInWithGoogle` in
  `platform/auth/service.ts`; routes `GET /api/auth/providers`,
  `POST /api/auth/google/authorization-url`, `POST /api/auth/google`; four
  optional env vars, all or none: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`, `GOOGLE_ALLOWED_EMAILS`.
- **Web:** `app/auth/google/{start,callback}/route.ts`; `lib/google-flow.ts`
  (the flow cookie, PKCE, the constant-time `state` check, fixed error
  messages); a Google button and error messages on the login page; `/auth/`
  exempt from the middleware.
- **Dependency:** `jose`, to verify the signed ID token (key rotation, accepted
  algorithms and claim checks are where hand-rolled verification goes wrong).

## Tests
No test calls Google: a locally generated key signs test ID tokens and a stub
replaces the token endpoint. Each acceptance criterion has a test, the
negative ones first; each guard is mutation-checked.
