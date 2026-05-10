/**
 * PriceUsdInput — decimal text input for price with dynamic label.
 */
import type { TransactionType } from "../../types/token-detail";
import { isPriceRequired } from "../../lib/transaction-rules";

interface PriceUsdInputProps {
  value: string;
  onChange: (value: string) => void;
  type: TransactionType;
  fieldError: string | null;
}

export function PriceUsdInput({ value, onChange, type, fieldError }: PriceUsdInputProps) {
  const required = isPriceRequired(type);
  const labelSuffix = required ? "*" : "(optional)";

  return (
    <div>
      <label htmlFor="price-usd" className="mb-1 block text-sm text-gray-400">
        Price USD {labelSuffix}
      </label>
      <input
        id="price-usd"
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        placeholder="0.00"
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
      />
      {fieldError !== null && (
        <p className="mt-1 text-sm text-red-400" role="alert">
          {fieldError}
        </p>
      )}
    </div>
  );
}
