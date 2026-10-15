import rateLimit from '@fastify/rate-limit';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import type { GoogleConfig, GoogleDeps } from './google.js';
import { authorizationUrl, GoogleSignInError, verifyGoogleSignIn } from './google.js';
import type { SignedIn } from './service.js';
import { auditRejectedGoogleSignIn, signIn, signInWithGoogle, signOut } from './service.js';
import { SESSION_COOKIE } from './session.js';

// The password cap bounds the work one request can force through scrypt.
const loginBody = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

// state, nonce and the PKCE verifier and challenge are 32 random bytes in
// base64url (43 characters); anything else never reaches Google.
const flowValue = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const authorizationBody = z
  .object({ state: flowValue, codeChallenge: flowValue, nonce: flowValue })
  .strict();
const googleBody = z
  .object({ code: z.string().min(1).max(2048), codeVerifier: flowValue, nonce: flowValue })
  .strict();

// Per client IP, shared through Redis so the limit holds across API instances.
// Fails closed: if Redis is down, login errors rather than going unlimited.
const LOGIN_ATTEMPTS_PER_MINUTE = 5;

export async function registerAuthRoutes<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    Logger
  >,
  options: {
    redisUrl: string;
    keyPrefix: string;
    secureCookie: boolean;
    /** Absent when Google sign-in is not configured. */
    google?: { config: GoogleConfig; deps?: GoogleDeps };
  },
): Promise<void> {
  // Lazy: processes that never take a login never open this connection.
  const redis = new Redis(options.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  app.addHook('onClose', () => redis.quit().then(() => undefined, () => undefined));
  await app.register(rateLimit, {
    global: false,
    redis,
    nameSpace: `${options.keyPrefix}:login-limit:`,
    // Thrown into the shared error handler, so a 429 has the standard envelope.
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', `too many attempts; retry in ${context.after}`),
  });

  app.post(
    '/api/auth/login',
    {
      config: {
        public: true,
        rateLimit: { max: LOGIN_ATTEMPTS_PER_MINUTE, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { username, password } = loginBody.parse(request.body);
      const signedIn = await signIn(username, password);
      if (!signedIn) {
        // One message for both cases, so the response never says which was wrong.
        throw new AppError(401, 'INVALID_CREDENTIALS', 'invalid username or password');
      }
      return startSession(reply, signedIn);
    },
  );

  // Whether the sign-in page should offer Google. Says nothing else.
  app.get('/api/auth/providers', { config: { public: true } }, async () => ({
    data: { google: options.google !== undefined },
  }));

  app.post('/api/auth/google/authorization-url', { config: { public: true } }, async (request) => {
    const google = requireGoogle();
    return { data: { url: authorizationUrl(google.config, authorizationBody.parse(request.body)) } };
  });

  app.post(
    '/api/auth/google',
    {
      config: {
        public: true,
        rateLimit: { max: LOGIN_ATTEMPTS_PER_MINUTE, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const google = requireGoogle();
      const body = googleBody.parse(request.body);
      try {
        const identity = await verifyGoogleSignIn(google.config, body, google.deps);
        return startSession(reply, await signInWithGoogle(identity));
      } catch (error) {
        if (!(error instanceof GoogleSignInError)) throw error;
        await auditRejectedGoogleSignIn(error.reason);
        if (error.reason === 'not_allowed') {
          throw new AppError(403, 'GOOGLE_NOT_ALLOWED', 'this Google account may not sign in');
        }
        throw new AppError(401, 'GOOGLE_SIGN_IN_FAILED', 'Google sign-in could not be verified');
      }
    },
  );

  function requireGoogle(): { config: GoogleConfig; deps?: GoogleDeps } {
    if (!options.google) {
      throw new AppError(404, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured');
    }
    return options.google;
  }

  function startSession(reply: FastifyReply, signedIn: SignedIn) {
    reply.setCookie(SESSION_COOKIE, signedIn.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: options.secureCookie,
      path: '/',
      expires: signedIn.expiresAt,
    });
    return { data: { operator: signedIn.operator, expiresAt: signedIn.expiresAt.toISOString() } };
  }

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!request.operator || !token) {
      throw new AppError(401, 'UNAUTHENTICATED', 'sign in required');
    }
    await signOut(request.operator, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (request) => ({ data: request.operator }));
}
