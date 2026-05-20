import Dexie, { type Table } from "dexie";

export interface OfflineInvoice {
  id?: number;
  localId: string;
  payload: object;
  createdAt: Date;
  synced: boolean;
  attempts: number;
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
  }
}

export const posDb = new PosDatabase();

export async function queueOfflineInvoice(payload: object) {
  const localId = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  await posDb.offlineInvoices.add({ localId, payload, createdAt: new Date(), synced: false, attempts: 0 });
  return localId;
}

export async function syncOfflineQueue(
  submitFn: (payload: object) => Promise<void>,
) {
  const pending = await posDb.offlineInvoices.filter((r) => !r.synced).toArray();
  for (const item of pending) {
    try {
      await submitFn(item.payload);
      await posDb.offlineInvoices.update(item.id!, { synced: true });
    } catch {
      await posDb.offlineInvoices.update(item.id!, { attempts: (item.attempts ?? 0) + 1 });
    }
  }
}
