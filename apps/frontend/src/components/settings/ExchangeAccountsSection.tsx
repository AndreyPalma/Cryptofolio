import { useState, useRef } from "react";
import { useSettingsWallets } from "../../hooks/settings/useSettingsWallets";
import { usePendingPriceTransfers } from "../../hooks/settings/usePendingPriceTransfers";
import { useRelativeTime } from "../../hooks/useRelativeTime";
import { useWalletMutations } from "../../hooks/settings/useWalletMutations";
import { useSyncStream } from "../../hooks/settings/useSyncStream";
import { SyncProgress } from "./SyncProgress";
import type { SettingsWallet } from "../../types/settings";

function CexWalletRow({
  wallet,
  onAfterSync,
  onDelete,
  isDeleting,
}: {
  wallet: SettingsWallet;
  onAfterSync: () => void;
  onDelete: (id: string) => Promise<void>;
  isDeleting: boolean;
}) {
  const { label } = useRelativeTime(wallet.lastSyncedAt);
  const { steps, status, error, summary, start, cancel, retry, batchProgress } = useSyncStream(wallet.id, 'CEX');
  const isBusy = status === 'syncing' || status === 'connecting';
  const showProgress = status !== 'idle';

  const handleSync = () => {
    start();
  };

  // Refresh wallet list when sync completes
  const prevStatus = useRef(status);
  if (prevStatus.current === 'syncing' && status === 'done') {
    onAfterSync();
  }
  prevStatus.current = status;

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
          disabled={isBusy}
          onClick={handleSync}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isBusy ? "Syncing..." : "Sync"}
        </button>
        <button
          type="button"
          disabled={isDeleting || isBusy}
          onClick={() => void onDelete(wallet.id)}
          className="rounded bg-red-800 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      {showProgress && (
        <SyncProgress
          steps={steps}
          status={status}
          error={error}
          summary={summary}
          onCancel={cancel}
          onRetry={retry}
          batchProgress={batchProgress}
        />
      )}
    </div>
  );
}

function AddBinanceForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { addWallet, adding, addError, clearAddError } = useWalletMutations();
  const [label, setLabel] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAddError();
    try {
      await addWallet({
        wallet_type: "CEX",
        network: "CEX_BINANCE",
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      onSuccess();
    } catch {
      // error shown via addError
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-lg bg-gray-800 p-4 space-y-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Label (optional)</label>
        <input
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); }}
          placeholder="My Binance"
          className="w-full rounded bg-gray-700 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <p className="text-xs text-gray-500">
        Binance credentials are read from the API keys configured in .env. Only one Binance account is supported.
      </p>
      {addError && <p className="text-xs text-red-400">{addError}</p>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={adding}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? "Adding..." : "Add Binance Account"}
        </button>
      </div>
    </form>
  );
}

export function ExchangeAccountsSection() {
  const { data, loading, error, refetch: walletsRefetch } = useSettingsWallets();
  const { refetch: pendingRefetch } = usePendingPriceTransfers();
  const { deleteWallet, deleting } = useWalletMutations();
  const [showForm, setShowForm] = useState(false);

  const handleDelete = async (id: string) => {
    await deleteWallet(id);
    void walletsRefetch();
  };

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
  const hasCex = cexWallets.length > 0;

  return (
    <div className="rounded-xl bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Exchange Accounts</h2>
        {!showForm && !hasCex && (
          <button
            type="button"
            onClick={() => { setShowForm(true); }}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            + Add Binance
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-3">
          <AddBinanceForm
            onSuccess={() => { setShowForm(false); void walletsRefetch(); }}
            onCancel={() => { setShowForm(false); }}
          />
        </div>
      )}

      {cexWallets.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400">No Binance account configured.</p>
      ) : (
        <div className="space-y-3">
          {cexWallets.map((wallet) => (
            <CexWalletRow
              key={wallet.id}
              wallet={wallet}
              onAfterSync={() => { void walletsRefetch(); void pendingRefetch(); }}
              onDelete={handleDelete}
              isDeleting={deleting === wallet.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
