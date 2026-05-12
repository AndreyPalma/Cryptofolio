// credentials.ts — US-012 A2, A3, A4, A5
// Fastify plugin: GET /api/credentials + POST /api/credentials/test/:service
// Auth: covered by the global onRequest hook in authPlugin (all /api/* routes).
// SECURITY: Never log or return API key values.

import type { FastifyPluginAsync } from "fastify";
import { CredentialServiceParamSchema } from "../schemas/credentials.js";
import { CredentialTestService } from "../services/credential-test.js";

const credentialTestService = new CredentialTestService();

export const credentialRoutes: FastifyPluginAsync = async (fastify) => {
  await Promise.resolve();
  // ── GET / — check presence of env API keys ──────────────────────────────────
  fastify.get("/", async (_req, reply) => {
    const presence = {
      ALCHEMY_API_KEY: Boolean(process.env.ALCHEMY_API_KEY?.trim()),
      BINANCE_API_KEY: Boolean(process.env.BINANCE_API_KEY?.trim()),
      BINANCE_SECRET_KEY: Boolean(process.env.BINANCE_SECRET_KEY?.trim()),
    };
    return reply.status(200).send(presence);
  });

  // ── POST /test/:service — real connectivity check ───────────────────────────
  fastify.post<{ Params: { service: string } }>("/test/:service", async (req, reply) => {
    const parseResult = CredentialServiceParamSchema.safeParse(req.params);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: `Invalid service. Valid values: binance, alchemy`,
        issues: parseResult.error.issues,
      });
    }

    const { service } = parseResult.data;

    let result;
    switch (service) {
      case "binance":
        result = await credentialTestService.testBinance();
        break;
      case "alchemy":
        result = await credentialTestService.testAlchemy();
        break;
    }

    return reply.status(200).send(result);
  });
};
