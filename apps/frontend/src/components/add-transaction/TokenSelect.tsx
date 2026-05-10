/**
 * TokenSelect — dropdown for tokens filtered by wallet network.
 */
import type { Token } from "../../hooks/useTokensByWallet";

interface TokenSelectProps {
  tokens: Token[] | null; // null = loading
  selectedTokenId: string;
  onChange: (tokenId: string) => void;
  disabled?: boolean;
}

export function TokenSelect({
  tokens,
  selectedTokenId,
  onChange,
  disabled = false,
}: TokenSelectProps) {
  const isLoading = tokens === null;
  const isEmpty = tokens !== null && tokens.length === 0;

  return (
    <div>
      <label htmlFor="token-select" className="mb-1 block text-sm text-gray-400">
        Token
      </label>
      <select
        id="token-select"
        value={selectedTokenId}
        onChange={(e) => { onChange(e.target.value); }}
        disabled={isLoading || disabled}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      >
        {isLoading ? (
          <option value="">Loading tokens…</option>
        ) : isEmpty ? (
          <option value="">No tokens available</option>
        ) : (
          <>
            <option value="">Select token…</option>
            {tokens.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name ? `${t.symbol} — ${t.name}` : t.symbol}
              </option>
            ))}
          </>
        )}
      </select>
    </div>
  );
}
