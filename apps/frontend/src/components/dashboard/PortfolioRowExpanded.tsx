import { PnlDisplay } from "./PnlDisplay";
import { formatCrypto, formatUsd } from "../../lib/format";
import type { PortfolioItem, WalletBreakdown } from "../../types/portfolio";

interface PortfolioRowExpandedProps {
  item: PortfolioItem;
}

function truncateWalletId(walletId: string): string {
  return walletId.slice(0, 6) + "…" + walletId.slice(-4);
}

interface SubRowProps {
  label: string;
  entry: WalletBreakdown;
  item: PortfolioItem;
}

function SubRow({ label, entry, item }: SubRowProps) {
  const balance = parseFloat(entry.balance);
  const wac = parseFloat(entry.wac);
  const pricePresent =
    item.currentPrice !== null && item.priceUnavailable !== true;

  let pnlUsd: number | null = null;
  let pnlPct: number | null = null;
  if (pricePresent && item.currentPrice !== null) {
    const price = parseFloat(item.currentPrice);
    pnlUsd = (price - wac) * balance;
    pnlPct = wac > 0 ? ((price - wac) / wac) * 100 : null;
  }

  return (
    <tr className="bg-gray-950/50">
      <td className="px-4 py-2 text-sm text-gray-300">{label}</td>
      <td className="px-4 py-2 text-sm">{formatCrypto(entry.balance)}</td>
      <td className="px-4 py-2 text-sm">{formatCrypto(entry.wac)}</td>
      <td className="px-4 py-2 text-sm">
        {formatUsd(String(parseFloat(entry.balance) * parseFloat(entry.wac)))}
      </td>
      <td className="px-4 py-2 text-sm">
        <PnlDisplay value={pnlUsd} kind="usd" />
      </td>
      <td className="px-4 py-2 text-sm">
        <PnlDisplay value={pnlPct} kind="pct" />
      </td>
    </tr>
  );
}

export function PortfolioRowExpanded({ item }: PortfolioRowExpandedProps) {
  if (item.sourceType === "CEX") {
    const entry = item.walletBreakdown[0];
    if (!entry) {
      return (
        <tr>
          <td colSpan={11} />
        </tr>
      );
    }
    return (
      <tr>
        <td colSpan={11} className="p-0">
          <table className="w-full">
            <tbody>
              <SubRow label="Binance Account" entry={entry} item={item} />
            </tbody>
          </table>
        </td>
      </tr>
    );
  }

  // ON_CHAIN: one sub-row per wallet entry
  return (
    <tr>
      <td colSpan={11} className="p-0">
        <table className="w-full">
          <tbody>
            {item.walletBreakdown.map((entry) => {
              const label =
                entry.label && entry.label.trim() !== ""
                  ? entry.label
                  : truncateWalletId(entry.walletId);
              return (
                <SubRow
                  key={entry.walletId}
                  label={label}
                  entry={entry}
                  item={item}
                />
              );
            })}
          </tbody>
        </table>
      </td>
    </tr>
  );
}
