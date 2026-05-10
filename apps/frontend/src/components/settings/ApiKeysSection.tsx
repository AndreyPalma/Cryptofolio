import { useApiKeysStatus } from "../../hooks/settings/useApiKeysStatus";
import { useTestApiKey } from "../../hooks/settings/useTestApiKey";
import type { ApiKeyTestState } from "../../types/settings";
import { cn } from "../../lib/cn";

interface ApiKeyRowProps {
  label: string;
  isConfigured: boolean;
  testState: ApiKeyTestState;
  onTest: () => void;
  testDisabled?: boolean;
  isGrouped?: boolean;
}

function TestResultBadge({ state }: { state: ApiKeyTestState }) {
  if (state.status === "idle") return null;
  if (state.status === "testing") {
    return <span className="text-xs text-gray-400">Testing…</span>;
  }
  if (state.status === "connected") {
    const parts: string[] = ["Connected"];
    if (state.meta?.latencyMs !== undefined) parts.push(`${String(state.meta.latencyMs)}ms`);
    if (state.meta?.assetCount !== undefined) parts.push(`${String(state.meta.assetCount)} assets`);
    return (
      <span className="text-xs text-green-400">{parts.join(" · ")}</span>
    );
  }
  // failed
  return (
    <span className="text-xs text-red-400">Failed: {state.reason}</span>
  );
}

function ApiKeyRow({ label, isConfigured, testState, onTest, testDisabled, isGrouped }: ApiKeyRowProps) {
  const isTesting = testState.status === "testing";

  return (
    <div className={cn("flex items-center gap-3 py-3", !isGrouped && "border-t border-gray-800")}>
      <div className="w-48 shrink-0">
        <span className="text-sm font-mono text-gray-300">{label}</span>
      </div>
      <div className="flex-1">
        <input
          type="password"
          readOnly
          value=""
          placeholder={isConfigured ? "Configured in .env ✓" : "Not configured"}
          className={cn(
            "w-full rounded bg-gray-800 px-3 py-1.5 text-sm placeholder-opacity-100 focus:outline-none",
            isConfigured ? "placeholder-green-500" : "placeholder-gray-500",
          )}
        />
        <span className="sr-only">{isConfigured ? "Configured" : "Not configured"}</span>
      </div>
      {!isGrouped && (
        <button
          type="button"
          disabled={(testDisabled ?? !isConfigured) || isTesting}
          onClick={onTest}
          className="w-20 rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isTesting ? "Testing…" : "Test"}
        </button>
      )}
      <div className="w-40">
        <TestResultBadge state={testState} />
      </div>
    </div>
  );
}

export function ApiKeysSection() {
  const { data: presence, loading } = useApiKeysStatus();
  const { states, test } = useTestApiKey();

  if (loading || presence === null) {
    return (
      <div className="rounded-xl bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">API Keys</h2>
        <div className="h-24 animate-pulse rounded-lg bg-gray-800" />
      </div>
    );
  }

  const hasBinance = presence.BINANCE_API_KEY && presence.BINANCE_SECRET_KEY;

  return (
    <div className="rounded-xl bg-gray-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">API Keys</h2>
      <p className="mb-4 text-xs text-gray-500">
        API keys are configured via environment variables on the server. Values are never exposed here.
      </p>

      <div>
        <ApiKeyRow
          label="ETHERSCAN_API_KEY"
          isConfigured={presence.ETHERSCAN_API_KEY}
          testState={states.etherscan}
          onTest={() => void test("etherscan")}
          testDisabled={!presence.ETHERSCAN_API_KEY}
        />
        <ApiKeyRow
          label="BSCTRACE_API_KEY"
          isConfigured={presence.BSCTRACE_API_KEY}
          testState={states.bsctrace}
          onTest={() => void test("bsctrace")}
          testDisabled={!presence.BSCTRACE_API_KEY}
        />

        {/* Binance group — API key + Secret share one Test button */}
        <div className="border-t border-gray-800">
          <div className="flex items-center gap-3 py-3">
            <div className="w-48 shrink-0">
              <span className="text-sm font-mono text-gray-300">BINANCE_API_KEY</span>
            </div>
            <div className="flex-1">
              <input
                type="password"
                readOnly
                value=""
                placeholder={presence.BINANCE_API_KEY ? "Configured in .env ✓" : "Not configured"}
                className={cn(
                  "w-full rounded bg-gray-800 px-3 py-1.5 text-sm placeholder-opacity-100 focus:outline-none",
                  presence.BINANCE_API_KEY ? "placeholder-green-500" : "placeholder-gray-500",
                )}
              />
              <span className="sr-only">{presence.BINANCE_API_KEY ? "Configured" : "Not configured"}</span>
            </div>
            <button
              type="button"
              disabled={!hasBinance || states.binance.status === "testing"}
              onClick={() => void test("binance")}
              className="w-28 rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {states.binance.status === "testing" ? "Testing…" : "Test Binance"}
            </button>
            <div className="w-40">
              <TestResultBadge state={states.binance} />
            </div>
          </div>
          <div className="flex items-center gap-3 pb-3">
            <div className="w-48 shrink-0">
              <span className="text-sm font-mono text-gray-300">BINANCE_SECRET_KEY</span>
            </div>
            <div className="flex-1">
              <input
                type="password"
                readOnly
                value=""
                placeholder={presence.BINANCE_SECRET_KEY ? "Configured in .env ✓" : "Not configured"}
                className={cn(
                  "w-full rounded bg-gray-800 px-3 py-1.5 text-sm placeholder-opacity-100 focus:outline-none",
                  presence.BINANCE_SECRET_KEY ? "placeholder-green-500" : "placeholder-gray-500",
                )}
              />
              <span className="sr-only">{presence.BINANCE_SECRET_KEY ? "Configured" : "Not configured"}</span>
            </div>
            {/* No individual test button — grouped with BINANCE_API_KEY above */}
            <div className="w-28" />
            <div className="w-40" />
          </div>
        </div>
      </div>
    </div>
  );
}
