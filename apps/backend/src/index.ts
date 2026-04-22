import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { healthPlugin } from "./plugins/health.js";

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

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
    const server = await buildServer();
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
