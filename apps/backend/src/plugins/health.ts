import type { FastifyInstance } from "fastify";

export async function healthPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async (_request, _reply) => {
    return { status: "ok" };
  });
}
