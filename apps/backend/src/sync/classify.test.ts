import { describe, it, expect } from "vitest";
import { classifyAndDecomposeTransaction, groupByTxHash } from "./classify.js";
import { makeNormalizedTx, makeNormalizedTokenTx } from "../../tests/helpers/factories.js";
import type { NormalizedTx, NormalizedTokenTx } from "./clients/on-chain-api.js";

describe("classify.ts regression under source=ALCHEMY", () => {
  const wallet = "0xabc123abc123abc123abc123abc123abc123abcd";

  it("B-1: ETH swap via Uniswap V2 Router decomposes into SWAP_OUT + SWAP_IN with mutual relatedTxId", () => {
    const normalTx: NormalizedTx = makeNormalizedTx({
      txHash: "0xswap001",
      blockNumber: 100,
      transactionIndex: 0,
      to: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
      from: wallet,
      value: "1000000000000000000",
    });
    const tokenTxs: NormalizedTokenTx[] = [
      makeNormalizedTokenTx({
        txHash: "0xswap001",
        blockNumber: 100,
        transactionIndex: 0,
        logIndex: 0,
        from: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
        to: wallet,
        contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        tokenSymbol: "USDC",
        tokenDecimal: 6,
        value: "2000000",
      }),
    ];
    const groups = groupByTxHash([normalTx], tokenTxs);
    const decomposed = classifyAndDecomposeTransaction(groups[0]!, wallet, "ETH", "ALCHEMY");
    expect(decomposed).toHaveLength(2);
    const [outLeg, inLeg] = decomposed;
    expect(outLeg?.type).toBe("SWAP_OUT");
    expect(inLeg?.type).toBe("SWAP_IN");
    expect(outLeg?.txLogIndex).toBe(0);
    expect(inLeg?.txLogIndex).toBe(1);
    expect(outLeg?.relatedTxId).toBe(inLeg?.id);
    expect(inLeg?.relatedTxId).toBe(outLeg?.id);
    expect(outLeg?.source).toBe("ALCHEMY");
    expect(inLeg?.source).toBe("ALCHEMY");
  });

  it("B-2: BSC swap via PancakeSwap Router decomposes into SWAP_OUT + SWAP_IN", () => {
    const normalTx: NormalizedTx = makeNormalizedTx({
      txHash: "0xbscswap001",
      blockNumber: 100,
      transactionIndex: 0,
      to: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
      from: wallet,
      value: "1000000000000000000",
    });
    const tokenTxs: NormalizedTokenTx[] = [
      makeNormalizedTokenTx({
        txHash: "0xbscswap001",
        blockNumber: 100,
        transactionIndex: 0,
        logIndex: 0,
        from: "0x10ed43c718714eb63d5aa57b78b54704e256024e",
        to: wallet,
        contractAddress: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        tokenSymbol: "USDC",
        tokenDecimal: 6,
        value: "2000000",
      }),
    ];
    const groups = groupByTxHash([normalTx], tokenTxs);
    const decomposed = classifyAndDecomposeTransaction(groups[0]!, wallet, "BSC", "ALCHEMY");
    expect(decomposed).toHaveLength(2);
    expect(decomposed[0]?.type).toBe("SWAP_OUT");
    expect(decomposed[1]?.type).toBe("SWAP_IN");
  });

  it("B-3: internal tx from contract to wallet is classified as TRANSFER_IN with tokenSymbol=ETH", () => {
    const normalTx: NormalizedTx = makeNormalizedTx({
      txHash: "0xinternal001",
      blockNumber: 100,
      transactionIndex: 0,
      from: "0xcontract1111111111111111111111111111111111",
      to: wallet,
      value: "500000000000000000",
      methodId: undefined,
    });
    const groups = groupByTxHash([normalTx], []);
    const decomposed = classifyAndDecomposeTransaction(groups[0]!, wallet, "ETH", "ALCHEMY");
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0]?.type).toBe("TRANSFER_IN");
    expect(decomposed[0]?.tokenContract).toBeNull();
    expect(decomposed[0]?.tokenSymbol).toBe("ETH");
    expect(decomposed[0]?.source).toBe("ALCHEMY");
  });

  it("B-4: normalTx with undefined methodId and non-router to is not a swap", () => {
    const normalTx: NormalizedTx = makeNormalizedTx({
      txHash: "0xnormal001",
      blockNumber: 100,
      transactionIndex: 0,
      from: "0xsomeone",
      to: wallet,
      value: "1000000000000000000",
      methodId: undefined,
    });
    const groups = groupByTxHash([normalTx], []);
    const decomposed = classifyAndDecomposeTransaction(groups[0]!, wallet, "ETH", "ALCHEMY");
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0]?.type).toBe("TRANSFER_IN");
  });
});
