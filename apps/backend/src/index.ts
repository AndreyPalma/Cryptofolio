import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { healthPlugin } from "./plugins/health.js";
import { bootstrapAuth, ADMIN_USER_ID } from "./services/auth-bootstrap.js";
import authPlugin from "./plugins/auth.js";
import { SyncOrchestrator } from './services/sync-orchestrator.js';

export interface BuildServerOptions {
  /** JWT secret for @fastify/jwt. Required for auth to work. */
  jwtSecret?: string;
  /** Whether to register auth plugins. Default: true */
  enableAuth?: boolean;
}

export async function buildServer(
  opts: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const { jwtSecret = process.env.JWT_SECRET ?? "", enableAuth = true } = opts;

  const fastify = Fastify({ logger: { level: 'warn' } }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Validation failed",
        issues: error.issues,
      });
    }

    if (error instanceof Error) {
      const statusCode =
        "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number"
          ? (error as { statusCode: number }).statusCode
          : 500;
      if (statusCode === 500) _request.log.error({ err: error }, 'unhandled error');
      return reply.status(statusCode).send({
        statusCode,
        error: error.name,
        message: error.message,
      });
    }

    return reply.status(500).send({
      statusCode: 500,
      error: "InternalServerError",
      message: "Unknown error",
    });
  });

  if (enableAuth) {
    // Auth plugins — order is NON-NEGOTIABLE (see design §2.2)
    // 1. @fastify/cookie — must be registered before @fastify/jwt reads cookies
    // 2. @fastify/jwt — must be registered before authPlugin signs/verifies tokens
    // 3. authPlugin — registers public auth routes BEFORE adding the onRequest hook
    const fastifyCookie = await import("@fastify/cookie");
    const fastifyJwt = await import("@fastify/jwt");

    await fastify.register(fastifyCookie.default);
    await fastify.register(fastifyJwt.default, {
      secret: jwtSecret,
      cookie: { cookieName: "token", signed: false },
    });

    await fastify.register(authPlugin);
  }

  // SyncOrchestrator — in-memory wallet-level lock for sync concurrency control (US-015)
  const syncOrchestrator = new SyncOrchestrator(fastify.log);
  fastify.decorate('syncOrchestrator', syncOrchestrator);

  // Domain route plugins — registered after authPlugin so onRequest hook covers them
  const { walletRoutes } = await import('./routes/wallets.js');
  const { tokenRoutes } = await import('./routes/tokens.js');
  const { transactionRoutes } = await import('./routes/transactions.js');
  const { portfolioRoutes } = await import('./routes/portfolio.js');
  const { syncRoutes } = await import('./routes/sync.js');
  const { credentialRoutes } = await import('./routes/credentials.js');
  await fastify.register(walletRoutes, { prefix: '/api/wallets' });
  await fastify.register(tokenRoutes, { prefix: '/api/tokens' });
  await fastify.register(transactionRoutes, { prefix: '/api/transactions' });
  await fastify.register(portfolioRoutes, { prefix: '/api/portfolio' });
  await fastify.register(syncRoutes, { prefix: '/api/sync' });
  await fastify.register(credentialRoutes, { prefix: '/api/credentials' });

  // Health route — public, outside /api/* scope
  await fastify.register(healthPlugin);

  return fastify;
}

// Entry point — only executed when run directly, not when imported by tests
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- boolean OR, not null coalescing
const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");

if (isMain) {
  try {
    const { parseEnv } = await import("./env.js");
    const env = parseEnv();

    // Bootstrap bcrypt hash BEFORE creating the server (design §2.2, step 1)
    await bootstrapAuth();

    // Ensure the single admin user row exists (FK required by wallets, transactions, etc.)
    const { pool } = await import('./db/pool.js');
    await pool.query(
      `INSERT INTO users (id, password_hash) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_USER_ID, '__bootstrapped__'],
    );

    // Clean up orphaned sync runs from previous crashes (RD-017).
    // Placed here (isMain block) instead of inside buildServer() so unit tests
    // that import buildServer() don't require a live DB or sync_runs table.
    // Effect is equivalent: cleanup runs before any routes are registered.
    const { cleanupStaleRuns } = await import('./services/sync-run-helper.js');
    const { deleted } = await cleanupStaleRuns(pool);
    if (deleted > 0) {
      console.info(`Cleaned up ${deleted} stale sync runs`);
    }

    const server = await buildServer({ jwtSecret: env.JWT_SECRET });
    await server.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        process.stderr.write(`[env] ${issue.path.join(".")}: ${issue.message}\n`);
      }
    } else {
      process.stderr.write(String(err) + "\n");
    }
    // eslint-disable-next-line n/no-process-exit -- entry-point guard: env failure must exit non-zero per spec
    process.exit(1);
  }
}
