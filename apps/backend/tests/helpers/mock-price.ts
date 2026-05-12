import type { PriceService } from "../../src/services/price.js";

export function createMockPriceService(
  prices: Record<string, { readonly priceUsd: string } | { readonly priceUnavailable: true }>,
): PriceService {
  return {
    async getHistoricalPrice(network, address, timestampSec) {
      await Promise.resolve();
      const key = `${network}:${address.toLowerCase()}:${String(timestampSec)}`;
      return prices[key] ?? { priceUnavailable: true };
    },
    async getOnChainPrice() {
      await Promise.resolve();
      return { priceUnavailable: true };
    },
    async getCexPrice() {
      await Promise.resolve();
      return { priceUnavailable: true };
    },
    async getOnChainPricesBulk() {
      await Promise.resolve();
      return new Map();
    },
    async getFiatToUsdAt() {
      await Promise.resolve();
      return null;
    },
    __resetCacheForTests() {
      // noop
    },
  };
}
