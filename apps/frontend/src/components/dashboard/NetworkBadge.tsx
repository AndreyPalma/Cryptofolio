import { cn } from "../../lib/cn";
import type { Network, SourceType } from "../../types/portfolio";

interface NetworkBadgeProps {
  network: Network;
  sourceType?: SourceType;
}

export function NetworkBadge({ network }: NetworkBadgeProps) {
  const isBinance = network === "CEX_BINANCE";

  const label = (() => {
    switch (network) {
      case "ETH":
        return "Ethereum";
      case "BSC":
        return "BSC";
      case "CEX_BINANCE":
        return "Binance";
    }
  })();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        isBinance ? "bg-binance text-black" : "bg-gray-700 text-gray-100",
      )}
    >
      {label}
    </span>
  );
}
