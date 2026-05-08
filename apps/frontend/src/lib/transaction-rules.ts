/**
 * transaction-rules.ts — pure helpers for transaction type classification and validation.
 */
import type { TransactionType } from "../types/token-detail";

export function isPriceRequired(type: TransactionType): boolean {
  return type !== "TRANSFER_OUT";
}

export function isOutbound(type: TransactionType): boolean {
  return type === "SELL" || type === "SWAP_OUT" || type === "TRANSFER_OUT";
}

export function isInbound(type: TransactionType): boolean {
  return !isOutbound(type);
}

/**
 * Validates amount field. Returns null if valid, error string if invalid.
 */
export function validateAmount(value: string): string | null {
  if (value.trim() === "") return "Amount is required";
  const n = parseFloat(value);
  if (Number.isNaN(n) || n <= 0) return "Amount must be a positive number";
  // Must match /^\d+(\.\d+)?$/ — no negative, no sci notation
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return "Amount must be a positive number";
  return null;
}

/**
 * Validates price_usd field. Returns null if valid, error string if invalid.
 * Empty string is valid only when type is TRANSFER_OUT (field is optional).
 */
export function validatePriceUsd(value: string, type: TransactionType): string | null {
  const trimmed = value.trim();

  // Empty + optional = ok
  if (trimmed === "") {
    if (!isPriceRequired(type)) return null;
    return "Price USD is required";
  }

  const n = parseFloat(trimmed);
  if (Number.isNaN(n) || n <= 0) return "Price must be greater than 0";
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return "Price must be greater than 0";

  return null;
}
