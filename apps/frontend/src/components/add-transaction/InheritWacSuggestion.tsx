/**
 * InheritWacSuggestion — panel offering WAC inheritance for TRANSFER_IN.
 */
import type { DecimalString } from "../../types/portfolio";

interface Candidate {
  walletId: string;
  label: string;
  wac: DecimalString;
}

interface InheritWacSuggestionProps {
  candidate: Candidate | null;
  loading: boolean;
  onUse: (wac: DecimalString) => void;
}

export function InheritWacSuggestion({
  candidate,
  loading,
  onUse,
}: InheritWacSuggestionProps) {
  if (loading && candidate === null) {
    return (
      <div className="rounded-lg bg-gray-800 p-3 text-sm text-gray-400">
        Looking for WAC inheritance candidates…
      </div>
    );
  }

  if (candidate === null) return null;

  return (
    <div className="rounded-lg border border-indigo-600 bg-gray-800 p-3 text-sm">
      <p className="text-gray-200">
        Inherit WAC{" "}
        <span className="font-mono text-indigo-400">${candidate.wac}</span>{" "}
        from &apos;{candidate.label}&apos;?
      </p>
      <button
        type="button"
        onClick={() => { onUse(candidate.wac); }}
        className="mt-2 rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
      >
        Use this
      </button>
    </div>
  );
}
