import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InventoryRepository, normalizedIdentity } from "./inventory.repository";
import { createMedicineSchema } from "@pharmerp/types";
import type { CreateMedicineDto, UpdateMedicineDto, QueryMedicineDto } from "@pharmerp/types";

/** Spreadsheet exports write "N/A"/"NA"/"-" where a value is simply absent.
 *  Left as-is they would fail regex validation or store as literal text. */
const NULL_SENTINELS = new Set(["n/a", "na", "-", "--", "nil", "none"]);

/** Collapse a CSV header to a comparison key so `Medicine_ID`, `Medicine ID`
 *  and `medicineid` all resolve to the same field. */
function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Compare text ignoring case, spacing and cosmetic punctuation, so
 *  "Calci Pure-XT" and "Calci-Pure-XT" are recognised as the same value written
 *  twice. The joining operators + & / are deliberately KEPT: they carry meaning,
 *  and dropping them makes "10 mg +" and "10 mg" compare equal, which would let
 *  a two-ingredient strength collapse to one. */
function comparisonKey(s: string): string {
  return s.replace(/[^a-z0-9+&/]/gi, "").toLowerCase();
}

/** A second half that opens with a joining operator is a combination, not a
 *  repeat: "10 mg + 10 mg" is two ingredients of 10 mg each, and collapsing it
 *  would silently halve the recorded strength. */
const COMBINATION_LEAD = /^[+&/,]|^-\s|^(?:with|and|plus)\b/i;

/** Catalogue rows entered by copy-paste carry values written twice —
 *  "XYCOVIT GOLD  XYCOVIT GOLD", or with the second copy lightly re-punctuated.
 *  Keep the LAST copy: it is the more recent edit. Requires the whole value to
 *  be one repetition split at a single space, so "Neo Neo Forte" is untouched;
 *  a value that genuinely is the same text twice is never meaningful here. */
function collapseDoubled(value: string): string {
  const t = value.trim();
  for (const m of t.matchAll(/\s+/g)) {
    const first = t.slice(0, m.index);
    const last = t.slice(m.index + m[0].length);
    if (!first || !last || COMBINATION_LEAD.test(last)) continue;
    const key = comparisonKey(first);
    // Two characters is too little to be sure a repeat is deliberate.
    if (key.length > 2 && key === comparisonKey(last)) return last.trim();
  }
  return value;
}

function normalizeRow(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const value = typeof v === "string" ? v.trim() : v;
    if (value == null || value === "") continue;
    if (NULL_SENTINELS.has(String(value).toLowerCase())) continue;
    out[headerKey(k)] = collapseDoubled(String(value));
  }
  return out;
}

/** First non-empty value among the accepted header spellings. */
function pick(row: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v) return v;
  }
  return undefined;
}

function toInt(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** Spreadsheets emit money as "1,234.5", "₹120" or "120.000". Normalize to the
 *  bare 2-decimal form the numeric columns accept; anything still not
 *  number-shaped is treated as absent rather than smuggled through as text. */
function toDecimal(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const cleaned = v.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned).toFixed(2);
}

function toBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
}

/** Units per sale pack, read off the printed pack label when the import does
 *  not state strip_size outright. "10x10 Tablets" is 10 strips of 10 = 100;
 *  "30 Tablets" is 30. Anything unparseable falls back to the schema default. */
function parsePackSize(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const multi = label.match(/(\d+)\s*[xX*]\s*(\d+)/);
  if (multi) return Number(multi[1]) * Number(multi[2]);
  const single = label.match(/(\d+)/);
  return single ? Number(single[1]) : undefined;
}

/** Sale unit implied by the dosage form. Without this every row defaults to
 *  "strip", which reads wrong on an invoice line for an injection or a cream.
 *  Matched as substrings against the lowercased form, longest key first, so
 *  "Dry Syrup" resolves before "Syrup" and the sheet's ~60 spellings and typos
 *  degrade to the default rather than failing. */
const UNIT_BY_DOSAGE_FORM: Record<string, string> = {
  "prefilled syringe": "syringe",
  "eye/ear drops": "bottle",
  "iv infusion": "bottle",
  "dry syrup": "bottle",
  "oral drops": "bottle",
  "nasal spray": "bottle",
  "transfusion": "bottle",
  "suspension": "bottle",
  "respule": "respule",
  "injection": "vial",
  "ampoule": "ampoule",
  "solution": "bottle",
  "inhaler": "inhaler",
  "sachet": "sachet",
  "lotion": "bottle",
  "syrup": "bottle",
  "elixir": "bottle",
  "powder": "sachet",
  "patch": "patch",
  "drops": "bottle",
  // Singular spellings appear alongside the plural in the same catalogue.
  "drop": "bottle",
  "cream": "tube",
  "spray": "bottle",
  "vial": "vial",
  "gel": "tube",
  "oil": "bottle",
  "ointment": "tube",
  "suppository": "unit",
  "pessary": "unit",
  "enema": "unit",
  "tablet": "strip",
  "capsule": "strip",
};
const UNIT_FORM_KEYS = Object.keys(UNIT_BY_DOSAGE_FORM).sort(
  (a, b) => b.length - a.length,
);

function unitForDosageForm(form: string | undefined): string | undefined {
  if (!form) return undefined;
  const f = form.toLowerCase();
  const key = UNIT_FORM_KEYS.find((k) => f.includes(k));
  return key ? UNIT_BY_DOSAGE_FORM[key] : undefined;
}

/** ISO date, or undefined. Accepts the YYYY-MM-DD the sheet exports and the
 *  DD/MM/YYYY that Indian spreadsheet locales produce. Never guesses between
 *  the two for an ambiguous slash date: day-first is the Indian convention. */
function toIsoDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealDate(v) ? v : undefined;
  const slash = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    const candidate = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    return isRealDate(candidate) ? candidate : undefined;
  }
  return undefined;
}

/** Guards against a round-trip mismatch like 2026-02-31, which Date silently
 *  rolls forward to March 3 — an expiry a few days late is worse than none. */
function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Schedules H, H1, X and G are prescription-only under the Drugs & Cosmetics
 *  Rules; H1 and X additionally carry the controlled-register obligation. */
const RX_SCHEDULES = new Set(["h", "h1", "x", "g", "rx"]);
const CONTROLLED_SCHEDULES = new Set(["h1", "x"]);

/** Opening stock read off a catalogue row, held until its medicine has an id. */
interface PendingBatch {
  batchNo: string;
  expiryDate: string;
  manufactureDate?: string;
  quantity: number;
  costPrice: string;
  mrpAtEntry: string;
  locationLabel?: string;
  supplierName?: string;
}

/** Shape of an auto-assigned medicine id: MED00001, MED00002, ... Must stay in
 *  step with InventoryRepository.getMaxSequentialSku, which reads the same
 *  shape back out of the table. */
const SKU_PREFIX = "MED";
const SKU_WIDTH = 5;
const sequentialSkuPattern = new RegExp(`^${SKU_PREFIX}(\\d+)$`);

@Injectable()
export class InventoryService {
  constructor(private readonly repo: InventoryRepository) {}

  findAll(query: QueryMedicineDto) {
    return this.repo.findMedicinesPaginated(query);
  }

  async findOne(id: string) {
    const medicine = await this.repo.findMedicineById(id);
    if (!medicine) throw new NotFoundException(`Medicine ${id} not found`);
    return { data: medicine };
  }

  /** Exact-match barcode lookup for POS/inventory scanning — uses the
   *  medicines_barcode_idx index (O(log n)), unlike the fuzzy `findAll` search. */
  async getByBarcode(code: string) {
    const medicine = await this.repo.findActiveByBarcode(code);
    return { data: medicine ?? null };
  }

  async create(dto: CreateMedicineDto, userId?: string) {
    await this.assertBarcodeUnique(dto.barcode);
    // If the operator left SKU blank, mint a MEDNNNNN like bulk import does.
    // Two simultaneous mints can race on the same next value, so retry a few
    // times on the sku unique-index conflict before giving up. Non-mint
    // (operator-typed) SKUs never retry — a duplicate typed SKU is a real
    // conflict the caller must resolve.
    const wantsAutoSku = !dto.sku || dto.sku.trim().length === 0;
    const maxAttempts = wantsAutoSku ? 4 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const sku = wantsAutoSku
        ? `${SKU_PREFIX}${String((await this.repo.getMaxSequentialSku()) + attempt).padStart(SKU_WIDTH, "0")}`
        : dto.sku!;
      try {
        const medicine = await this.repo.createMedicine(
          { ...dto, sku } as CreateMedicineDto,
          userId,
        );
        return { data: medicine, message: "Medicine created" };
      } catch (e) {
        // Race on the auto-minted sku: bump attempt and retry.
        if (wantsAutoSku && this.isSkuUniqueConflict(e) && attempt < maxAttempts) {
          continue;
        }
        throw this.mapBarcodeConflict(e, dto.barcode);
      }
    }
    // Unreachable: the loop either returns or throws inside mapBarcodeConflict.
    throw new ConflictException("Could not mint a unique SKU after retries");
  }

  /** Detects the 23505 unique-violation raised by the sku column specifically,
   *  so barcode conflicts and other unique constraints still fall through to
   *  mapBarcodeConflict / the generic error path. */
  private isSkuUniqueConflict(e: unknown): boolean {
    const err = e as { code?: string; cause?: { code?: string }; message?: string };
    const code = err?.code ?? err?.cause?.code;
    return code === "23505" && /sku/i.test(err?.message ?? "");
  }

  async update(id: string, dto: UpdateMedicineDto) {
    await this.findOne(id);
    await this.assertBarcodeUnique(dto.barcode, id);
    try {
      const medicine = await this.repo.updateMedicine(id, dto);
      return { data: medicine, message: "Medicine updated" };
    } catch (e) {
      throw this.mapBarcodeConflict(e, dto.barcode);
    }
  }

  /** A barcode shared by two medicines would let a POS scan dispense the wrong product. */
  private async assertBarcodeUnique(barcode?: string, excludeId?: string) {
    if (!barcode) return;
    const existing = await this.repo.findMedicineByBarcode(barcode, excludeId);
    if (existing) {
      throw new ConflictException(
        `Barcode ${barcode} is already assigned to "${existing.name}" (SKU ${existing.sku})`,
      );
    }
  }

  /** Backstop for the check-then-insert race: the DB partial-unique index throws
   *  23505; turn that into the same clean 409 instead of a generic 500. */
  private mapBarcodeConflict(e: unknown, barcode?: string): never {
    const err = e as { code?: string; cause?: { code?: string }; message?: string };
    const code = err?.code ?? err?.cause?.code;
    if (code === "23505" && /barcode/i.test(err?.message ?? "")) {
      throw new ConflictException(`Barcode ${barcode ?? ""} is already assigned to another medicine`);
    }
    throw e as Error;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.softDeleteMedicine(id);
    return { message: "Medicine deleted" };
  }

  async bulkImport(
    rawRows: Record<string, string>[],
    userId?: string,
    opts: { branchId?: string; dryRun?: boolean } = {},
  ): Promise<{
    created: number;
    skipped: number;
    batchesCreated: number;
    errors: { row: number; sku: string; reason: string }[];
    warnings: { row: number; sku: string; reason: string }[];
    dryRun?: boolean;
  }> {
    const errors: { row: number; sku: string; reason: string }[] = [];
    // Rows that imported, but with an unsafe field withheld. Separate from
    // errors so a seeding run does not read as 500 failures when the records
    // are in fact present and only need a follow-up edit.
    const warnings: { row: number; sku: string; reason: string }[] = [];
    // sku is optional on the shared DTO (auto-minted on single create) but the
    // bulk pipeline always resolves a concrete sku above — either an explicit
    // one from the row or a freshly minted MEDNNNNN. Narrowing here lets the
    // downstream dedupe / batch load code treat sku as required without casts.
    const valid: Array<CreateMedicineDto & { sku: string }> = [];
    // Opening stock parsed alongside each medicine, held until the medicines
    // are inserted and their ids known. Keyed by SKU.
    const pendingBatches = new Map<string, PendingBatch>();
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();

    // Header spellings are normalized once so the catalogue export
    // (Medicine_ID, Generic_Name, MRP, ...) and the legacy snake_case template
    // (sku, generic_name, price_mrp, ...) both feed the same mapper.
    const rows = rawRows.map((r) => (r ? normalizeRow(r) : null));

    // Category arrives as a shelf name ("Antibiotics"), not a uuid — resolve
    // the whole file's names in one round trip before validating.
    const categoryIds = await this.repo.findOrCreateCategoryIds(
      rows.flatMap((r) => (r ? [pick(r, "category", "categoryname") ?? ""] : [])),
    );

    // The catalogue leaves Medicine_ID blank for products whose id is assigned
    // at seed time, so mint the next one in sequence. The starting point has to
    // clear both the ids already stored AND the ids further down this same
    // file — a single import of the full catalogue carries MED00001..MED05002
    // alongside the blank rows, and minting from the stored max alone would
    // reissue numbers the file itself is about to claim.
    const explicitSkus = rows.map((r) =>
      r ? pick(r, "sku", "medicineid", "medicinecode") : undefined,
    );

    // When a value appears on more than one line, the later line is the more
    // recent edit and is the one that counts. Both maps hold the LAST index
    // each value occurs at; every earlier occurrence yields to it.
    const lastRowForSku = new Map<string, number>();
    explicitSkus.forEach((s, i) => s && lastRowForSku.set(s, i));
    const lastRowForBarcode = new Map<string, number>();
    rows.forEach((r, i) => {
      const b = r && pick(r, "barcode");
      if (b) lastRowForBarcode.set(b, i);
    });

    // A row with no Medicine_ID gets a minted SKU, so on a second run its SKU
    // will not match anything and it would import all over again. Identify
    // those rows by name+manufacturer instead — both within this file and
    // against what is already stored.
    const identityOf = (r: Record<string, string>) =>
      normalizedIdentity(
        pick(r, "name", "medicinename", "brandname", "brand") ?? "",
        pick(r, "manufacturer"),
      );
    const idLess = rows.map((r, i) =>
      r && !explicitSkus[i] && pick(r, "name", "medicinename", "brandname", "brand")
        ? identityOf(r)
        : undefined,
    );
    const lastRowForIdentity = new Map<string, number>();
    idLess.forEach((k, i) => k && lastRowForIdentity.set(k, i));
    const storedIdentities = idLess.some(Boolean)
      ? await this.repo.findNaturalKeys()
      : new Set<string>();
    let alreadyStored = 0;

    let nextSku = 0;
    if (explicitSkus.some((s) => !s)) {
      const inFileMax = explicitSkus.reduce((max, s) => {
        const m = s?.match(sequentialSkuPattern);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0);
      nextSku = Math.max(await this.repo.getMaxSequentialSku(), inFileMax);
    }
    // Rows that fail validation leave a gap in the numbering; the next run
    // re-reads the persisted max, so the gap closes on its own.
    const mintSku = () =>
      `${SKU_PREFIX}${String(++nextSku).padStart(SKU_WIDTH, "0")}`;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNum = i + 2; // 1-indexed + header row
      if (!raw || !Object.values(raw).some((v) => v && String(v).trim())) continue;
      // Mint only for rows carrying real content, so a trailing blank row does
      // not burn a number; for those, "name: Required" is clearer feedback
      // than "SKU is required" when the row is empty anyway.
      // Some catalogue rows carry only the brand ("CONTIZOLE-100") with no
      // separate full name; the brand is the best name available.
      const named = pick(raw, "name", "medicinename", "brandname", "brand");
      const explicitSku = explicitSkus[i];
      let sku: string;

      if (explicitSku) {
        sku = explicitSku;
        // Superseded by a later line carrying the same SKU — that line's values
        // are the ones kept, so this one is dropped entirely.
        if (lastRowForSku.get(sku) !== i) {
          warnings.push({
            row: rowNum,
            sku,
            reason: `Superseded by a later row with the same SKU — that row's values were used`,
          });
          continue;
        }
      } else if (!named) {
        errors.push({ row: rowNum, sku: "", reason: "SKU is required" });
        continue;
      } else {
        const identity = idLess[i]!;
        if (lastRowForIdentity.get(identity) !== i) {
          warnings.push({
            row: rowNum,
            sku: "",
            reason: `Superseded by a later row for the same product — that row's values were used`,
          });
          continue;
        }
        // Already imported on an earlier run. Skipping keeps a repeated import
        // idempotent instead of minting a second SKU for the same product.
        if (storedIdentities.has(identity)) {
          alreadyStored++;
          continue;
        }
        sku = mintSku();
      }
      // Minted SKUs are unique by construction and explicit ones are resolved
      // above; this is a backstop, not the primary guard.
      if (seenSkus.has(sku)) { errors.push({ row: rowNum, sku, reason: "Duplicate SKU in file" }); continue; }
      seenSkus.add(sku);

      // Two products on one barcode means a POS scan dispenses whichever the
      // lookup happened to return, so only the last line claiming a barcode
      // keeps it. Earlier lines still import — the product belongs in the
      // catalogue, it just cannot be scanned until its barcode is corrected.
      let rowBarcode = pick(raw, "barcode");
      if (rowBarcode && lastRowForBarcode.get(rowBarcode) !== i) {
        warnings.push({
          row: rowNum,
          sku,
          reason: `Barcode ${rowBarcode} is claimed by a later row — imported without a barcode`,
        });
        rowBarcode = undefined;
      } else if (rowBarcode) {
        seenBarcodes.add(rowBarcode);
      }

      // No price means the product cannot be sold. Import it so the catalogue
      // is complete, but hold it inactive: an active row at MRP 0 would ring
      // up free at the counter, and inactive rows are filtered out of both the
      // POS barcode lookup and the medicine list.
      const priceMrp = toDecimal(pick(raw, "pricemrp", "mrp"));
      if (priceMrp === undefined) {
        warnings.push({
          row: rowNum,
          sku,
          reason: "No MRP — imported inactive; set a price to make it sellable",
        });
      }

      const schedule = pick(raw, "scheduleclass", "schedule");
      const scheduleKey = schedule?.toLowerCase() ?? "";
      const packSize = pick(raw, "packsize");
      const dosageForm = pick(raw, "dosageform", "form");
      const categoryName = pick(raw, "category", "categoryname");

      const parsed = createMedicineSchema.safeParse({
        name: named,
        brandName: pick(raw, "brandname", "brand"),
        genericName: pick(raw, "genericname"),
        composition: pick(raw, "composition"),
        strength: pick(raw, "strength"),
        dosageForm,
        packSize,
        sku,
        barcode: rowBarcode,
        categoryId: categoryName ? categoryIds.get(categoryName.toLowerCase()) : undefined,
        therapeuticClass: pick(raw, "therapeuticclass"),
        manufacturer: pick(raw, "manufacturer"),
        hsnCode: pick(raw, "hsncode"),
        unit: pick(raw, "unit") ?? unitForDosageForm(dosageForm) ?? "strip",
        stripSize: toInt(pick(raw, "stripsize")) ?? parsePackSize(packSize) ?? 1,
        priceMrp: priceMrp ?? "0",
        isActive: priceMrp !== undefined,
        purchaseRate: toDecimal(pick(raw, "purchaserate", "purchaseprice", "costprice")),
        taxPercent: toDecimal(pick(raw, "taxpercent", "gstpercent", "gst")) ?? "0",
        reorderLevel: toInt(pick(raw, "reorderlevel", "minimumstock", "minstock")) ?? 10,
        reorderQty: toInt(pick(raw, "reorderqty")) ?? 50,
        // Explicit column wins; otherwise the schedule class decides, so a
        // Schedule H row can never import as an over-the-counter product.
        requiresPrescription:
          toBool(pick(raw, "requiresprescription")) ?? RX_SCHEDULES.has(scheduleKey),
        isControlled:
          toBool(pick(raw, "iscontrolled")) ?? CONTROLLED_SCHEDULES.has(scheduleKey),
        scheduleClass: schedule,
        storageConditions: pick(raw, "storageconditions"),
        drawerMapping: pick(raw, "drawermapping", "drawer"),
        description: pick(raw, "description"),
      });

      if (!parsed.success) {
        const msg = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        errors.push({ row: rowNum, sku, reason: msg });
        continue;
      }
      // Re-attach the resolved sku so the narrowed valid[] type holds — the
      // parsed schema now treats sku as optional so parsed.data.sku is
      // string | undefined even though we passed one in.
      valid.push({ ...parsed.data, sku });

      // --- opening stock on the same line -------------------------------
      const batchNo = pick(raw, "batchno", "batchnumber", "batch");
      if (!batchNo) continue;

      const expiryDate = toIsoDate(pick(raw, "expirydate", "expiry", "expdate"));
      if (!expiryDate) {
        warnings.push({
          row: rowNum,
          sku,
          reason: `Batch ${batchNo} has no usable expiry date — stock not loaded`,
        });
        continue;
      }

      // Quantity may legitimately be 0 (a listed batch that is sold out); only
      // a non-numeric value is a problem.
      const quantity = toInt(pick(raw, "stock", "quantity", "qty")) ?? 0;
      if (quantity < 0) {
        warnings.push({
          row: rowNum,
          sku,
          reason: `Batch ${batchNo} has negative stock (${quantity}) — stock not loaded`,
        });
        continue;
      }

      pendingBatches.set(sku, {
        batchNo,
        expiryDate,
        manufactureDate: toIsoDate(pick(raw, "manufacturedate", "mfgdate", "mfg")),
        quantity,
        // Batch valuation falls back to the catalogue rate, then to MRP, then
        // to 0 — cost_price and mrp_at_entry are both NOT NULL.
        costPrice:
          toDecimal(pick(raw, "purchaserate", "purchaseprice", "costprice")) ??
          priceMrp ??
          "0",
        mrpAtEntry: priceMrp ?? "0",
        locationLabel: pick(raw, "location", "rack", "shelflocation"),
        supplierName: pick(raw, "supplier", "distributor", "suppliername"),
      });
    }

    if (valid.length === 0) {
      return { created: 0, skipped: alreadyStored, batchesCreated: 0, errors, warnings };
    }

    const [existingSkus, existingBarcodes] = await Promise.all([
      this.repo.findSkuSet(valid.map((r) => r.sku)),
      this.repo.findBarcodeSet(valid.map((r) => r.barcode).filter((b): b is string => !!b)),
    ]);
    const toInsert = valid.filter(
      (r) => !existingSkus.has(r.sku) && !(r.barcode && existingBarcodes.has(r.barcode)),
    );
    const skipped = valid.length - toInsert.length + alreadyStored;

    // Already-present rows are warnings, not errors: they are the normal result
    // of re-running an import, they are already counted in `skipped`, and
    // listing them as errors makes a clean idempotent re-run look like a
    // catastrophic failure in the UI.
    for (const r of valid.filter((r) => existingSkus.has(r.sku))) {
      warnings.push({ row: 0, sku: r.sku, reason: "Already imported — skipped" });
    }
    for (const r of valid.filter((r) => !existingSkus.has(r.sku) && r.barcode && existingBarcodes.has(r.barcode))) {
      warnings.push({
        row: 0,
        sku: r.sku,
        reason: `Barcode ${r.barcode} belongs to a medicine already stored — skipped`,
      });
    }

    // Stock for medicines that will actually be inserted. A row skipped as an
    // existing SKU already has its batches from the earlier import.
    const stockToLoad = toInsert.flatMap((m) => {
      const b = pendingBatches.get(m.sku);
      return b ? [{ sku: m.sku, ...b }] : [];
    });
    if (stockToLoad.length > 0 && !opts.branchId) {
      warnings.push({
        row: 0,
        sku: "",
        reason:
          `${stockToLoad.length} rows carry batch and stock data, but the importing user has no ` +
          `branch — medicines were created without opening stock`,
      });
    }

    if (opts.dryRun) {
      return {
        created: toInsert.length,
        skipped,
        batchesCreated: stockToLoad.length,
        errors,
        warnings,
        dryRun: true,
      };
    }

    // Medicines and their opening stock go in together. Splitting them would
    // let a batch failure strand medicines with no stock; they would then look
    // "already imported", so a retry could never load that stock.
    const { idsBySku, batchesCreated } = await this.repo.persistCatalogueImport({
      medicines: toInsert,
      batches: stockToLoad,
      branchId: opts.branchId,
      userId,
    });
    return { created: idsBySku.size, skipped, batchesCreated, errors, warnings };
  }

  getLowStock(branchId?: string) {
    return this.repo.getLowStockMedicines(branchId);
  }

  getBatchesForDispense(medicineId: string, branchId?: string) {
    return this.repo.getActiveBatchesForDispense(medicineId, branchId);
  }

  getStockValuation(branchId?: string) {
    return this.repo.getStockValuation(branchId);
  }

  async listCategories() {
    return { data: await this.repo.findCategories() };
  }
}
