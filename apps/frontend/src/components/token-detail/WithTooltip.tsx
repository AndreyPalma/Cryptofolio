import { cn } from "../../lib/cn";

interface WithTooltipProps {
  children: React.ReactNode;
  text: string | null;
}

export function WithTooltip({ children, text }: WithTooltipProps) {
  if (!text) return <>{children}</>;
  return (
    <span className="group relative inline-block">
      {children}
      <span
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2",
          "w-max max-w-xs rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 shadow-lg",
          "opacity-0 transition-opacity group-hover:opacity-100",
        )}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
