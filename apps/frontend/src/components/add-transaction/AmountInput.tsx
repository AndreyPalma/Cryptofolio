/**
 * AmountInput — decimal text input with sanitization and balance check.
 */
import type { TransactionType } from "../../types/token-detail";
import { isOutbound } from "../../lib/transaction-rules";

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  currentBalance: string | null;
  type: TransactionType;
  fieldError: string | null;
}

function sanitize(raw: string): string {
  // Remove non-numeric chars (keep digits and '.')
  let clean = raw.replace(/[^\d.]/g, "");
  // Allow only one decimal point
  const firstDot = clean.indexOf(".");
  if (firstDot !== -1) {
    clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, "");
  }
  return clean;
}

export function AmountInput({
  value,
  onChange,
  currentBalance,
  type,
  fieldError,
}: AmountInputProps) {
  const outbound = isOutbound(type);
  const parsedAmount = parseFloat(value);
  const parsedBalance = currentBalance !== null ? parseFloat(currentBalance) : null;

  const isOverBalance =
    outbound &&
    parsedBalance !== null &&
    !Number.isNaN(parsedAmount) &&
    parsedAmount > parsedBalance;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(sanitize(e.target.value));
  }

  return (
    <div>
      <label htmlFor="amount" className="mb-1 block text-sm text-gray-400">
        Amount
      </label>
      <input
        id="amount"
        type="text"
        inputMode="decimal"
        value={value}
        onChange={handleChange}
        placeholder="0.00"
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
      />
      {outbound && currentBalance !== null && (
        <p className="mt-1 text-xs text-gray-400">
          Balance: {currentBalance}
        </p>
      )}
      {isOverBalance && (
        <p className="mt-1 text-sm text-red-400" role="alert">
          Exceeds balance of {currentBalance} tokens
        </p>
      )}
      {fieldError !== null && !isOverBalance && (
        <p className="mt-1 text-sm text-red-400" role="alert">
          {fieldError}
        </p>
      )}
    </div>
  );
}
