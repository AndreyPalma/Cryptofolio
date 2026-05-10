import { describe, it, expect } from 'vitest';
import { computePnl } from '../src/services/portfolio.js';

describe('computePnl — FIAT_IN / FIAT_OUT', () => {
  it('FIAT_IN with both prices returns INBOUND lotPnlUsd and lotPnlPct', () => {
    const pnl = computePnl(
      'FIAT_IN',
      '1.000000000000000000',
      '1.250000000000000000',
      '100.000000000000000000',
    );

    expect(pnl).toEqual({
      kind: 'INBOUND',
      lotPnlUsd: '25.000000000000000000',
      lotPnlPct: '25.000000000000000000',
    });
  });

  it('FIAT_OUT with both prices returns OUTBOUND realizedPnlUsd', () => {
    const pnl = computePnl(
      'FIAT_OUT',
      '1.000000000000000000',
      '1.250000000000000000',
      '100.000000000000000000',
    );

    expect(pnl).toEqual({
      kind: 'OUTBOUND',
      displayAs: 'Sold/Out',
      realizedPnlUsd: '25.000000000000000000',
    });
  });

  it('existing BUY and SELL behavior does not regress', () => {
    const buyPnl = computePnl('BUY', '100.000000000000000000', '125.000000000000000000', '2.000000000000000000');
    const sellPnl = computePnl('SELL', '100.000000000000000000', '125.000000000000000000', '2.000000000000000000');

    expect(buyPnl).toEqual({
      kind: 'INBOUND',
      lotPnlUsd: '50.000000000000000000',
      lotPnlPct: '25.000000000000000000',
    });
    expect(sellPnl).toEqual({
      kind: 'OUTBOUND',
      displayAs: 'Sold/Out',
      realizedPnlUsd: '50.000000000000000000',
    });
  });
});
