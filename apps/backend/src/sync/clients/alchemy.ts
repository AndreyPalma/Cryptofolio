// AlchemyClient — US-001
// Unified on-chain client for ETH and BSC via Alchemy.
// Covers both ETH and BSC via alchemy_getAssetTransfers with a single API key.
// Internally absorbs all pageKey pagination and returns the FULL result set.
// MUST NOT log the API key — URL is scrubbed before any log or error cause.

import type { FastifyBaseLogger } from "fastify";
import type { OnChainApiClient, NormalizedTx, NormalizedTokenTx } from "./on-chain-api.js";
import { ApiKeyMissingError, ExternalApiError } from "../../services/errors.js";

/* ------------------------------------------------------------------
   Alchemy JSON-RPC types
   ------------------------------------------------------------------ */

interface AlchemyTransfer {
  readonly uniqueId: string;
  readonly hash: string;
  readonly blockNum: string; // hex string
  readonly from: string;
  readonly to: string | null;
  readonly value: number; // float — IGNORE, use rawContract.value
  readonly asset: string | null;
  readonly category: "external" | "internal" | "erc20" | "erc721" | "erc1155";
  readonly rawContract: {
    readonly address: string | null;
    readonly value: string | null; // hex string
    readonly decimal: string | null; // hex string
  } | null;
  readonly metadata: {
    readonly blockTimestamp: string; // ISO 8601
  };
}

interface AlchemyResult {
  readonly transfers: AlchemyTransfer[];
  readonly pageKey?: string;
}

interface AlchemyResponse {
  readonly jsonrpc: string;
  readonly id: number;
  readonly result?: AlchemyResult;
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

const BASE_URLS: Record<"ETH" | "BSC", string> = {
  ETH: "https://eth-mainnet.g.alchemy.com/v2/",
  BSC: "https://bnb-mainnet.g.alchemy.com/v2/",
};

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [250, 500, 1000];
const JITTER_MAX_MS = 250;

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

/** Replaces the API-key segment in an Alchemy URL path with '***'. */
function scrubAlchemyUrl(url: string): string {
  // Alchemy URLs: https://{network}.g.alchemy.com/v2/{API_KEY}
  // We replace the last path segment (the key) with ***
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    if (parts.length >= 3 && parts[parts.length - 2] === "v2") {
      parts[parts.length - 1] = "***";
      u.pathname = parts.join("/");
    }
    return u.toString();
  } catch {
    return "[invalid-url]";
  }
}

function toHex(n: number): string {
  return "0x" + n.toString(16);
}

function isoToUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------
   Retry wrapper
   ------------------------------------------------------------------ */

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  log: FastifyBaseLogger,
): Promise<Response> {
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);

      // HTTP 429 or 5xx are retryable
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastStatus = res.status;
        if (attempt < MAX_RETRIES) {
          const delay = (RETRY_DELAYS_MS[attempt] ?? 0) + Math.random() * JITTER_MAX_MS;
          log.warn(
            { status: res.status, attempt: attempt + 1, url: scrubAlchemyUrl(url) },
            "alchemy: retryable HTTP error, backing off",
          );
          await sleep(delay);
          continue;
        }

        // Exhausted retries on retryable status
        throw new ExternalApiError("alchemy", {
          status: res.status,
          url: scrubAlchemyUrl(url),
        });
      }

      // Any other HTTP status (including 4xx) is returned for downstream handling
      return res;
    } catch (err) {
      // Network/DNS/fetch-level errors are NOT retried — fail fast
      throw new ExternalApiError("alchemy", {
        message: err instanceof Error ? err.message : String(err),
        url: scrubAlchemyUrl(url),
      });
    }
  }

  // Exhausted all retries
  throw new ExternalApiError("alchemy", {
    status: lastStatus,
    url: scrubAlchemyUrl(url),
  });
}

/* ------------------------------------------------------------------
   Pagination engine
   ------------------------------------------------------------------ */

async function paginateAlchemy(
  apiKey: string,
  baseUrl: string,
  address: string,
  startBlock: number,
  endBlock: number,
  direction: "from" | "to",
  categories: readonly string[],
  log: FastifyBaseLogger,
): Promise<AlchemyTransfer[]> {
  const all: AlchemyTransfer[] = [];
  let pageKey: string | undefined;
  const addressParam = direction === "from" ? "fromAddress" : "toAddress";
  const url = `${baseUrl}${apiKey}`;

  do {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [
        {
          fromBlock: toHex(startBlock),
          toBlock: toHex(endBlock),
          [addressParam]: address.toLowerCase(),
          category: categories,
          withMetadata: true,
          order: "asc",
          maxCount: "0x3e8",
          excludeZeroValue: true,
          ...(pageKey ? { pageKey } : {}),
        },
      ],
    };

    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      log,
    );

    if (!res.ok) {
      throw new ExternalApiError("alchemy", {
        status: res.status,
        statusText: res.statusText,
        url: scrubAlchemyUrl(url),
      });
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (_err) {
      throw new ExternalApiError("alchemy", {
        message: "Invalid JSON response",
        url: scrubAlchemyUrl(url),
      });
    }

    const data = json as AlchemyResponse;

    // RPC-level error (HTTP 200 with body.error) — NO retry
    if (data.error) {
      log.warn({ code: data.error.code, message: data.error.message }, "alchemy: rpc error");
      throw new ExternalApiError("alchemy", {
        code: data.error.code,
        message: data.error.message,
      });
    }

    if (!data.result) {
      throw new ExternalApiError("alchemy", {
        message: "No result in response",
        url: scrubAlchemyUrl(url),
      });
    }

    all.push(...data.result.transfers);
    pageKey = data.result.pageKey;
  } while (pageKey);

  return all;
}

/* ------------------------------------------------------------------
   Normalization
   ------------------------------------------------------------------ */

function normalizeToTx(t: AlchemyTransfer, index: number): NormalizedTx {
  const rawValue = t.rawContract?.value;
  return {
    txHash: t.hash.toLowerCase(),
    blockNumber: parseInt(t.blockNum, 16),
    transactionIndex: index,
    timeStamp: isoToUnixSeconds(t.metadata.blockTimestamp),
    from: t.from.toLowerCase(),
    to: (t.to ?? "").toLowerCase(),
    value: rawValue ? BigInt(rawValue).toString() : "0",
    isError: "0",
    gasUsed: "0",
    methodId: undefined,
  };
}

function normalizeToTokenTx(t: AlchemyTransfer, index: number): NormalizedTokenTx {
  const rawContract = t.rawContract;
  if (!rawContract?.address) {
    throw new ExternalApiError("alchemy", {
      message: `erc20 transfer missing rawContract.address: uniqueId=${t.uniqueId}`,
    });
  }

  const rawValue = rawContract.value;
  return {
    txHash: t.hash.toLowerCase(),
    blockNumber: parseInt(t.blockNum, 16),
    transactionIndex: index,
    logIndex: index,
    timeStamp: isoToUnixSeconds(t.metadata.blockTimestamp),
    from: t.from.toLowerCase(),
    to: (t.to ?? "").toLowerCase(),
    contractAddress: rawContract.address.toLowerCase(),
    tokenSymbol: t.asset ?? "UNKNOWN",
    tokenName: t.asset ?? "UNKNOWN",
    tokenDecimal: rawContract.decimal ? parseInt(rawContract.decimal, 16) : 18,
    value: rawValue ? BigInt(rawValue).toString() : "0",
  };
}

/* ------------------------------------------------------------------
   Merge, dedupe, sort
   ------------------------------------------------------------------ */

function mergeDedupeSort(
  fromTransfers: readonly AlchemyTransfer[],
  toTransfers: readonly AlchemyTransfer[],
): AlchemyTransfer[] {
  const seen = new Set<string>();
  const merged: AlchemyTransfer[] = [];

  for (const t of fromTransfers) {
    if (!seen.has(t.uniqueId)) {
      seen.add(t.uniqueId);
      merged.push(t);
    }
  }

  for (const t of toTransfers) {
    if (!seen.has(t.uniqueId)) {
      seen.add(t.uniqueId);
      merged.push(t);
    }
  }

  merged.sort((a, b) => {
    const blockA = parseInt(a.blockNum, 16);
    const blockB = parseInt(b.blockNum, 16);
    if (blockA !== blockB) return blockA - blockB;
    // Within same block, maintain stable order by original array position
    return 0;
  });

  return merged;
}

/* ------------------------------------------------------------------
   Factory
   ------------------------------------------------------------------ */

export interface AlchemyClientOptions {
  readonly apiKey: string;
  readonly network: "ETH" | "BSC";
  readonly log: FastifyBaseLogger;
}

export function createAlchemyClient(opts: AlchemyClientOptions): OnChainApiClient {
  const { apiKey, network, log } = opts;
  const baseUrl = BASE_URLS[network];

  return Object.freeze({
    network,

    assertConfigured(): void {
      if (!apiKey || apiKey.trim() === "") {
        throw new ApiKeyMissingError("ALCHEMY_API_KEY");
      }
    },

    async fetchNormalTransactions(
      address: string,
      startBlock: number,
      endBlock: number,
    ): Promise<NormalizedTx[]> {
      const fromTransfers = await paginateAlchemy(
        apiKey,
        baseUrl,
        address,
        startBlock,
        endBlock,
        "from",
        ["external", "internal"],
        log,
      );
      const toTransfers = await paginateAlchemy(
        apiKey,
        baseUrl,
        address,
        startBlock,
        endBlock,
        "to",
        ["external", "internal"],
        log,
      );

      const merged = mergeDedupeSort(fromTransfers, toTransfers);
      return merged.map((t, i) => normalizeToTx(t, i));
    },

    async fetchTokenTransactions(
      address: string,
      startBlock: number,
      endBlock: number,
    ): Promise<NormalizedTokenTx[]> {
      const fromTransfers = await paginateAlchemy(
        apiKey,
        baseUrl,
        address,
        startBlock,
        endBlock,
        "from",
        ["erc20"],
        log,
      );
      const toTransfers = await paginateAlchemy(
        apiKey,
        baseUrl,
        address,
        startBlock,
        endBlock,
        "to",
        ["erc20"],
        log,
      );

      const merged = mergeDedupeSort(fromTransfers, toTransfers);
      return merged.map((t, i) => normalizeToTokenTx(t, i));
    },
  });
}
