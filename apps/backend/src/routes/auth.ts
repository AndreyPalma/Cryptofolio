import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getPasswordHash, ADMIN_USER_ID } from "../services/auth-bootstrap.js";
import { verifyPassword } from "../services/password.js";

const LoginBodySchema = z.object({
  password: z.string().min(1),
});

/**
 * Returns cookie options for the auth cookie.
 * - login: Max-Age=86400
 * - logout: Max-Age=0 (clears the cookie)
 */
function getCookieOptions(isLogout: boolean) {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("strict" as const) : ("lax" as const),
    path: "/",
    maxAge: isLogout ? 0 : 86400,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature; no top-level await needed here
export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Reject any non-JSON content type with 400 (spec §3.1)
  // By default Fastify 5 returns 415; we override to return 400 as spec requires.
  fastify.addContentTypeParser("*", (_req, _payload, done) => {
    done(
      Object.assign(new Error("Content-Type must be application/json"), {
        statusCode: 400,
      }),
    );
  });

  fastify.post("/login", async (request, reply) => {
    // Parse and validate body with Zod
    const parseResult = LoginBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Validation failed",
        issues: parseResult.error.issues,
      });
    }

    const { password } = parseResult.data;
    const hash = getPasswordHash();
    const isValid = await verifyPassword(password, hash);

    if (!isValid) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const token = fastify.jwt.sign({ sub: ADMIN_USER_ID }, { expiresIn: "24h" });
    reply.setCookie("token", token, getCookieOptions(false));
    return { ok: true };
  });

  fastify.post("/logout", (_request, reply) => {
    reply.setCookie("token", "", getCookieOptions(true));
    return reply.send({ ok: true });
  });
};
