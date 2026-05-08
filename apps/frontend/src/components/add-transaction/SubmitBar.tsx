/**
 * SubmitBar — submit button with inline error region.
 */
interface SubmitBarProps {
  submitting: boolean;
  disabled: boolean;
  errorMessage: string | null;
}

export function SubmitBar({ submitting, disabled, errorMessage }: SubmitBarProps) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={disabled || submitting}
        className="w-full rounded-lg bg-indigo-600 py-2 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save Transaction"}
      </button>
      {errorMessage !== null && (
        <p role="alert" className="text-sm text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
