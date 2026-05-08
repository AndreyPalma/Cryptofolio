import { cn } from "../../lib/cn";
import type { CostSource, CostInheritedFrom } from "../../types/token-detail";

interface CostSourceBadgeProps {
  costSource: CostSource;
  costInheritedFrom: CostInheritedFrom;
}

export function CostSourceBadge({ costSource, costInheritedFrom }: CostSourceBadgeProps) {
  if (costSource === null || costSource === "MARKET") return null;

  if (costSource === "INHERITED") {
    const label =
      costInheritedFrom === "BINANCE"
        ? "Cost inherited (Binance)"
        : "Cost inherited (wallet)";
    return (
      <span
        className={cn(
          "rounded px-2 py-0.5 text-xs font-medium",
          "bg-green-900 text-green-300",
        )}
      >
        {label}
      </span>
    );
  }

  // MANUAL
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium",
        "bg-gray-700 text-gray-400",
      )}
    >
      Manual cost
    </span>
  );
}
