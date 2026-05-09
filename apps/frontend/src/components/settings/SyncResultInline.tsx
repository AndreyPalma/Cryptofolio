import type { SyncResultUnion } from "../../types/settings";

interface SyncResultInlineProps {
  result: SyncResultUnion;
}

export function SyncResultInline({ result }: SyncResultInlineProps) {
  if (result.kind === "on-chain") {
    return (
      <div className="mt-2 rounded bg-gray-800 px-3 py-2 text-xs text-gray-300">
        <span className="font-medium text-green-400">Synced {result.synced} txs</span>
        {" · "}
        <span>{result.skipped} skipped</span>
        {" · "}
        <span>{result.swapsDecomposed} swaps</span>
        {result.transfersPendingCost > 0 && (
          <span className="ml-2 text-yellow-400">
            · {result.transfersPendingCost} pending price
          </span>
        )}
      </div>
    );
  }

  // kind === 'cex'
  return (
    <div className="mt-2 space-y-1 rounded bg-gray-800 px-3 py-2 text-xs text-gray-300">
      <div>
        <span className="font-medium">Trades:</span>{" "}
        {result.trades.synced} synced | {result.trades.skipped} skipped |{" "}
        {result.trades.symbolsProcessed} symbols
      </div>
      <div>
        <span className="font-medium">Converts:</span>{" "}
        {result.converts.synced} synced | {result.converts.skipped} skipped
      </div>
      <div>
        <span className="font-medium">Withdrawals:</span>{" "}
        {result.withdrawals.synced} synced | {result.withdrawals.skipped} skipped
      </div>
      <div>
        <span className="font-medium">Deposits:</span>{" "}
        {result.deposits.synced} synced | {result.deposits.skipped} skipped
        {result.deposits.inherited > 0 && ` (${result.deposits.inherited} inherited)`}
        {result.deposits.manual > 0 && ` (${result.deposits.manual} manual)`}
      </div>
      {result.tokensCreated > 0 && (
        <div>
          <span className="font-medium">Tokens created:</span> {result.tokensCreated}
        </div>
      )}
    </div>
  );
}
