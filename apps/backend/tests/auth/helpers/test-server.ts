/**
 * Shared test server factory for auth tests.
 * Builds a minimal Fastify server with the auth plugins registered,
 * plus a protected /api/test route for middleware tests.
 */

import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import { bootstrapAuth } from "../../../src/services/auth-bootstrap.js";
import authPlugin from "../../../src/plugins/auth.js";

export async function buildTestServer(): Promise<FastifyInstance> {
  // Bootstrap bcrypt hash (idempotent — safe to call multiple times)
  await bootstrapAuth();

  const fastify = Fastify({ logger: false });

  await fastify.register(fastifyCookie);
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? "test-jwt-secret-at-least-32-chars-long!!",
    cookie: { cookieName: "token", signed: false },
  });

  await fastify.register(authPlugin);

  // Protected test route — used by middleware tests
  fastify.get("/api/test", () => ({ ok: true }));

  return fastify;
}
