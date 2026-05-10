import type { Network } from "../types/portfolio";

export function getTokenRouteParam(
  contractAddress: string | null,
  symbol: string,
): string {
  return (contractAddress ?? symbol.toLowerCase()).toLowerCase();
}

export function getTokenIdentityKey(
  network: Network,
  contractAddress: string | null,
  symbol: string,
): string {
  return `${network}:${getTokenRouteParam(contractAddress, symbol)}`;
}

export function getTokenDetailPath(
  contractAddress: string | null,
  symbol: string,
  network: Network,
): string {
  return `/token/${getTokenRouteParam(contractAddress, symbol)}/${network}`;
}
