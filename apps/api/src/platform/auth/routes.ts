import rateLimit from '@fastify/rate-limit';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { signIn, signOut } from './service.js';
import { SESSION_COOKIE } from './session.js';

// The password cap bounds the work one request can force through scrypt.
const loginBody = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  })
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
  options: { redisUrl: string; keyPrefix: string; secureCookie: boolean },
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
      reply.setCookie(SESSION_COOKIE, signedIn.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: options.secureCookie,
        path: '/',
        expires: signedIn.expiresAt,
      });
      return {
        data: { operator: signedIn.operator, expiresAt: signedIn.expiresAt.toISOString() },
      };
    },
  );

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
