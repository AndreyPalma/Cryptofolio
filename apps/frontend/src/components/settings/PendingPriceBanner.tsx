import { Link } from "react-router-dom";
import { usePendingPriceTransfers } from "../../hooks/settings/usePendingPriceTransfers";

export function PendingPriceBanner() {
  const { data, error } = usePendingPriceTransfers();

  if (data === null || error !== null || data.count === 0) {
    return null;
  }

  const first = data.transactions[0] ?? null;
  const hasContractAddress =
    first !== null &&
    first.contractAddress !== null &&
    first.contractAddress !== undefined;

  return (
    <div className="mb-6 rounded-xl border border-yellow-700 bg-yellow-900/30 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-yellow-200">
          ⚠ {data.count} TRANSFER_IN transactions need a price. Set prices to complete your P&amp;L.
        </p>
        {hasContractAddress ? (
          <Link
            to={`/token/${first.contractAddress}/${first.tokenNetwork}`}
            className="shrink-0 rounded bg-yellow-700 px-3 py-1 text-xs font-medium text-yellow-100 hover:bg-yellow-600"
          >
            Review pending →
          </Link>
        ) : (
          <Link
            to="/transactions/new"
            className="shrink-0 rounded bg-yellow-700 px-3 py-1 text-xs font-medium text-yellow-100 hover:bg-yellow-600"
          >
            Review pending →
          </Link>
        )}
      </div>
    </div>
  );
}
