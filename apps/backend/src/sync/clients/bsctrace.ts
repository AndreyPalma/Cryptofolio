// BSCTraceClient — US-008-A
// Calls BSCTrace JSON-RPC 2.0 — method: nr_getAssetTransfers.
// MUST NOT log the API key.
// BSCTrace internally handles its own pageKey pagination and returns a flat list
// — the adapter normalizes to NormalizedTx[] matching the Etherscan contract.

import type { FastifyBaseLogger } from 'fastify';
import type { OnChainApiClient, NormalizedTx, NormalizedTokenTx } from './on-chain-api.js';
import { ApiKeyMissingError, ExternalApiError } from '../../services/errors.js';

interface BSCTransfer {
  blockNum: string;         // hex string e.g. "0x1a4"
  hash: string;
  from: string;
  to: string;
  value: string;
  asset: string;
  category: string;
  rawContract: {
    address: string | null;
    decimal: string | null;
    value: string;
  };
  metadata: {
    blockTimestamp: string; // ISO 8601
  };
}

interface BSCRpcResponse {
  jsonrpc: string;
  id: number;
  result?: {
    transfers: BSCTransfer[];
    pageKey?: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

const BSC_RPC_URL = 'https://api.bsctrace.com/';

function toHex(n: number): string {
  return '0x' + n.toString(16);
}

function isoToUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function normalizeTransfer(t: BSCTransfer, index: number): NormalizedTx {
  const blockNumber = parseInt(t.blockNum, 16);
  return {
    txHash: t.hash.toLowerCase(),
    blockNumber,
    transactionIndex: index,     // BSCTrace doesn't expose transactionIndex — use position
    timeStamp: isoToUnixSeconds(t.metadata.blockTimestamp),
    from: t.from.toLowerCase(),
    to: t.to.toLowerCase(),
    value: t.rawContract.value,
    isError: '0',               // BSCTrace excludes failed txs
    gasUsed: '0',               // Not available in this endpoint
  };
}

async function callBSCTrace(
  apiKey: string,
  body: unknown,
  log: FastifyBaseLogger,
): Promise<BSCTransfer[]> {
  let res: Response;
  const urlForLog = BSC_RPC_URL; // no key in URL for BSCTrace (key is in header or body)

  try {
    res = await fetch(BSC_RPC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ExternalApiError('bsctrace', { message: String(err), url: urlForLog });
  }

  if (!res.ok) {
    throw new ExternalApiError('bsctrace', {
      status: res.status,
      statusText: res.statusText,
      url: urlForLog,
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (_err) {
    throw new ExternalApiError('bsctrace', { message: 'Invalid JSON', url: urlForLog });
  }

  const data = json as BSCRpcResponse;

  if (data.error) {
    log.warn({ code: data.error.code, message: data.error.message }, 'bsctrace: rpc error');
    throw new ExternalApiError('bsctrace', {
      code: data.error.code,
      message: data.error.message,
    });
  }

  if (!data.result) {
    throw new ExternalApiError('bsctrace', { message: 'No result in response' });
  }

  return data.result.transfers;
}

export interface BSCTraceClientOptions {
  readonly apiKey: string;
  readonly log: FastifyBaseLogger;
}

export function createBSCTraceClient(opts: BSCTraceClientOptions): OnChainApiClient {
  const { apiKey, log } = opts;

  return {
    network: 'BSC',

    assertConfigured() {
      if (!apiKey) {
        throw new ApiKeyMissingError('BSCTRACE_API_KEY');
      }
    },

    async fetchNormalTransactions(
      address: string,
      startBlock: number,
      endBlock: number,
    ): Promise<NormalizedTx[]> {
      const allTransfers: BSCTransfer[] = [];
      let fromBlock = startBlock;

      // BSCTrace paginates via pageKey. We loop until no more pages.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const requestBody = {
          jsonrpc: '2.0',
          id: 1,
          method: 'nr_getAssetTransfers',
          params: [
            {
              fromBlock: toHex(fromBlock),
              toBlock: toHex(endBlock),
              address: address.toLowerCase(),
              category: ['external', 'erc20'],
              maxCount: '0x3e8',
              withMetadata: true,
              excludeZeroValue: true,
            },
          ],
        };

        let res: Response;
        try {
          res = await fetch(BSC_RPC_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
            },
            body: JSON.stringify(requestBody),
          });
        } catch (err) {
          throw new ExternalApiError('bsctrace', { message: String(err) });
        }

        if (!res.ok) {
          throw new ExternalApiError('bsctrace', { status: res.status });
        }

        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new ExternalApiError('bsctrace', { message: 'Invalid JSON' });
        }

        const data = json as BSCRpcResponse;
        if (data.error) {
          throw new ExternalApiError('bsctrace', { code: data.error.code, message: data.error.message });
        }

        if (!data.result) {
          throw new ExternalApiError('bsctrace', { message: 'No result in response' });
        }

        allTransfers.push(...data.result.transfers);

        // If there's a pageKey, continue; otherwise done
        if (!data.result.pageKey) break;

        // Move fromBlock to avoid re-fetching all data (best effort — BSCTrace handles dedup)
        if (data.result.transfers.length > 0) {
          const last = data.result.transfers[data.result.transfers.length - 1];
          if (!last) break;
          fromBlock = parseInt(last.blockNum, 16) - 1;
        } else {
          break;
        }
      }

      return allTransfers.map((t, i) => normalizeTransfer(t, i));
    },

    async fetchTokenTransactions(
      address: string,
      startBlock: number,
      endBlock: number,
    ): Promise<NormalizedTokenTx[]> {
      // BSCTrace's nr_getAssetTransfers covers both native and ERC20.
      // fetchTokenTransactions returns only ERC20 transfers.
      const requestBody = {
        jsonrpc: '2.0',
        id: 1,
        method: 'nr_getAssetTransfers',
        params: [
          {
            fromBlock: toHex(startBlock),
            toBlock: toHex(endBlock),
            address: address.toLowerCase(),
            category: ['erc20'],
            maxCount: '0x3e8',
            withMetadata: true,
            excludeZeroValue: true,
          },
        ],
      };

      const transfers = await callBSCTrace(apiKey, requestBody, log);

      return transfers.map((t, index) => {
        const blockNumber = parseInt(t.blockNum, 16);
        return {
          txHash: t.hash.toLowerCase(),
          blockNumber,
          transactionIndex: index,
          logIndex: index,
          timeStamp: isoToUnixSeconds(t.metadata.blockTimestamp),
          from: t.from.toLowerCase(),
          to: t.to.toLowerCase(),
          contractAddress: (t.rawContract.address ?? '').toLowerCase(),
          tokenSymbol: t.asset,
          tokenName: t.asset,
          tokenDecimal: t.rawContract.decimal ? parseInt(t.rawContract.decimal, 10) : 18,
          value: t.rawContract.value,
        };
      });
    },
  };
}
