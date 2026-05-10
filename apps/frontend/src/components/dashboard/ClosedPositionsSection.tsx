import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn";
import { formatUsd } from "../../lib/format";
import { getTokenDetailPath } from "../../lib/token-path";
import {
  type ClosedPositionsResponse,
  type ClosedTokenGroup,
} from "../../hooks/useClosedPositions";
import { NetworkBadge } from "./NetworkBadge";
import { PnlDisplay } from "./PnlDisplay";

interface ClosedTokensListProps {
  tokens: ClosedTokenGroup[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  showClosedBadge?: boolean;
}

interface ClosedPositionsSectionProps {
  data: ClosedPositionsResponse | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

function getPnlTone(value: string): "positive" | "negative" | "neutral" {
  const numericValue = parseFloat(value);

  if (numericValue > 0) {
    return "positive";
  }

  if (numericValue < 0) {
    return "negative";
  }

  return "neutral";
}

function ClosedBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-300">
      Cerrado
    </span>
  );
}

export function ClosedTokensList({
  tokens,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = "Aún no cerraste ninguna posición",
  showClosedBadge = false,
}: ClosedTokensListProps) {
  const navigate = useNavigate();

  if (loading && tokens.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-6 text-sm text-gray-400">
        Cargando posiciones cerradas…
      </div>
    );
  }

  if (error !== null && tokens.length === 0) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-4 text-sm text-red-200">
        <p>No se pudieron cargar las posiciones cerradas.</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-md bg-red-900/60 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-800 bg-gray-900/40 px-4 py-8 text-center text-sm text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error !== null && tokens.length > 0 && (
        <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          Mostrando datos previos. Error al actualizar: {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/40">
        <div className="divide-y divide-gray-800">
          {tokens.map((token) => {
            const detailPath = getTokenDetailPath(
              token.contractAddress,
              token.symbol,
              token.network,
            );

            return (
              <button
                key={`${token.network}-${token.contractAddress ?? token.symbol}`}
                type="button"
                onClick={() => {
                  void navigate(detailPath);
                }}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-800/70"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {token.symbol}
                    </span>
                    <NetworkBadge network={token.network} />
                    {showClosedBadge && <ClosedBadge />}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    {token.cycleCount} ciclo
                    {token.cycleCount !== 1 ? "s" : ""} cerrado
                    {token.cycleCount !== 1 ? "s" : ""}
                  </p>
                </div>

                <div className="text-right">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">
                    P&L total
                  </span>
                  <PnlDisplay value={token.totalRealizedPnlUsd} kind="usd" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ClosedPositionsSection({
  data,
  loading,
  error,
  onRetry,
}: ClosedPositionsSectionProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setIsOpen(true);
    }
  }, []);

  const totalRealizedPnlUsd = data?.totalRealizedPnlUsd ?? "0";
  const totalClosedCycles = data?.totalClosedCycles ?? 0;
  const pnlTone = getPnlTone(totalRealizedPnlUsd);
  const pnlValue = formatUsd(totalRealizedPnlUsd);
  const formattedPnlValue =
    parseFloat(totalRealizedPnlUsd) > 0 ? `+${pnlValue}` : pnlValue;

  return (
    <section className="mt-8 border-t border-gray-800 pt-8">
      <button
        type="button"
        onClick={() => {
          setIsOpen((currentValue) => !currentValue);
        }}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <div>
          <h2 className="text-xl font-semibold text-white">
            Posiciones Cerradas — Histórico
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Revisá el desempeño realizado por token sin mezclarlo con el portfolio activo.
          </p>
        </div>

        <span className="inline-flex items-center gap-2 text-sm text-gray-400">
          {isOpen ? "Ocultar" : "Mostrar"}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className={cn(
              "h-4 w-4 transition-transform",
              isOpen && "rotate-180",
            )}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 7.5 10 12.5 15 7.5"
            />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,320px)_1fr]">
          <article className="rounded-lg bg-gray-900 p-5">
            <span className="block text-sm text-gray-400">
              P&L Realizado Total
            </span>
            <span
              className={cn(
                "mt-2 block text-3xl font-semibold",
                pnlTone === "positive" && "text-pnl-positive",
                pnlTone === "negative" && "text-pnl-negative",
                pnlTone === "neutral" && "text-gray-200",
              )}
            >
              {formattedPnlValue}
            </span>
            <p className="mt-2 text-sm text-gray-400">
              {totalClosedCycles} posiciones cerradas
            </p>
          </article>

          <div>
            <ClosedTokensList
              tokens={data?.byToken ?? []}
              loading={loading}
              error={error}
              onRetry={onRetry}
            />
          </div>
        </div>
      )}
    </section>
  );
}
