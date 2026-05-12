import type { NormalizedTx, NormalizedTokenTx } from "../../src/sync/clients/on-chain-api.js";

export function makeNormalizedTx(overrides?: Partial<NormalizedTx>): NormalizedTx {
  return {
    txHash: "0xdeadbeef",
    blockNumber: 100,
    transactionIndex: 0,
    timeStamp: 1744720496,
    from: "0xabc123abc123abc123abc123abc123abc123abcd",
    to: "0xdef456def456def456def456def456def456def4",
    value: "1000000000000000000",
    isError: "0",
    gasUsed: "0",
    methodId: undefined,
    ...overrides,
  };
}

export function makeNormalizedTokenTx(overrides?: Partial<NormalizedTokenTx>): NormalizedTokenTx {
  return {
    txHash: "0xdeadbeef",
    blockNumber: 100,
    transactionIndex: 0,
    logIndex: 0,
    timeStamp: 1744720496,
    from: "0xabc123abc123abc123abc123abc123abc123abcd",
    to: "0xdef456def456def456def456def456def456def4",
    contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    tokenSymbol: "USDC",
    tokenName: "USDC",
    tokenDecimal: 6,
    value: "1000000",
    ...overrides,
  };
}
