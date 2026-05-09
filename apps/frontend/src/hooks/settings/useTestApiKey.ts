import { useState } from "react";
import { apiClient } from "../../lib/api-client";
import type { ApiService, ApiKeyTestState } from "../../types/settings";
import { API_SERVICES } from "../../types/settings";

const TIMEOUT_MS = 10_000;

type TestStates = Record<ApiService, ApiKeyTestState>;

const initialStates: TestStates = {
  etherscan: { status: "idle" },
  bsctrace: { status: "idle" },
  binance: { status: "idle" },
};

export interface UseTestApiKeyResult {
  states: TestStates;
  test: (service: ApiService) => Promise<void>;
}

export function useTestApiKey(): UseTestApiKeyResult {
  const [states, setStates] = useState<TestStates>(initialStates);

  const test = async (service: ApiService): Promise<void> => {
    setStates((prev) => ({
      ...prev,
      [service]: { status: "testing" },
    }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    try {
      const result = await apiClient.post<{
        status: "connected" | "failed";
        meta?: { assetCount?: number; latencyMs?: number };
        reason?: string;
      }>(`/api/credentials/test/${service}`, undefined, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (result.status === "connected") {
        setStates((prev) => ({
          ...prev,
          [service]: { status: "connected", meta: result.meta },
        }));
      } else {
        setStates((prev) => ({
          ...prev,
          [service]: { status: "failed", reason: result.reason ?? "Unknown error" },
        }));
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const isAbort =
        e instanceof DOMException && e.name === "AbortError";
      setStates((prev) => ({
        ...prev,
        [service]: {
          status: "failed",
          reason: isAbort ? "Request timed out" : (e instanceof Error ? e.message : String(e)),
        },
      }));
    }
  };

  return { states, test };
}

// Verify all services are covered in initial state
const _check: Record<ApiService, unknown> = initialStates;
void _check;
void API_SERVICES;
