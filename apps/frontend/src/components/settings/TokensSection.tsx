import { useState } from "react";
import { useSettingsTokens } from "../../hooks/settings/useSettingsTokens";
import { TokenRow } from "./TokenRow";

export function TokensSection() {
  const { data, loading, error, refetch, updateToken } = useSettingsTokens();
  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  if (loading) {
    return (
      <div className="rounded-xl bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Tokens</h2>
        <div className="h-16 animate-pulse rounded-lg bg-gray-800" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-xl bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Tokens</h2>
        <p className="text-sm text-red-400">Error loading tokens.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
        >
          Retry
        </button>
      </div>
    );
  }

  const tokens = data ?? [];
  const filtered = tokens.filter((t) => {
    if (!showHidden && t.isHidden) return false;
    if (search.trim() !== "" && !t.symbol.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="rounded-xl bg-gray-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">Tokens</h2>

      <div className="mb-4 flex items-center gap-4">
        <input
          type="text"
          placeholder="Search by symbol…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); }}
          className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="button"
          data-testid="show-hidden-toggle"
          onClick={() => { setShowHidden((v) => !v); }}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            showHidden
              ? "bg-indigo-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {showHidden ? "Showing hidden" : "Show hidden"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400">No tokens found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="pb-2 pr-4">Token</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2 pr-4">Hidden</th>
                <th className="pb-2">Target Exit Price</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  onUpdate={(patch) => updateToken(token.id, patch)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
