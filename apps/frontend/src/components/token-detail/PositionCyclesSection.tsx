import { cn } from "../../lib/cn";
import { formatUsd } from "../../lib/format";
import type { ClosedCycle } from "../../hooks/useClosedPositions";
import type { DecimalString } from "../../types/portfolio";
import { PnlDisplay } from "../dashboard/PnlDisplay";
import { CycleBadge } from "./CycleBadge";

export interface ActiveCycleSummary {
  cycleNumber: number;
  openedAt: string | null;
  totalCostUsd: DecimalString;
  totalCurrentValueUsd: DecimalString | null;
  unrealizedPnlUsd: DecimalString | null;
  unrealizedPnlPct: DecimalString | null;
  walletLabel: string | null;
}

interface PositionCyclesSectionProps {
  activeCycle: ActiveCycleSummary | null;
  closedCycles: ClosedCycle[];
  loading: boolean;
  error: string | null;
}

interface CycleCardProps {
  cycleNumber: number;
  openedAt: string | null;
  closedAt: string | null;
  totalCostUsd: DecimalString;
  totalProceedsUsd: DecimalString | null;
  pnlUsd: DecimalString | null;
  pnlPct: DecimalString | null;
  walletLabel: string | null;
  statusLabel: string;
  proceedsLabel: string;
  pnlLabel: string;
  active?: boolean;
}

interface MetricProps {
  label: string;
  value: string;
}

function formatDateTime(value: string | null): string {
  if (value === null) {
    return "—";
  }

  return new Date(value).toLocaleString("es-CR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Metric({ label, value }: MetricProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-200">{value}</p>
    </div>
  );
}

function CycleCard({
  cycleNumber,
  openedAt,
  closedAt,
  totalCostUsd,
  totalProceedsUsd,
  pnlUsd,
  pnlPct,
  walletLabel,
  statusLabel,
  proceedsLabel,
  pnlLabel,
  active = false,
}: CycleCardProps) {
  return (
    <article
      className={cn(
        "rounded-lg border bg-gray-900 p-4",
        active ? "border-indigo-700/70" : "border-gray-800",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CycleBadge cycleNumber={cycleNumber} />
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
              active ? "bg-indigo-500/20 text-indigo-200" : "bg-gray-800 text-gray-300",
            )}
          >
            {statusLabel}
          </span>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-gray-500">{pnlLabel}</p>
          <div className="mt-1 flex items-center justify-end gap-3 text-sm">
            <PnlDisplay value={pnlUsd} kind="usd" />
            <PnlDisplay value={pnlPct} kind="pct" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Abierto" value={formatDateTime(openedAt)} />
        <Metric label="Cerrado" value={formatDateTime(closedAt)} />
        <Metric label="Costo total" value={formatUsd(totalCostUsd)} />
        <Metric label={proceedsLabel} value={formatUsd(totalProceedsUsd)} />
        {walletLabel !== null && <Metric label="Wallet" value={walletLabel} />}
      </div>
    </article>
  );
}

export function PositionCyclesSection({
  activeCycle,
  closedCycles,
  loading,
  error,
}: PositionCyclesSectionProps) {
  const hasContent = activeCycle !== null || closedCycles.length > 0;

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Ciclos de posición</h2>
          <p className="mt-1 text-sm text-gray-400">
            Histórico de aperturas, cierres y P&L por ciclo.
          </p>
        </div>
        <span className="rounded-full bg-gray-800 px-3 py-1 text-xs font-semibold text-gray-300">
          {closedCycles.length} ciclo{closedCycles.length !== 1 ? "s" : ""} cerrado
          {closedCycles.length !== 1 ? "s" : ""}
        </span>
      </div>

      {error !== null && (
        <div className="mt-4 rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      )}

      {loading && !hasContent ? (
        <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900 px-4 py-6 text-sm text-gray-400">
          Cargando ciclos…
        </div>
      ) : null}

      {!loading && !hasContent ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-800 bg-gray-900/30 px-4 py-8 text-center text-sm text-gray-400">
          Este token todavía no tiene ciclos para mostrar.
        </div>
      ) : null}

      {hasContent && (
        <div className="mt-4 space-y-4">
          {activeCycle !== null && (
            <CycleCard
              cycleNumber={activeCycle.cycleNumber}
              openedAt={activeCycle.openedAt}
              closedAt={null}
              totalCostUsd={activeCycle.totalCostUsd}
              totalProceedsUsd={activeCycle.totalCurrentValueUsd}
              pnlUsd={activeCycle.unrealizedPnlUsd}
              pnlPct={activeCycle.unrealizedPnlPct}
              walletLabel={activeCycle.walletLabel}
              statusLabel="En curso"
              proceedsLabel="Valor actual"
              pnlLabel="P&L no realizado"
              active
            />
          )}

          {closedCycles.map((cycle) => (
            <CycleCard
              key={`${String(cycle.cycleNumber)}-${cycle.walletId}`}
              cycleNumber={cycle.cycleNumber}
              openedAt={cycle.openedAt}
              closedAt={cycle.closedAt}
              totalCostUsd={cycle.totalCostUsd}
              totalProceedsUsd={cycle.totalProceedsUsd}
              pnlUsd={cycle.realizedPnlUsd}
              pnlPct={cycle.realizedPnlPct}
              walletLabel={cycle.walletLabel}
              statusLabel="Cerrado"
              proceedsLabel="Ingresos por venta"
              pnlLabel="P&L realizado"
            />
          ))}
        </div>
      )}
    </section>
  );
}
