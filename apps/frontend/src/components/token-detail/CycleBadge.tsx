interface CycleBadgeProps {
  cycleNumber: number | undefined;
}

export function CycleBadge({ cycleNumber }: CycleBadgeProps) {
  return (
    <span className="rounded bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-300">
      CYCLE #{cycleNumber ?? "—"}
    </span>
  );
}
