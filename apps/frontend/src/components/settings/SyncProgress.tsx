import { cn } from '../../lib/cn';
import type { StepState, SyncStreamStatus } from '../../types/settings';

interface SyncProgressProps {
  steps: StepState[];
  status: SyncStreamStatus;
  error: { code: string; message: string } | null;
  summary: Record<string, unknown> | null;
  onCancel: () => void;
  onRetry: () => void;
  batchProgress: { done: number; total: number } | null;
}

function StepIcon({ status }: { status: StepState['status'] }) {
  switch (status) {
    case 'pending':
      return <span className="inline-block h-4 w-4 rounded-full bg-gray-600" />;
    case 'running':
      return (
        <span className="inline-block h-4 w-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
      );
    case 'done':
      return (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[10px] text-white">
          ✓
        </span>
      );
    case 'skipped':
      return (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-500 text-[10px] text-white">
          –
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white">
          ✗
        </span>
      );
  }
}

function StepRow({
  step,
  batchProgress,
}: {
  step: StepState;
  batchProgress: { done: number; total: number } | null;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <StepIcon status={step.status} />
      <span
        className={cn(
          'text-sm',
          step.status === 'pending' && 'text-gray-500',
          step.status === 'running' && 'text-indigo-300',
          step.status === 'done' && 'text-green-300',
          step.status === 'skipped' && 'text-gray-400',
          step.status === 'error' && 'text-red-400',
        )}
      >
        {step.label}
      </span>
      {step.status === 'done' && step.synced !== undefined && (
        <span className="text-xs text-gray-400">
          {step.synced} synced{step.skipped ? `, ${String(step.skipped)} skipped` : ''}
        </span>
      )}
      {step.name === 'persist' && step.status === 'running' && batchProgress && (
        <span className="text-xs text-indigo-300">
          {batchProgress.done} / {batchProgress.total} txs
        </span>
      )}
      {step.status === 'skipped' && step.reason && (
        <span className="text-xs text-gray-500">{step.reason}</span>
      )}
      {step.status === 'error' && step.errorMessage && (
        <span className="text-xs text-red-400">{step.errorMessage}</span>
      )}
    </div>
  );
}

export function SyncProgress({ steps, status, error, summary, onCancel, onRetry, batchProgress }: SyncProgressProps) {
  return (
    <div className="mt-3 rounded-lg bg-gray-700/50 p-3">
      <div className="space-y-0.5">
        {steps.map((step) => (
          <StepRow key={step.name} step={step} batchProgress={batchProgress} />
        ))}
      </div>

      {status === 'done' && summary && (
        <div className="mt-2 rounded bg-gray-600/50 px-3 py-2">
          <p className="text-xs text-green-300">
            {(
              Number(summary.fiat ?? 0) +
              Number((summary.deposits as Record<string, unknown> | undefined)?.synced ?? 0) +
              Number((summary.withdrawals as Record<string, unknown> | undefined)?.synced ?? 0) +
              Number((summary.converts as Record<string, unknown> | undefined)?.synced ?? 0) +
              Number((summary.trades as Record<string, unknown> | undefined)?.synced ?? 0)
            )}{' '}
            transacciones sincronizadas
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-400">
          {error.message}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {(status === 'syncing' || status === 'connecting') && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-gray-600 px-3 py-1 text-xs text-gray-200 hover:bg-gray-500"
          >
            Cancel
          </button>
        )}
        {(status === 'error' || status === 'cancelled') && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
