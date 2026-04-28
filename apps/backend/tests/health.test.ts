import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/index.js";
import type { FastifyInstance } from "fastify";

let server: FastifyInstance;

beforeAll(async () => {
  // Health test does not require auth plugins — disable them to avoid needing JWT_SECRET
  server = await buildServer({ enableAuth: false });
});

afterAll(async () => {
  await server.close();
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const response = await server.inject({ url: "/health", method: "GET" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
