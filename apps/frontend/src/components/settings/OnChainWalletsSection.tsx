import { useState, useRef } from "react";
import { useSettingsWallets } from "../../hooks/settings/useSettingsWallets";
import { useSyncStream } from "../../hooks/settings/useSyncStream";
import { usePendingPriceTransfers } from "../../hooks/settings/usePendingPriceTransfers";
import { useRelativeTime } from "../../hooks/useRelativeTime";
import { useWalletMutations } from "../../hooks/settings/useWalletMutations";
import { SyncProgress } from "./SyncProgress";
import type { SettingsWallet } from "../../types/settings";

function truncateAddress(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function CopyButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => { setCopied(false); }, 2000);
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

function WalletRow({
  wallet,
  onSyncComplete,
  onDelete,
  isDeleting,
}: {
  wallet: SettingsWallet;
  onSyncComplete: () => void;
  onDelete: (id: string) => Promise<void>;
  isDeleting: boolean;
}) {
  const { steps, status, error, summary, start, cancel, retry, batchProgress } = useSyncStream(
    wallet.id,
    'ON_CHAIN',
  );
  const { refetch: pendingRefetch } = usePendingPriceTransfers();
  const isBusy = status === 'syncing' || status === 'connecting';
  const showProgress = status !== 'idle';

  const handleSync = () => {
    start();
  };

  // Refresh wallet list when sync completes
  const prevStatus = useRef(status);
  if (prevStatus.current === 'syncing' && status === 'done') {
    onSyncComplete();
    void pendingRefetch();
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

function AddWalletForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const { addWallet, adding, addError, clearAddError } = useWalletMutations();
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState<"ETH" | "BSC">("ETH");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAddError();
    try {
      await addWallet({
        wallet_type: "ON_CHAIN",
        address: address.trim(),
        network,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      onSuccess();
    } catch {
      // error shown via addError
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="rounded-lg bg-gray-800 p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Label (optional)</label>
          <input
            type="text"
            value={label}
            onChange={(e) => { setLabel(e.target.value); }}
            placeholder="My ETH wallet"
            className="w-full rounded bg-gray-700 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Network</label>
          <select
            value={network}
            onChange={(e) => { setNetwork(e.target.value as "ETH" | "BSC"); }}
            className="w-full rounded bg-gray-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="ETH">Ethereum (ETH)</option>
            <option value="BSC">BNB Chain (BSC)</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => { setAddress(e.target.value); }}
          placeholder="0x..."
          required
          className="w-full rounded bg-gray-700 px-3 py-1.5 font-mono text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
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
          disabled={adding || !address.trim()}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? "Adding..." : "Add Wallet"}
        </button>
      </div>
    </form>
  );
}

export function OnChainWalletsSection() {
  const { data, loading, error, refetch: walletsRefetch } = useSettingsWallets();
  const { deleteWallet, deleting } = useWalletMutations();
  const [showForm, setShowForm] = useState(false);

  const handleDelete = async (id: string) => {
    await deleteWallet(id);
    void walletsRefetch();
  };

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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">On-Chain Wallets</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => { setShowForm(true); }}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            + Add Wallet
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-3">
          <AddWalletForm
            onSuccess={() => { setShowForm(false); void walletsRefetch(); }}
            onCancel={() => { setShowForm(false); }}
          />
        </div>
      )}

      {onChainWallets.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400">No on-chain wallets registered.</p>
      ) : (
        <div className="space-y-3">
          {onChainWallets.map((wallet) => (
            <WalletRow
              key={wallet.id}
              wallet={wallet}
              onSyncComplete={() => void walletsRefetch()}
              onDelete={handleDelete}
              isDeleting={deleting === wallet.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
