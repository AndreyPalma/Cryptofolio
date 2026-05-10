// BinanceApiClient — US-008-B
// Wraps all signed Binance REST calls.
// SECURITY: BINANCE_SECRET_KEY must NEVER appear in URLs, logs, error messages, or cause objects.
// SECURITY: BINANCE_API_KEY must not appear in logged URLs or error causes.

import crypto from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { ApiKeyMissingError, ExternalApiError, ValidationError } from '../../services/errors.js';

// ─── Binance API response types ────────────────────────────────────────────────

export type BinanceTrade = {
  symbol: string;
  id: number;          // Binance trade ID — fits in JS number (int53 safe)
  orderId: number;
  price: string;       // string decimal
  qty: string;
  quoteQty: string;
  isBuyer: boolean;
  time: number;        // unix ms
  commissionAsset: string | null;
  commission: string | null;
};

export type BinanceConvert = {
  orderId: string;     // large integer string — up to 18 digits; parsed to BigInt for DB
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;
  status: string;      // 'SUCCESS' | 'FAIL' | ...
  createTime: number;  // unix ms
};

export type BinanceWithdrawal = {
  id: string;          // withdrawal record ID (numeric string)
  coin: string;
  amount: string;
  address: string;
  txId: string;        // on-chain tx hash — bridge for resolveTransferCost
  applyTime: number;   // unix ms
  status: number;      // 6 = completed
};

export type BinanceDeposit = {
  coin: string;
  amount: string;
  address: string;     // the on-chain address it came from
  txId: string;        // on-chain tx hash
  insertTime: number;  // unix ms
  status: number;      // 1 = success
};

// ─── BinanceApiClient interface ────────────────────────────────────────────────

export interface BinanceApiClient {
  assertConfigured(): void;
  getAccountAssets(): Promise<Array<{ asset: string; free: string; locked: string }>>;
  /** Returns the set of all symbol names currently in TRADING status. Public endpoint, no auth required.
   *  Call once per sync run to pre-filter candidate pairs before querying myTrades. */
  getValidTradingSymbols(): Promise<Set<string>>;
  /** Returns null when the symbol doesn't exist on Binance (-1121), so callers can skip it entirely. */
  getMyTrades(symbol: string, startTime: number, endTime: number): Promise<BinanceTrade[] | null>;
  getConvertHistory(startTime: number, endTime: number): Promise<BinanceConvert[]>;
  getWithdrawHistory(startTime: number, endTime: number): Promise<BinanceWithdrawal[]>;
  getDepositHistory(startTime: number, endTime: number): Promise<BinanceDeposit[]>;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface BinanceErrorBody {
  code?: number;
  msg?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Removes 'signature' from a copy of params — safe for logging. */
function scrubParams(params: URLSearchParams): string {
  const copy = new URLSearchParams(params.toString());
  copy.delete('signature');
  return copy.toString();
}

/** HMAC-SHA256 signature for Binance signed endpoints. */
function sign(secretKey: string, queryString: string): string {
  return crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
}

const BINANCE_BASE = 'https://api.binance.com';

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createBinanceApiClient(opts: {
  apiKey: string;
  secretKey: string;
  log: FastifyBaseLogger;
}): BinanceApiClient {
  const { apiKey, secretKey, log } = opts;

  /** Builds a signed request and returns parsed JSON. Never logs secretKey or apiKey values. */
  async function signed<T>(endpoint: string, params: Record<string, string | number> = {}, silentCodes: number[] = []): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    qs.set('timestamp', String(Date.now()));
    qs.set('recvWindow', '60000');

    const signature = sign(secretKey, qs.toString());
    qs.set('signature', signature);

    let res: Response;
    try {
      res = await fetch(`${BINANCE_BASE}${endpoint}?${qs.toString()}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      });
    } catch (err) {
      // Do NOT include URL (contains signature) or apiKey/secretKey in cause
      throw new ExternalApiError('binance', { message: String(err) });
    }

    if (res.status === 429) {
      log.warn({ endpoint, status: 429, params: scrubParams(qs) }, '[BinanceApiClient] rate limited');
      throw new ExternalApiError('binance', { status: 429 });
    }

    if (!res.ok) {
      let body: BinanceErrorBody = {};
      try {
        body = (await res.json()) as BinanceErrorBody;
      } catch {
        // ignore parse error
      }

      if (body.code === -2015 || body.code === -2014) {
        log.warn(
          { endpoint, binanceCode: body.code, params: scrubParams(qs) },
          '[BinanceApiClient] invalid credentials',
        );
        throw new ValidationError(
          'Invalid Binance API credentials or insufficient permissions',
          'BINANCE_INVALID_CREDENTIALS',
        );
      }

      if (typeof body.code === 'number' && silentCodes.includes(body.code)) {
        log.debug({ endpoint, binanceCode: body.code }, '[BinanceApiClient] expected non-2xx — skipping');
      } else {
        log.warn(
          { endpoint, status: res.status, binanceCode: body.code, params: scrubParams(qs) },
          '[BinanceApiClient] non-2xx response',
        );
      }
      throw new ExternalApiError('binance', { status: res.status, binanceCode: body.code });
    }

    // Also handle 2xx bodies that carry error codes (Binance quirk)
    const data = (await res.json()) as BinanceErrorBody & T;
    if (typeof data.code === 'number' && data.code < 0) {
      if (data.code === -2015 || data.code === -2014) {
        throw new ValidationError(
          'Invalid Binance API credentials or insufficient permissions',
          'BINANCE_INVALID_CREDENTIALS',
        );
      }
      throw new ExternalApiError('binance', { binanceCode: data.code });
    }

    return data as T;
  }

  return {
    assertConfigured(): void {
      if (!apiKey?.trim()) {
        throw new ApiKeyMissingError('BINANCE_API_KEY');
      }
      if (!secretKey?.trim()) {
        throw new ApiKeyMissingError('BINANCE_SECRET_KEY');
      }
    },

    async getAccountAssets(): Promise<Array<{ asset: string; free: string; locked: string }>> {
      const data = await signed<{ balances: Array<{ asset: string; free: string; locked: string }> }>(
        '/api/v3/account',
      );
      return data.balances.filter(
        (b) => parseFloat(b.free) + parseFloat(b.locked) > 0,
      );
    },

    async getValidTradingSymbols(): Promise<Set<string>> {
      // Public endpoint — no signature required. Returns all symbols with status=TRADING.
      let res: Response;
      try {
        res = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbolStatus=TRADING`);
      } catch (err) {
        throw new ExternalApiError('binance', { message: String(err) });
      }
      if (!res.ok) {
        throw new ExternalApiError('binance', { status: res.status });
      }
      const data = await res.json() as { symbols: Array<{ symbol: string; status: string }> };
      const valid = new Set<string>();
      for (const s of data.symbols) {
        if (s.status === 'TRADING') valid.add(s.symbol);
      }
      return valid;
    },

    async getMyTrades(symbol: string, startTime: number, endTime: number): Promise<BinanceTrade[] | null> {
      let raw: Array<{
        symbol: string;
        id: number;
        orderId: number;
        price: string;
        qty: string;
        quoteQty: string;
        isBuyer: boolean;
        time: number;
        commissionAsset?: string;
        commission?: string;
      }>;
      try {
        raw = await signed<typeof raw>('/api/v3/myTrades', { symbol, startTime, endTime }, [-1121]);
      } catch (err) {
        // -1121: symbol doesn't exist on Binance — return null so caller can skip all remaining windows
        if (err instanceof ExternalApiError) {
          const cause = err.upstreamCause as { binanceCode?: number } | null;
          if (cause?.binanceCode === -1121) {
            return null;
          }
        }
        throw err;
      }

      return raw.map((t) => ({
        symbol: t.symbol,
        id: t.id,
        orderId: t.orderId,
        price: t.price,
        qty: t.qty,
        quoteQty: t.quoteQty,
        isBuyer: t.isBuyer,
        time: t.time,
        commissionAsset: t.commissionAsset ?? null,
        commission: t.commission ?? null,
      }));
    },

    async getConvertHistory(startTime: number, endTime: number): Promise<BinanceConvert[]> {
      const data = await signed<{
        list: Array<{
          orderId: string;
          fromAsset: string;
          toAsset: string;
          fromAmount: string;
          toAmount: string;
          orderStatus: string;
          createTime: number;
        }>;
      }>('/sapi/v1/convert/tradeFlow', { startTime, endTime });

      return (data.list ?? [])
        .filter((c) => c.orderStatus === 'SUCCESS')
        .map((c) => ({
          orderId: c.orderId,
          fromAsset: c.fromAsset,
          toAsset: c.toAsset,
          fromAmount: c.fromAmount,
          toAmount: c.toAmount,
          status: c.orderStatus,
          createTime: c.createTime,
        }));
    },

    async getWithdrawHistory(startTime: number, endTime: number): Promise<BinanceWithdrawal[]> {
      const raw = await signed<Array<{
        id: string;
        coin: string;
        amount: string;
        address: string;
        txId: string;
        applyTime: number;
        status: number;
      }>>('/sapi/v1/capital/withdraw/history', { startTime, endTime });

      return (raw ?? []).filter((w) => w.status === 6);
    },

    async getDepositHistory(startTime: number, endTime: number): Promise<BinanceDeposit[]> {
      const raw = await signed<Array<{
        coin: string;
        amount: string;
        address: string;
        txId: string;
        insertTime: number;
        status: number;
      }>>('/sapi/v1/capital/deposit/hisrec', { startTime, endTime });

      return (raw ?? []).filter((d) => d.status === 1);
    },
  };
}
