/**
 * Utilities for token logo rendering:
 * - simpleHash: djb2-variant deterministic hash
 * - computeAvatarColor: stable color from an 8-color palette
 * - networkToChain: maps Network to Trust Wallet chain path segment
 */

// 8-color palette (indigo-500, violet-500, teal-500, rose-500,
// amber-500, cyan-500, emerald-500, orange-500) — excludes Binance yellow
const AVATAR_PALETTE = [
  "#6366F1", // indigo-500
  "#8B5CF6", // violet-500
  "#14B8A6", // teal-500
  "#F43F5E", // rose-500
  "#F59E0B", // amber-500
  "#06B6D4", // cyan-500
  "#10B981", // emerald-500
  "#F97316", // orange-500
] as const;

export function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function computeAvatarColor(symbol: string): string {
  const index = simpleHash(symbol) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index] ?? AVATAR_PALETTE[0];
}

export function networkToChain(network: "ETH" | "BSC"): "ethereum" | "smartchain" {
  switch (network) {
    case "ETH":
      return "ethereum";
    case "BSC":
      return "smartchain";
  }
}
