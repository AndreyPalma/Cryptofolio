import type { FastifyBaseLogger } from 'fastify';

export class SyncOrchestrator {
  private locks = new Map<string, AbortController>();

  constructor(private readonly log: FastifyBaseLogger) {}

  tryAcquireLock(walletId: string): AbortController | null {
    if (this.locks.has(walletId)) return null;
    const ac = new AbortController();
    this.locks.set(walletId, ac);
    return ac;
  }

  releaseLock(walletId: string): void {
    this.locks.delete(walletId);
  }

  isLocked(walletId: string): boolean {
    return this.locks.has(walletId);
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    syncOrchestrator: SyncOrchestrator;
  }
}
