/**
 * useWacPreview — pure synchronous hook. No useEffect, no state.
 * Computes new WAC + new balance given current position and form inputs.
 */
import type { TransactionType } from "../types/token-detail";
import type { DecimalString } from "../types/portfolio";
import { isOutbound } from "../lib/transaction-rules";

type PreviewResult =
  | { visible: false }
  | { visible: true; newBalance: number; newWac: number; newCostBasis: number };

export function useWacPreview(
  currentBalance: DecimalString | null,
  currentWac: DecimalString | null,
  type: TransactionType,
  amountStr: string,
  priceStr: string,
): PreviewResult {
  const a = parseFloat(amountStr);
  const cb = currentBalance === null ? 0 : parseFloat(currentBalance);
  const cw = currentWac === null ? 0 : parseFloat(currentWac);

  if (Number.isNaN(a) || a <= 0) return { visible: false };

  if (isOutbound(type)) {
    // Outbound: WAC unchanged, balance decreases
    if (cb === 0) return { visible: false }; // nothing to sell from empty position
    const newBalance = Math.max(0, cb - a);
    const newCostBasis = newBalance * cw;
    return { visible: true, newBalance, newWac: cw, newCostBasis };
  }

  // Inbound (BUY, SWAP_IN, TRANSFER_IN): WAC recalculated
  const p = parseFloat(priceStr);
  if (Number.isNaN(p) || p <= 0) return { visible: false };

  const newBalance = cb + a;
  const newCostBasis = cb * cw + a * p;
  const newWac = newBalance > 0 ? newCostBasis / newBalance : 0;

  return { visible: true, newBalance, newWac, newCostBasis };
}
