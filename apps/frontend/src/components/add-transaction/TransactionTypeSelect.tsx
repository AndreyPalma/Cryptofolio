/**
 * TransactionTypeSelect — 6-option dropdown with swap nudge note.
 */
import type { TransactionType } from "../../types/token-detail";

interface TransactionTypeSelectProps {
  value: TransactionType;
  onChange: (type: TransactionType) => void;
}

const TRANSACTION_TYPES: Array<{ value: TransactionType; label: string }> = [
  { value: "BUY", label: "BUY" },
  { value: "SELL", label: "SELL" },
  { value: "SWAP_IN", label: "SWAP_IN" },
  { value: "SWAP_OUT", label: "SWAP_OUT" },
  { value: "TRANSFER_IN", label: "TRANSFER_IN" },
  { value: "TRANSFER_OUT", label: "TRANSFER_OUT" },
];

export function TransactionTypeSelect({ value, onChange }: TransactionTypeSelectProps) {
  const showSwapNote = value === "SWAP_IN" || value === "SWAP_OUT";

  return (
    <div>
      <label htmlFor="tx-type" className="mb-1 block text-sm text-gray-400">
        Type
      </label>
      <select
        id="tx-type"
        value={value}
        onChange={(e) => onChange(e.target.value as TransactionType)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
      >
        {TRANSACTION_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      {showSwapNote && (
        <p className="mt-1 text-sm text-gray-400">
          Swaps usually come in pairs (OUT + IN). To record a full swap, submit both sides separately.
        </p>
      )}
    </div>
  );
}
