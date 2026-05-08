import { useState, useEffect } from "react";

export interface UseRelativeTimeResult {
  secondsSinceUpdate: number | null;
  label: string;
}

function computeLabel(seconds: number): string {
  if (seconds < 60) {
    return `Updated ${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `Updated ${Math.floor(seconds / 60)}m ago`;
  }
  return "Updated 1h+ ago";
}

export function useRelativeTime(date: Date | null): UseRelativeTimeResult {
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (date === null) {
      setSecondsSinceUpdate(null);
      return;
    }

    const tick = () => {
      const elapsed = Math.floor((Date.now() - date.getTime()) / 1000);
      setSecondsSinceUpdate(elapsed);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
    };
  }, [date]);

  if (date === null) {
    return { secondsSinceUpdate: null, label: "Never updated" };
  }

  const label =
    secondsSinceUpdate === null ? "Never updated" : computeLabel(secondsSinceUpdate);

  return { secondsSinceUpdate, label };
}
