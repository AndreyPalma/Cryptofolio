/**
 * WacPreview — read-only WAC + balance preview panel.
 * Renders nothing when inputs are invalid.
 */
import type { TransactionType } from "../../types/token-detail";
import type { DecimalString } from "../../types/portfolio";
import { useWacPreview } from "../../hooks/useWacPreview";
import { formatUsd, formatCrypto } from "../../lib/format";

interface WacPreviewProps {
  currentBalance: DecimalString | null;
  currentWac: DecimalString | null;
  type: TransactionType;
  amount: string;
  priceUsd: string;
}

export function WacPreview({
  currentBalance,
  currentWac,
  type,
  amount,
  priceUsd,
}: WacPreviewProps) {
  const preview = useWacPreview(currentBalance, currentWac, type, amount, priceUsd);

  if (!preview.visible) return null;

  return (
    <div className="rounded-lg bg-gray-800 p-3 text-sm">
      <p className="text-gray-200">
        <span className="text-gray-400">New balance:</span>{" "}
        {formatCrypto(preview.newBalance)}
      </p>
      <p className="text-gray-200">
        <span className="text-gray-400">New WAC:</span>{" "}
        {formatUsd(preview.newWac)}
      </p>
      <p className="text-gray-200">
        <span className="text-gray-400">New cost basis:</span>{" "}
        {formatUsd(preview.newCostBasis)}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        Estimated — final value computed on submit.
      </p>
    </div>
  );
}
