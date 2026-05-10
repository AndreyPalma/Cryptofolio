import { useState } from "react";
import { cn } from "../../lib/cn";
import { toChecksumAddress } from "../../lib/checksum-address";
import { computeAvatarColor } from "../../lib/token-logo-utils";
import type { Network, SourceType } from "../../types/portfolio";

interface TokenLogoProps {
  symbol: string;
  contractAddress: string | null;
  network: Network;
  sourceType?: SourceType;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES = {
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-10 h-10",
} as const;

export function trustWalletUrl(
  network: Network,
  address: string,
): string | null {
  const checksumAddr = toChecksumAddress(address);
  switch (network) {
    case "ETH":
      return `https://assets.trustwalletapp.com/blockchains/ethereum/assets/${checksumAddr}/logo.png`;
    case "BSC":
      return `https://assets.trustwalletapp.com/blockchains/smartchain/assets/${checksumAddr}/logo.png`;
    case "CEX_BINANCE":
      return null;
    default: {
      const _exhaustive: never = network;
      return _exhaustive;
    }
  }
}

export function TokenLogo({
  symbol,
  contractAddress,
  network,
  size = "md",
}: TokenLogoProps) {
  const [useFallback, setUseFallback] = useState(false);

  const sizeClass = SIZE_CLASSES[size];

  // Determine whether to show CDN image or letter avatar
  const showCdnImage =
    !useFallback &&
    network !== "CEX_BINANCE" &&
    contractAddress !== null;

  const letter = (symbol[0] ?? "?").toUpperCase();
  const bgColor = computeAvatarColor(symbol);

  if (showCdnImage) {
    const url = trustWalletUrl(network, contractAddress);
    if (url !== null) {
      return (
        <div
          className={cn(
            "inline-flex items-center justify-center overflow-hidden rounded-full",
            sizeClass,
          )}
        >
          <img
            src={url}
            alt={symbol}
            className="h-full w-full object-contain"
            onError={() => {
              setUseFallback(true);
            }}
          />
        </div>
      );
    }
  }

  // Letter avatar
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-full",
        sizeClass,
      )}
      style={{ backgroundColor: bgColor }}
    >
      <span className="text-xs font-semibold text-white">{letter}</span>
    </div>
  );
}
