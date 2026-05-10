import { useState, useEffect } from "react";
import type { SettingsToken, TokenNetwork } from "../../types/settings";
import { SourceBadge } from "../token-detail/SourceBadge";
import type { TransactionSource } from "../../types/token-detail";

function networkToSource(network: TokenNetwork): TransactionSource {
  switch (network) {
    case "ETH":
      return "ETHERSCAN";
    case "BSC":
      return "BSCTRACE";
    case "CEX_BINANCE":
      return "BINANCE";
  }
}

const PRICE_REGEX = /^\d+(\.\d+)?$/;

function isValidPrice(val: string): boolean {
  return val === "" || PRICE_REGEX.test(val);
}

interface TokenRowProps {
  token: SettingsToken;
  onUpdate: (patch: Partial<Pick<SettingsToken, "isHidden" | "targetExitPrice">>) => Promise<void>;
}

export function TokenRow({ token, onUpdate }: TokenRowProps) {
  const [draftTargetPrice, setDraftTargetPrice] = useState<string>(
    token.targetExitPrice ?? "",
  );
  const [savingHidden, setSavingHidden] = useState(false);
  const [savingTarget, setSavingTarget] = useState(false);

  // Re-sync draft when prop changes (e.g. after successful save)
  useEffect(() => {
    setDraftTargetPrice(token.targetExitPrice ?? "");
  }, [token.targetExitPrice]);

  const isDirty = draftTargetPrice !== (token.targetExitPrice ?? "");
  const isPriceValid = isValidPrice(draftTargetPrice);

  const handleToggleHidden = async () => {
    setSavingHidden(true);
    try {
      await onUpdate({ isHidden: !token.isHidden });
    } finally {
      setSavingHidden(false);
    }
  };

  const handleSavePrice = async () => {
    setSavingTarget(true);
    try {
      await onUpdate({
        targetExitPrice: draftTargetPrice === "" ? null : draftTargetPrice,
      });
    } finally {
      setSavingTarget(false);
    }
  };

  const handleCancelPrice = () => {
    setDraftTargetPrice(token.targetExitPrice ?? "");
  };

  return (
    <tr className="border-t border-gray-800">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white text-sm">{token.symbol}</span>
          {token.name && (
            <span className="text-xs text-gray-400">{token.name}</span>
          )}
        </div>
      </td>
      <td className="py-3 pr-4">
        <SourceBadge source={networkToSource(token.network)} />
      </td>
      <td className="py-3 pr-4">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={token.isHidden}
            disabled={savingHidden}
            onChange={handleToggleHidden}
            className="h-4 w-4 accent-indigo-600 cursor-pointer disabled:cursor-not-allowed"
          />
          <span className="text-xs text-gray-400">Hidden</span>
        </label>
      </td>
      <td className="py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draftTargetPrice}
            onChange={(e) => { setDraftTargetPrice(e.target.value); }}
            placeholder="—"
            className="w-24 rounded bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {isDirty && (
            <>
              <button
                type="button"
                onClick={handleSavePrice}
                disabled={!isPriceValid || savingTarget}
                className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancelPrice}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
