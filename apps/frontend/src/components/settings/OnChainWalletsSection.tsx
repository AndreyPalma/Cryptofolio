import { useState } from "react";
import { useSettingsWallets } from "../../hooks/settings/useSettingsWallets";
import { useSyncWallet } from "../../hooks/settings/useSyncWallet";
import { usePendingPriceTransfers } from "../../hooks/settings/usePendingPriceTransfers";
import { useRelativeTime } from "../../hooks/useRelativeTime";
import { SyncResultInline } from "./SyncResultInline";
import type { SettingsWallet } from "../../types/settings";

function truncateAddress(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function CopyButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      data-testid="copy-btn"
      onClick={handleCopy}
      className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-600"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function LastSyncedCell({ date }: { date: Date | null }) {
  const { label } = useRelativeTime(date);
  if (date === null) {
    return <span className="text-xs text-gray-500">Never synced</span>;
  }
  return <span className="text-xs text-gray-400">{label}</span>;
}

function WalletRow({ wallet, onSyncComplete }: { wallet: SettingsWallet; onSyncComplete: () => void }) {
  const { states, sync } = useSyncWallet();
  const { refetch: pendingRefetch } = usePendingPriceTransfers();
  const state = states[wallet.id] ?? { status: "idle" };
  const isSyncing = state.status === "syncing";

  const handleSync = async () => {
    await sync(wallet.id, "on-chain");
    onSyncComplete();
    pendingRefetch();
  };

  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {wallet.label && (
              <span className="text-sm font-medium text-white">{wallet.label}</span>
            )}
            <span className="font-mono text-xs text-gray-400">
              {wallet.address ? truncateAddress(wallet.address) : "—"}
            </span>
            {wallet.address && <CopyButton address={wallet.address} />}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-gray-700 text-gray-100">
              {wallet.network}
            </span>
            <LastSyncedCell date={wallet.lastSyncedAt} />
          </div>
        </div>
        <button
          type="button"
          disabled={isSyncing}
          onClick={handleSync}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSyncing ? "Syncing..." : "Sync"}
        </button>
      </div>

      {state.status === "success" && (
        <SyncResultInline result={state.result} />
      )}
      {state.status === "error" && (
        <p className="mt-2 text-xs text-red-400">{state.message}</p>
      )}
    </div>
  );
}

export function OnChainWalletsSection() {
  const { data, loading, error, refetch: walletsRefetch } = useSettingsWallets();

  if (loading) {
    return (
      <div className="rounded-xl bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">On-Chain Wallets</h2>
        <div className="h-16 animate-pulse rounded-lg bg-gray-800" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-xl bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">On-Chain Wallets</h2>
        <p className="text-sm text-red-400">Error loading wallets.</p>
        <button
          type="button"
          onClick={() => void walletsRefetch()}
          className="mt-2 rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500"
        >
          Retry
        </button>
      </div>
    );
  }

  const onChainWallets = (data ?? []).filter((w) => w.walletType === "ON_CHAIN");

  return (
    <div className="rounded-xl bg-gray-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">On-Chain Wallets</h2>
      {onChainWallets.length === 0 ? (
        <p className="text-sm text-gray-400">No on-chain wallets registered.</p>
      ) : (
        <div className="space-y-3">
          {onChainWallets.map((wallet) => (
            <WalletRow
              key={wallet.id}
              wallet={wallet}
              onSyncComplete={() => void walletsRefetch()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
