import { Decimal } from 'decimal.js';
import type { TransactionType } from '../db/types.js';

// Configuración global — se ejecuta al cargar el módulo
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export const ZERO = new Decimal(0);

export function toDecimal(value: string): Decimal {
  return new Decimal(value);
}

export function roundToStorage(value: Decimal): string {
  return value.toFixed(18, Decimal.ROUND_HALF_EVEN);
}

export function isInbound(
  type: TransactionType,
): type is 'BUY' | 'SWAP_IN' | 'TRANSFER_IN' {
  return type === 'BUY' || type === 'SWAP_IN' || type === 'TRANSFER_IN';
}

export function isOutbound(
  type: TransactionType,
): type is 'SELL' | 'SWAP_OUT' | 'TRANSFER_OUT' {
  return type === 'SELL' || type === 'SWAP_OUT' || type === 'TRANSFER_OUT';
}
