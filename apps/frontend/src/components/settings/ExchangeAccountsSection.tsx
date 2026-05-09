import { useSettingsWallets } from "../../hooks/settings/useSettingsWallets";
import { useSyncWallet } from "../../hooks/settings/useSyncWallet";
import { usePendingPriceTransfers } from "../../hooks/settings/usePendingPriceTransfers";
import { useRelativeTime } from "../../hooks/useRelativeTime";
import { SyncResultInline } from "./SyncResultInline";
import type { SettingsWallet } from "../../types/settings";

function CexWalletRow({ wallet, sync, syncState, onAfterSync }: {
  wallet: SettingsWallet;
  sync: (id: string, kind: "cex") => Promise<void>;
  syncState: { status: string; result?: unknown; message?: string };
  onAfterSync: () => void;
}) {
  const { label } = useRelativeTime(wallet.lastSyncedAt);
  const isSyncing = syncState.status === "syncing";

  const handleSync = async () => {
    await sync(wallet.id, "cex");
    onAfterSync();
  };

  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {wallet.label && (
              <span className="text-sm font-medium text-white">{wallet.label}</span>
            )}
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-900 text-green-300">
              Connected
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {wallet.lastSyncedAt !== null ? label : "Never synced"}
          </p>
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

      {syncState.status === "success" && (
        <SyncResultInline result={(syncState as { result: import("../../types/settings").SyncResultUnion }).result} />
      )}
      {syncState.status === "error" && (
        <p className="mt-2 text-xs text-red-400">{(syncState as { message: string }).message}</p>
      )}
    </div>
  );
}

export function ExchangeAccountsSection() {
  const { data, loading, error, refetch: walletsRefetch } = useSettingsWallets();
  const { states, sync } = useSyncWallet();
  const { refetch: pendingRefetch } = usePendingPriceTransfers();

  if (loading) {
    return (
      <div className="rounded-xl bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Exchange Accounts</h2>
        <div className="h-16 animate-pulse rounded-lg bg-gray-800" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="rounded-xl bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Exchange Accounts</h2>
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

  const cexWallets = (data ?? []).filter((w) => w.walletType === "CEX");

  return (
    <div className="rounded-xl bg-gray-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">Exchange Accounts</h2>
      {cexWallets.length === 0 ? (
        <div>
          <p className="text-sm text-gray-400">No Binance account configured. Add one in the wallets section.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cexWallets.map((wallet) => (
            <CexWalletRow
              key={wallet.id}
              wallet={wallet}
              sync={sync}
              syncState={states[wallet.id] ?? { status: "idle" }}
              onAfterSync={() => { void walletsRefetch(); void pendingRefetch(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
