import type { WalletBreakdown } from "../../types/token-detail";

interface WalletSelectorProps {
  wallets: WalletBreakdown[];
  selectedWalletId: string | undefined;
  onChange: (walletId: string | undefined) => void;
}

export function WalletSelector({ wallets, selectedWalletId, onChange }: WalletSelectorProps) {
  return (
    <select
      value={selectedWalletId ?? ""}
      onChange={(e) => {
        onChange(e.target.value || undefined);
      }}
      className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
    >
      <option value="">All Wallets</option>
      {wallets.map((w) => (
        <option key={w.walletId} value={w.walletId}>
          {w.label ?? `${w.walletId.slice(0, 6)}…`}
        </option>
      ))}
    </select>
  );
}
