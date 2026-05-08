import { cn } from "../../lib/cn";

interface SummaryCardProps {
  label: string;
  value: string;
  pnlSign?: "positive" | "negative" | "neutral";
  testId?: string;
}

export function SummaryCard({ label, value, pnlSign, testId }: SummaryCardProps) {
  const colorClass = cn({
    "text-pnl-positive": pnlSign === "positive",
    "text-pnl-negative": pnlSign === "negative",
    "text-white": pnlSign === "neutral" || pnlSign === undefined,
  });

  return (
    <article className="rounded-lg bg-gray-900 p-4" data-testid={testId}>
      <span className="block text-sm text-gray-400">{label}</span>
      <span className={cn("block text-2xl font-semibold", colorClass)}>
        {value}
      </span>
    </article>
  );
}
