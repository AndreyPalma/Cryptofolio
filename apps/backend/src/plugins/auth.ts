import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { authRoutes } from "../routes/auth.js";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate fastify with the authenticate preHandler
  // fp() ensures this decorator is visible outside the plugin scope
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify({ onlyCookie: true });
      } catch {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    },
  );

  // 1. Register auth routes FIRST (public — no hook applied yet)
  await fastify.register(authRoutes, { prefix: "/api/auth" });

  // 2. THEN add the onRequest hook that protects all /api/* routes
  //    EXCEPT /api/auth/* (login and logout are public)
  fastify.addHook("onRequest", async (request, reply) => {
    const url = request.url;

    // Non-/api/ routes (e.g. /health) — pass through
    if (!url.startsWith("/api/")) return;

    // Auth routes are public — pass through
    if (url.startsWith("/api/auth/")) return;

    // All other /api/* routes — require valid JWT cookie
    return fastify.authenticate(request, reply);
  });
};

export default fp(authPlugin, { name: "authPlugin" });
