import Dexie, { type Table } from "dexie";

export interface OfflineInvoice {
  id?: number;
  localId: string;
  payload: object;
  createdAt: Date;
  synced: boolean;
  attempts: number;
  /** Last failure, kept so the counter can be told why a sale is stuck. */
  lastError?: string;
}

export interface CachedMedicine {
  id: string;
  name: string;
  genericName?: string;
  sku: string;
  barcode?: string;
  priceMrp: string;
  taxPercent: string;
  unit: string;
  requiresPrescription: boolean;
  cachedAt: Date;
}

class PosDatabase extends Dexie {
  offlineInvoices!: Table<OfflineInvoice>;
  medicines!: Table<CachedMedicine>;

  constructor() {
    super("pharmerp_pos");
    this.version(1).stores({
      offlineInvoices: "++id, localId, synced, createdAt",
      medicines: "id, sku, barcode, name",
    });
    // lastError is not indexed, so no store change is needed — but the version
    // bump keeps Dexie's schema history honest for anyone reading it.
    this.version(2).stores({
      offlineInvoices: "++id, localId, synced, createdAt",
      medicines: "id, sku, barcode, name",
    });
  }
}

export const posDb = new PosDatabase();

/**
 * Give up after this many failed sync attempts.
 *
 * A payload that will never succeed — the stock went in the meantime, the
 * prescription expired — used to be retried on every single reconnect, for
 * ever, silently. Stopping makes it visible instead of endless.
 */
export const MAX_SYNC_ATTEMPTS = 5;

export async function queueOfflineInvoice(payload: object) {
  const localId = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  await posDb.offlineInvoices.add({
    localId,
    // The id travels with the payload as an idempotency key. Without it a
    // response lost after the server committed made the next reconnect bill
    // the same sale a second time.
    payload: { ...payload, clientRef: localId },
    createdAt: new Date(),
    synced: false,
    attempts: 0,
  });
  return localId;
}

export interface SyncResult {
  synced: number;
  failed: number;
  /** Rows that hit MAX_SYNC_ATTEMPTS and will not be retried automatically. */
  abandoned: number;
}

/**
 * Replays queued sales. Safe to call repeatedly: every payload carries a
 * clientRef, so a sale the server already recorded comes back as that same
 * invoice rather than being billed again.
 */
export async function syncOfflineQueue(
  submitFn: (payload: object) => Promise<void>,
): Promise<SyncResult> {
  const pending = await posDb.offlineInvoices
    .filter((r) => !r.synced && (r.attempts ?? 0) < MAX_SYNC_ATTEMPTS)
    .toArray();

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      await submitFn(item.payload);
      await posDb.offlineInvoices.update(item.id!, { synced: true });
      synced++;
    } catch (err) {
      const attempts = (item.attempts ?? 0) + 1;
      await posDb.offlineInvoices.update(item.id!, {
        attempts,
        lastError: err instanceof Error ? err.message : String(err),
      });
      failed++;
    }
  }

  const abandoned = await posDb.offlineInvoices
    .filter((r) => !r.synced && (r.attempts ?? 0) >= MAX_SYNC_ATTEMPTS)
    .count();

  return { synced, failed, abandoned };
}

/** Sales that have exhausted their retries and need someone to look at them. */
export async function getStuckInvoices(): Promise<OfflineInvoice[]> {
  return posDb.offlineInvoices
    .filter((r) => !r.synced && (r.attempts ?? 0) >= MAX_SYNC_ATTEMPTS)
    .toArray();
}

/** Puts a stuck sale back in the queue after the operator has fixed the cause. */
export async function retryStuckInvoice(id: number) {
  await posDb.offlineInvoices.update(id, { attempts: 0, lastError: undefined });
}
