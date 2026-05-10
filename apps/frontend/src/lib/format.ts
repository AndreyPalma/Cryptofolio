/**
 * Format helpers for display values.
 * All functions accept DecimalString | number | null and return a formatted string.
 * Returns "—" for null, undefined, or NaN inputs.
 */
import type { DecimalString } from "../types/portfolio";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: DecimalString | number | null): string {
  if (value === null) return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  return usdFormatter.format(n);
}

export function formatPct(value: DecimalString | number | null): string {
  if (value === null) return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatCrypto(value: DecimalString | number | null): string {
  if (value === null) return "—";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  // 8 significant figures, no scientific notation, drop trailing zeros
  const str = n.toPrecision(8);
  // Convert scientific notation to fixed if needed
  if (str.includes("e") || str.includes("E")) {
    // Use toFixed with enough decimals to avoid scientific notation
    const fixed = n.toFixed(20).replace(/\.?0+$/, "");
    return fixed;
  }
  return Number.parseFloat(str).toString();
}
