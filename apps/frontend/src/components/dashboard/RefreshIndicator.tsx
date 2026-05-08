import { cn } from "../../lib/cn";

interface RefreshIndicatorProps {
  relativeTime: string;
  isRefetching: boolean;
  stale: boolean;
  onRetry: () => void;
}

export function RefreshIndicator({
  relativeTime,
  isRefetching,
  stale,
  onRetry,
}: RefreshIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          stale ? "bg-pnl-negative" : "bg-pnl-positive",
          isRefetching && "animate-pulse",
        )}
      />
      <span>{relativeTime}</span>
      {stale && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 text-xs text-indigo-400 hover:text-indigo-300"
          aria-label="Retry loading portfolio"
        >
          [Retry]
        </button>
      )}
    </div>
  );
}
