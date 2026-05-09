import { useState } from "react";
import { useBalanceValidation } from "../../hooks/settings/useBalanceValidation";
import { cn } from "../../lib/cn";

export function BalanceValidationSection() {
  const [isOpen, setIsOpen] = useState(false);

  const { state, data, error, validate, cooldownSecondsRemaining, disabledReason } = useBalanceValidation();
  const canValidate = disabledReason === null;

  const isLoading = state === "loading";
  const isInCooldown = cooldownSecondsRemaining > 0;

  return (
    <div className="rounded-xl bg-gray-900 p-6">
      <button
        type="button"
        data-testid="bv-toggle"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="text-lg font-semibold text-white">Balance Validation</h2>
        <span className="text-gray-400 text-sm">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="mt-4">
          {/* Idle or success (but no cooldown) — show validate button */}
          {(state === "idle" || (state === "success" && !isInCooldown)) && (
            <button
              type="button"
              disabled={!canValidate || isLoading}
              onClick={() => void validate()}
              title={
                disabledReason === "no-wallet"
                  ? "Add a Binance wallet to enable"
                  : disabledReason === "no-keys"
                    ? "Configure BINANCE_API_KEY and BINANCE_SECRET_KEY in .env to enable"
                    : undefined
              }
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state === "success" ? "Validate again" : "Validate vs Binance Snapshot"}
            </button>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              <span className="text-sm text-gray-400">Fetching snapshot…</span>
            </div>
          )}

          {/* Success + cooldown */}
          {state === "success" && isInCooldown && (
            <button
              type="button"
              disabled
              className="rounded bg-gray-700 px-4 py-2 text-sm font-medium text-gray-400 cursor-not-allowed"
            >
              Available in {cooldownSecondsRemaining}s
            </button>
          )}

          {/* Results table */}
          {state === "success" && data !== null && (
            <div className="mt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="pb-2 pr-4 text-left">Asset</th>
                      <th className="pb-2 pr-4 text-right">Engine</th>
                      <th className="pb-2 pr-4 text-right">Snapshot</th>
                      <th className="pb-2 text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.differences.map((d) => {
                      const diffNum = parseFloat(d.diff);
                      const isLarge = Math.abs(diffNum) > 1;
                      return (
                        <tr key={d.asset} className="border-t border-gray-800">
                          <td className="py-2 pr-4 font-medium text-white">{d.asset}</td>
                          <td className="py-2 pr-4 text-right text-gray-300">{d.engineBalance}</td>
                          <td className="py-2 pr-4 text-right text-gray-300">{d.snapshotBalance}</td>
                          <td
                            className={cn(
                              "py-2 text-right",
                              isLarge ? "text-red-400" : "text-gray-500",
                            )}
                          >
                            {d.diff}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-gray-500">{data.dustNote}</p>
            </div>
          )}

          {/* Error */}
          {state === "error" && error !== null && (
            <div className="mt-2">
              <p className="text-sm text-red-400">{error.message}</p>
              <button
                type="button"
                onClick={() => void validate()}
                className="mt-2 rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
