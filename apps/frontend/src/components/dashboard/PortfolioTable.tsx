import { PortfolioRow } from "./PortfolioRow";
import { PortfolioTableEmptyState } from "./PortfolioTableEmptyState";
import type { PortfolioItem } from "../../types/portfolio";

interface PortfolioTableProps {
  items: PortfolioItem[];
}

export function PortfolioTable({ items }: PortfolioTableProps) {
  const visibleItems = items.filter(
    (item) => parseFloat(item.totalBalance) !== 0,
  );

  if (visibleItems.length === 0) {
    return <PortfolioTableEmptyState />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-white">
        <thead>
          <tr className="border-b border-gray-800 text-xs text-gray-400">
            {/* Expand toggle */}
            <th scope="col" className="w-8 px-2 py-3" />
            {/* Logo */}
            <th scope="col" className="px-2 py-3" />
            <th scope="col" className="px-4 py-3">
              Symbol
            </th>
            <th scope="col" className="px-4 py-3">
              Network / Source
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Balance Total
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Current Price
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Current Value
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              WAC
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Cost Basis
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              P&L ($)
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              P&L (%)
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((item) => (
            <PortfolioRow
              key={`${item.network}-${item.contractAddress ?? item.symbol}`}
              item={item}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
