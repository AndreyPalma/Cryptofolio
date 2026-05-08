/**
 * WalletSourceSelect — dropdown grouped by wallet type (On-Chain / CEX).
 */
import type { WalletEntry } from "../../types/token-detail";

interface WalletSourceSelectProps {
  wallets: WalletEntry[];
  selectedWalletId: string;
  onChange: (walletId: string) => void;
  disabled?: boolean;
}

export function WalletSourceSelect({
  wallets,
  selectedWalletId,
  onChange,
  disabled = false,
}: WalletSourceSelectProps) {
  const onChainWallets = wallets.filter((w) => w.walletType === "ON_CHAIN");
  const cexWallets = wallets.filter((w) => w.walletType === "CEX");

  return (
    <div>
      <label htmlFor="wallet-source" className="mb-1 block text-sm text-gray-400">
        Wallet / Source
      </label>
      <select
        id="wallet-source"
        value={selectedWalletId}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">Select wallet…</option>
        {onChainWallets.length > 0 && (
          <optgroup label="On-Chain">
            {onChainWallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label ?? w.id}
              </option>
            ))}
          </optgroup>
        )}
        {cexWallets.length > 0 && (
          <optgroup label="CEX">
            {cexWallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label ?? "Binance Account"}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
