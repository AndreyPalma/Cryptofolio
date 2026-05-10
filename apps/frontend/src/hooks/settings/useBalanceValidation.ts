import { useState, useEffect, useRef } from "react";
import { apiClient } from "../../lib/api-client";
import { useApiKeysStatus } from "./useApiKeysStatus";
import { useSettingsWallets } from "./useSettingsWallets";
import type { BalanceValidationData, BalanceDifference } from "../../types/settings";

const COOLDOWN_SECONDS = 60;

interface BalanceValidationApiResponse {
  differences: {
    asset: string;
    engineBalance: string;
    snapshotBalance: string;
    diff: string;
  }[];
  totalEngineUsd: string;
  totalSnapshotUsd: string;
  takenAt: string;
  dustNote: string;
}

function toBalanceValidationData(raw: BalanceValidationApiResponse): BalanceValidationData {
  const differences: BalanceDifference[] = raw.differences.map((d) => ({
    asset: d.asset,
    engineBalance: d.engineBalance,
    snapshotBalance: d.snapshotBalance,
    diff: d.diff,
  }));
  return {
    differences,
    totalEngineUsd: raw.totalEngineUsd,
    totalSnapshotUsd: raw.totalSnapshotUsd,
    takenAt: new Date(raw.takenAt),
    dustNote: raw.dustNote,
  };
}

export interface UseBalanceValidationResult {
  state: "idle" | "loading" | "success" | "error";
  data: BalanceValidationData | null;
  error: Error | null;
  validate: () => Promise<void>;
  cooldownSecondsRemaining: number;
  disabledReason: "no-wallet" | "no-keys" | null;
}

export function useBalanceValidation(): UseBalanceValidationResult {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [data, setData] = useState<BalanceValidationData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [cooldownSecondsRemaining, setCooldownSecondsRemaining] = useState<number>(0);
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: presence } = useApiKeysStatus();
  const { data: wallets } = useSettingsWallets();

  const hasBinanceWallet = (wallets ?? []).some((w) => w.network === "CEX_BINANCE");
  const hasBinanceKeys =
    presence?.BINANCE_API_KEY === true && presence?.BINANCE_SECRET_KEY;
  const disabledReason: "no-wallet" | "no-keys" | null = !hasBinanceWallet
    ? "no-wallet"
    : !hasBinanceKeys
      ? "no-keys"
      : null;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cooldownIntervalRef.current !== null) {
        clearInterval(cooldownIntervalRef.current);
      }
    };
  }, []);

  const validate = async (): Promise<void> => {
    // Don't validate during active cooldown — caller should check before calling
    setState("loading");
    setError(null);

    try {
      const raw = await apiClient.get<BalanceValidationApiResponse>(
        "/api/portfolio/validate-snapshot",
      );
      setData(toBalanceValidationData(raw));
      setState("success");

      // Start cooldown
      setCooldownSecondsRemaining(COOLDOWN_SECONDS);

      if (cooldownIntervalRef.current !== null) {
        clearInterval(cooldownIntervalRef.current);
      }

      cooldownIntervalRef.current = setInterval(() => {
        setCooldownSecondsRemaining((prev) => {
          if (prev <= 1) {
            if (cooldownIntervalRef.current !== null) {
              clearInterval(cooldownIntervalRef.current);
              cooldownIntervalRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return { state, data, error, validate, cooldownSecondsRemaining, disabledReason };
}
