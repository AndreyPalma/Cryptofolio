// BinanceApiClient — US-008-B
// Wraps all signed Binance REST calls.
// SECURITY: BINANCE_SECRET_KEY must NEVER appear in URLs, logs, error messages, or cause objects.
// SECURITY: BINANCE_API_KEY must not appear in logged URLs or error causes.

import crypto from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { ApiKeyMissingError, ExternalApiError, ValidationError } from '../../services/errors.js';

export class FiatPermissionDeniedError extends Error {
  constructor(endpoint: string, code?: number) {
    super(`Fiat endpoint ${endpoint} denied: code=${String(code)}`);
    this.name = 'FiatPermissionDeniedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Binance API response types ────────────────────────────────────────────────

export interface BinanceTrade {
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
}

export interface BinanceConvert {
  orderId: string;     // large integer string — up to 18 digits; parsed to BigInt for DB
  fromAsset: string;
  toAsset: string;
  fromAmount: string;
  toAmount: string;
  status: string;      // 'SUCCESS' | 'FAIL' | ...
  createTime: number;  // unix ms
}

export interface BinanceWithdrawal {
  id: string;          // withdrawal record ID (numeric string)
  coin: string;
  amount: string;
  address: string;
  txId: string;        // on-chain tx hash — bridge for resolveTransferCost
  applyTime: number;   // unix ms
  status: number;      // 6 = completed
}

export interface BinanceDeposit {
  coin: string;
  amount: string;
  address: string;     // the on-chain address it came from
  txId: string;        // on-chain tx hash
  insertTime: number;  // unix ms
  status: number;      // 1 = success
}

export interface BinanceFiatOrder {
  orderNo: string;
  sourceAmount: string;
  obtainAmount: string;
  fiatCurrency: string;
  cryptoCurrency: string;
  totalFee: string;
  price: string;
  status: string;
  createTime: number;
}

export interface BinanceFiatPayment {
  orderNo: string;
  sourceAmount: string;
  obtainAmount: string;
  fiatCurrency: string;
  cryptoCurrency: string;
  totalFee: string;
  status: string;
  createTime: number;
}

// ─── BinanceApiClient interface ────────────────────────────────────────────────

export interface BinanceApiClient {
  assertConfigured(): void;
  getAccountAssets(signal?: AbortSignal): Promise<{ asset: string; free: string; locked: string }[]>;
  /** Returns the set of all symbol names currently in TRADING status. Public endpoint, no auth required.
   *  Call once per sync run to pre-filter candidate pairs before querying myTrades. */
  getValidTradingSymbols(signal?: AbortSignal): Promise<Set<string>>;
  /** Returns null when the symbol doesn't exist on Binance (-1121), so callers can skip it entirely. */
  getMyTrades(symbol: string, startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceTrade[] | null>;
  getConvertHistory(startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceConvert[]>;
  getWithdrawHistory(startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceWithdrawal[]>;
  getDepositHistory(startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceDeposit[]>;
  getFiatOrders(opts: { beginTime: number; endTime: number; transactionType: 0 | 1; signal?: AbortSignal }): Promise<BinanceFiatOrder[]>;
  getFiatPayments(opts: { beginTime: number; endTime: number; transactionType: 0 | 1; signal?: AbortSignal }): Promise<BinanceFiatPayment[]>;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface BinanceErrorBody {
  code?: number;
  msg?: string;
}

const FIAT_PERMISSION_CODES = new Set([-1022, -2008, -2014, -2015, -1109]);

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

function toFiatPermissionDeniedError(endpoint: string, err: unknown): FiatPermissionDeniedError | null {
  if (err instanceof ValidationError) {
    return new FiatPermissionDeniedError(endpoint);
  }

  if (!(err instanceof ExternalApiError)) {
    return null;
  }

  const cause = err.upstreamCause;
  if (typeof cause !== 'object' || cause === null) {
    return null;
  }

  const { status, binanceCode } = cause as { status?: number; binanceCode?: number };
  if (status === 401 || status === 403) {
    return new FiatPermissionDeniedError(endpoint, status);
  }

  if (typeof binanceCode === 'number' && FIAT_PERMISSION_CODES.has(binanceCode)) {
    return new FiatPermissionDeniedError(endpoint, binanceCode);
  }

  return null;
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
  async function signed<T>(
    endpoint: string,
    params: Record<string, string | number> = {},
    silentCodes: number[] = [],
    signal?: AbortSignal,
  ): Promise<T> {
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
        signal,
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

    return data;
  }

  return {
    assertConfigured(): void {
      if (!apiKey.trim()) {
        throw new ApiKeyMissingError('BINANCE_API_KEY');
      }
      if (!secretKey.trim()) {
        throw new ApiKeyMissingError('BINANCE_SECRET_KEY');
      }
    },

    async getAccountAssets(signal?: AbortSignal): Promise<{ asset: string; free: string; locked: string }[]> {
      const data = await signed<{ balances: { asset: string; free: string; locked: string }[] }>(
        '/api/v3/account',
        {},
        [],
        signal,
      );
      return data.balances.filter(
        (b) => parseFloat(b.free) + parseFloat(b.locked) > 0,
      );
    },

    async getValidTradingSymbols(signal?: AbortSignal): Promise<Set<string>> {
      // Public endpoint — no signature required. Returns all symbols with status=TRADING.
      let res: Response;
      try {
        res = await fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?symbolStatus=TRADING`, { signal });
      } catch (err) {
        throw new ExternalApiError('binance', { message: String(err) });
      }
      if (!res.ok) {
        throw new ExternalApiError('binance', { status: res.status });
      }
      const data = await res.json() as { symbols: { symbol: string; status: string }[] };
      const valid = new Set<string>();
      for (const s of data.symbols) {
        if (s.status === 'TRADING') valid.add(s.symbol);
      }
      return valid;
    },

    async getMyTrades(symbol: string, startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceTrade[] | null> {
      let raw: {
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
      }[];
      try {
        raw = await signed<typeof raw>('/api/v3/myTrades', { symbol, startTime, endTime }, [-1121], signal);
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

    async getConvertHistory(startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceConvert[]> {
      const data = await signed<{
        list: {
          orderId: string;
          fromAsset: string;
          toAsset: string;
          fromAmount: string;
          toAmount: string;
          orderStatus: string;
          createTime: number;
        }[];
      }>('/sapi/v1/convert/tradeFlow', { startTime, endTime }, [], signal);

      return data.list
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

    async getWithdrawHistory(startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceWithdrawal[]> {
      const raw = await signed<{
        id: string;
        coin: string;
        amount: string;
        address: string;
        txId: string;
        applyTime: number;
        status: number;
      }[]>('/sapi/v1/capital/withdraw/history', { startTime, endTime }, [], signal);

      return raw.filter((w) => w.status === 6);
    },

    async getDepositHistory(startTime: number, endTime: number, signal?: AbortSignal): Promise<BinanceDeposit[]> {
      const raw = await signed<{
        coin: string;
        amount: string;
        address: string;
        txId: string;
        insertTime: number;
        status: number;
      }[]>('/sapi/v1/capital/deposit/hisrec', { startTime, endTime }, [], signal);

      return raw.filter((d) => d.status === 1);
    },

    async getFiatOrders(opts): Promise<BinanceFiatOrder[]> {
      const endpoint = '/sapi/v1/fiat/orders';
      try {
        const data = await signed<{ code: string; message: string; data: BinanceFiatOrder[] }>(
          endpoint,
          {
            beginTime: opts.beginTime,
            endTime: opts.endTime,
            transactionType: opts.transactionType,
          },
          [],
          opts.signal,
        );
        return data.data.filter((order) => order.status === 'Completed');
      } catch (err) {
        const permissionError = toFiatPermissionDeniedError(endpoint, err);
        if (permissionError) {
          throw permissionError;
        }
        throw err;
      }
    },

    async getFiatPayments(opts): Promise<BinanceFiatPayment[]> {
      const endpoint = '/sapi/v1/fiat/payments';
      try {
        const data = await signed<{ code: string; message: string; data: BinanceFiatPayment[] }>(
          endpoint,
          {
            beginTime: opts.beginTime,
            endTime: opts.endTime,
            transactionType: opts.transactionType,
          },
          [],
          opts.signal,
        );
        return data.data.filter((payment) => payment.status === 'Completed');
      } catch (err) {
        const permissionError = toFiatPermissionDeniedError(endpoint, err);
        if (permissionError) {
          throw permissionError;
        }
        throw err;
      }
    },
  };
}
