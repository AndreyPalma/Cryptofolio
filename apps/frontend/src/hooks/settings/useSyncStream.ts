import { useState, useRef, useCallback, useEffect } from 'react';
import type { StepState, SyncStepName, SyncStreamStatus, WalletType } from '../../types/settings';
import { SYNC_STEPS_CEX, SYNC_STEPS_ON_CHAIN } from '../../types/settings';

const STEP_LABELS: Record<SyncStepName, string> = {
  // CEX steps
  fiat: 'Fiat Orders',
  deposits: 'Deposits',
  withdrawals: 'Withdrawals',
  converts: 'Converts',
  trades: 'Trades',
  // On-chain steps
  fetch_normal: 'Obteniendo txs normales',
  fetch_tokens: 'Obteniendo token txs',
  classify: 'Clasificando',
  persist: 'Persistiendo',
};

function initialSteps(walletType: WalletType): StepState[] {
  const names: readonly SyncStepName[] =
    walletType === 'ON_CHAIN' ? SYNC_STEPS_ON_CHAIN : SYNC_STEPS_CEX;
  return names.map((name) => ({
    name,
    label: STEP_LABELS[name],
    status: 'pending' as const,
  }));
}

export interface UseSyncStreamResult {
  steps: StepState[];
  status: SyncStreamStatus;
  error: { code: string; message: string } | null;
  summary: Record<string, unknown> | null;
  batchProgress: { done: number; total: number } | null;
  start: () => void;
  cancel: () => void;
  retry: () => void;
}

export function useSyncStream(walletId: string, walletType: WalletType): UseSyncStreamResult {
  const [steps, setSteps] = useState<StepState[]>(() => initialSteps(walletType));
  const [status, setStatus] = useState<SyncStreamStatus>('idle');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // FIX W-001: Cleanup on unmount to prevent EventSource leak
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    close();
    setSteps(initialSteps(walletType));
    setBatchProgress(null);
    setStatus('connecting');
    setError(null);
    setSummary(null);

    const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
    const es = new EventSource(`${baseUrl}/api/sync/${walletId}/stream`, {
      withCredentials: true,
    });
    esRef.current = es;

    es.onopen = () => {
      setStatus('syncing');
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;

        if (data.type === 'batchProgress') {
          setBatchProgress({ done: data.done as number, total: data.total as number });
          return;
        }

        const step = data.step as string;
        const stepStatus = data.status as string;

        if (step === 'complete') {
          setStatus('done');
          setSummary((data.summary as Record<string, unknown> | undefined) ?? null);
          close();
          return;
        }

        if (step === 'error') {
          setStatus('error');
          setError({
            code: (data.code as string | undefined) ?? 'UNKNOWN',
            message: (data.message as string | undefined) ?? 'Sync failed',
          });
          close();
          return;
        }

        setSteps((prev) =>
          prev.map((s) => {
            if (s.name !== step) return s;
            if (stepStatus === 'running') {
              return { ...s, status: 'running' };
            }
            if (stepStatus === 'done') {
              return {
                ...s,
                status: 'done',
                synced: (data.synced as number | undefined) ?? 0,
                skipped: (data.skipped as number | undefined) ?? 0,
              };
            }
            if (stepStatus === 'skipped') {
              return {
                ...s,
                status: 'skipped',
                reason:
                  (data.message as string | undefined) ??
                  (data.reason as string | undefined) ??
                  'Skipped',
              };
            }
            return s;
          }),
        );

        if (step === 'persist' && stepStatus === 'done') {
          setBatchProgress(null);
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setStatus((current) => {
        if (current === 'syncing' || current === 'connecting') {
          setError({ code: 'CONNECTION_ERROR', message: 'Lost connection to server' });
          return 'error';
        }
        return current;
      });
      esRef.current?.close();
      esRef.current = null;
    };
  }, [walletId, walletType, close]);

  const cancel = useCallback(() => {
    close();
    setStatus('cancelled');
  }, [close]);

  const retry = useCallback(() => {
    start();
  }, [start]);

  return { steps, status, error, summary, batchProgress, start, cancel, retry };
}
