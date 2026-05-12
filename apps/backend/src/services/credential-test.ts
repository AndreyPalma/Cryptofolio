// credential-test.ts — US-012 A3, A4, A5
// CredentialTestService: verifica conectividad real con cada servicio externo.
// SECURITY: NUNCA loguear ni retornar valores de API keys ni secrets.

import { createBinanceApiClient } from "../sync/clients/binance-api.js";
import { ValidationError, ExternalApiError, ApiKeyMissingError } from "./errors.js";
import type { CredentialTestResult } from "../schemas/credentials.js";

// ─── CredentialTestService ────────────────────────────────────────────────────

export class CredentialTestService {
  private static readonly TIMEOUT_MS = 8_000;

  /** Test Alchemy API key connectivity. */
  async testAlchemy(): Promise<CredentialTestResult> {
    const apiKey = process.env.ALCHEMY_API_KEY?.trim();
    if (!apiKey) {
      return { status: "failed", reason: "API key not configured" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, CredentialTestService.TIMEOUT_MS);

    const url = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
    const _scrubbedUrl = url.replace(/\/v2\/[^/]+/, "/v2/***");
    const start = Date.now();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        signal: controller.signal,
      });
      const latencyMs = Math.round(Date.now() - start);

      if (res.status === 429) {
        return { status: "failed", reason: "Rate limit exceeded" };
      }
      if (res.status >= 500) {
        return { status: "failed", reason: "Alchemy unreachable" };
      }
      if (res.status === 401 || res.status === 403) {
        return { status: "failed", reason: "Invalid API key" };
      }

      let body: unknown = {};
      try {
        body = await res.json();
      } catch {
        // ignore parse error
      }

      const data = body as { result?: string; error?: { code: number; message: string } };

      if (data.error) {
        const msg = typeof data.error.message === "string" ? data.error.message.toLowerCase() : "";
        if (msg.includes("invalid") || msg.includes("api key")) {
          return { status: "failed", reason: "Invalid API key" };
        }
        return { status: "failed", reason: data.error.message };
      }

      if (data.result && typeof data.result === "string") {
        return { status: "connected", meta: { latencyMs } };
      }

      return { status: "failed", reason: "Alchemy unreachable" };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { status: "failed", reason: "Connection timed out" };
      }
      return { status: "failed", reason: "Alchemy unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Test Binance API key connectivity using the existing BinanceApiClient. */
  async testBinance(): Promise<CredentialTestResult> {
    const apiKey = process.env.BINANCE_API_KEY?.trim();
    const secretKey = process.env.BINANCE_SECRET_KEY?.trim();

    if (!apiKey || !secretKey) {
      return { status: "failed", reason: "API key not configured" };
    }

    // We need a minimal logger for BinanceApiClient — never log key values
    const silentLog = {
      warn: () => {
        /* noop */
      },
      error: () => {
        /* noop */
      },
      info: () => {
        /* noop */
      },
      debug: () => {
        /* noop */
      },
      trace: () => {
        /* noop */
      },
      fatal: () => {
        /* noop */
      },
      child: function () {
        return this;
      },
      level: "silent",
      silent: () => {
        /* noop */
      },
    } as unknown as import("fastify").FastifyBaseLogger;

    const client = createBinanceApiClient({ apiKey, secretKey, log: silentLog });

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, CredentialTestService.TIMEOUT_MS);

    try {
      // getAccountAssets calls GET /api/v3/account — validates both key and signature
      const assets = await client.getAccountAssets();
      return { status: "connected", meta: { assetCount: assets.length } };
    } catch (err) {
      if (err instanceof ValidationError && err.code === "BINANCE_INVALID_CREDENTIALS") {
        // -2014 or -2015 — bad key format or invalid signature
        return { status: "failed", reason: "Invalid API key" };
      }
      if (err instanceof ApiKeyMissingError) {
        return { status: "failed", reason: "API key not configured" };
      }
      if (err instanceof ExternalApiError) {
        const cause = err.upstreamCause as { status?: number; binanceCode?: number } | null;
        if (cause?.status === 429) {
          return { status: "failed", reason: "Binance rate limit exceeded" };
        }
        if (cause?.status === 403) {
          return { status: "failed", reason: "API key requires read permissions" };
        }
        if (cause?.binanceCode) {
          return { status: "failed", reason: `Binance error code ${String(cause.binanceCode)}` };
        }
        if (cause?.status) {
          return { status: "failed", reason: `Binance HTTP ${String(cause.status)}` };
        }
        return { status: "failed", reason: "Binance unreachable" };
      }
      if (err instanceof Error && err.name === "AbortError") {
        return { status: "failed", reason: "Connection timed out" };
      }
      return { status: "failed", reason: "Binance unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
}
