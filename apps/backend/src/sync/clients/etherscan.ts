// EtherscanClient — US-008-A
// Calls Etherscan v2 API (chainid=1 for ETH mainnet).
// MUST NOT log the API key — URL is scrubbed before passing to ExternalApiError cause.

import type { FastifyBaseLogger } from 'fastify';
import type { OnChainApiClient, NormalizedTx, NormalizedTokenTx } from './on-chain-api.js';
import { ApiKeyMissingError, ExternalApiError } from '../../services/errors.js';

interface EtherscanTx {
  hash: string;
  blockNumber: string;
  transactionIndex: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  isError: string;
  gasUsed: string;
  input: string;
}

interface EtherscanTokenTx {
  hash: string;
  blockNumber: string;
  transactionIndex: string;
  transactionPosition?: string;
  logIndex?: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  gasUsed: string;
  input?: string;
}

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T[];
}

const BASE_URL = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = '1'; // ETH mainnet

/** Scrubs the apikey query param so it never appears in logs or error causes. */
function scrubUrl(url: URL): string {
  const scrubbed = new URL(url.toString());
  scrubbed.searchParams.delete('apikey');
  return scrubbed.toString();
}

function normalizeNormalTx(tx: EtherscanTx): NormalizedTx {
  const methodId =
    tx.input && tx.input.length >= 10 && tx.input !== '0x'
      ? (tx.input.slice(0, 10).toLowerCase() as string)
      : undefined;

  return {
    txHash: tx.hash.toLowerCase(),
    blockNumber: parseInt(tx.blockNumber, 10),
    transactionIndex: parseInt(tx.transactionIndex, 10),
    timeStamp: parseInt(tx.timeStamp, 10),
    from: tx.from.toLowerCase(),
    to: tx.to.toLowerCase(),
    value: tx.value,
    isError: tx.isError === '1' ? '1' : '0',
    gasUsed: tx.gasUsed,
    ...(methodId !== undefined ? { methodId } : {}),
  };
}

function normalizeTokenTx(tx: EtherscanTokenTx, index: number): NormalizedTokenTx {
  return {
    txHash: tx.hash.toLowerCase(),
    blockNumber: parseInt(tx.blockNumber, 10),
    transactionIndex: parseInt(tx.transactionIndex ?? tx.transactionPosition ?? '0', 10),
    logIndex: parseInt(tx.logIndex ?? String(index), 10),
    timeStamp: parseInt(tx.timeStamp, 10),
    from: tx.from.toLowerCase(),
    to: tx.to.toLowerCase(),
    contractAddress: tx.contractAddress.toLowerCase(),
    tokenSymbol: tx.tokenSymbol,
    tokenName: tx.tokenName,
    tokenDecimal: parseInt(tx.tokenDecimal, 10),
    value: tx.value,
  };
}

async function callEtherscan<T>(
  url: URL,
  log: FastifyBaseLogger,
): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    throw new ExternalApiError('etherscan', { message: String(err), url: scrubUrl(url) });
  }

  if (!res.ok) {
    throw new ExternalApiError('etherscan', {
      status: res.status,
      statusText: res.statusText,
      url: scrubUrl(url),
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new ExternalApiError('etherscan', { message: 'Invalid JSON', url: scrubUrl(url) });
  }

  const data = json as EtherscanResponse<T>;
  if (data.status === '1') {
    return data.result;
  }
  if (data.status === '0' && data.message === 'No transactions found') {
    return [];
  }
  log.warn({ message: data.message, url: scrubUrl(url) }, 'etherscan: non-OK status');
  throw new ExternalApiError('etherscan', { message: data.message, url: scrubUrl(url) });
}

export interface EtherscanClientOptions {
  readonly apiKey: string;
  readonly log: FastifyBaseLogger;
}

export function createEtherscanClient(opts: EtherscanClientOptions): OnChainApiClient {
  const { apiKey, log } = opts;

  return {
    network: 'ETH',

    assertConfigured() {
      if (!apiKey) {
        throw new ApiKeyMissingError('ETHERSCAN_API_KEY');
      }
    },

    async fetchNormalTransactions(
      address: string,
      startBlock: number,
      endBlock: number,
    ): Promise<NormalizedTx[]> {
      const url = new URL(BASE_URL);
      url.searchParams.set('chainid', CHAIN_ID);
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'txlist');
      url.searchParams.set('address', address);
      url.searchParams.set('startblock', String(startBlock));
      url.searchParams.set('endblock', String(endBlock));
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('offset', '1000');
      url.searchParams.set('apikey', apiKey);

      const rows = await callEtherscan<EtherscanTx>(url, log);
      return rows.map((tx) => normalizeNormalTx(tx));
    },

    async fetchTokenTransactions(
      address: string,
      startBlock: number,
      endBlock: number,
    ): Promise<NormalizedTokenTx[]> {
      const url = new URL(BASE_URL);
      url.searchParams.set('chainid', CHAIN_ID);
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'tokentx');
      url.searchParams.set('address', address);
      url.searchParams.set('startblock', String(startBlock));
      url.searchParams.set('endblock', String(endBlock));
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('offset', '1000');
      url.searchParams.set('apikey', apiKey);

      const rows = await callEtherscan<EtherscanTokenTx>(url, log);
      return rows.map((tx, index) => normalizeTokenTx(tx, index));
    },
  };
}
