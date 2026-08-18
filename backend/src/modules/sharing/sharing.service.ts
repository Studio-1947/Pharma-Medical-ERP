import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { formatTokenNo } from "@pharmerp/types";

export type ShareableType = "prescription" | "invoice";

/** Default lifetime of a share link. Long enough to be useful to a patient,
 *  short enough that a forwarded link stops working on its own. */
const DEFAULT_TTL_DAYS = 7;
const MAX_TTL_DAYS = 30;

/**
 * Reduces a patient's name to a first name plus an initial.
 *
 * The link is unauthenticated, so the page shows only enough for the patient to
 * recognise their own record. "Anita Sharma" becomes "Anita S.".
 */
export function maskPatientName(name?: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  const last = parts[parts.length - 1]!;
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  /** 32 URL-safe characters from 24 random bytes. */
  private newToken(): string {
    return randomBytes(24).toString("base64url");
  }

  /**
   * Staff may only share a record from their own branch. Super admins are not
   * branch-bound. Without this, any logged-in user could mint a public link to
   * another branch's patient record.
   */
  private assertBranchAccess(
    user: { role: string; branchId?: string },
    recordBranchId: string | null | undefined,
  ) {
    if (user.role === "super_admin") return;
    if (!user.branchId || !recordBranchId) return;
    if (user.branchId !== recordBranchId) {
      throw new ForbiddenException("Record belongs to another branch");
    }
  }

  async createLink(
    resourceType: ShareableType,
    resourceId: string,
    user: { sub: string; role: string; branchId?: string },
    ttlDays = DEFAULT_TTL_DAYS,
  ) {
    const days = Math.min(Math.max(1, Math.trunc(ttlDays)), MAX_TTL_DAYS);

    let patientId: string | null = null;
    let branchId: string | null = null;

    if (resourceType === "prescription") {
      const rx = await this.db.query.prescriptions.findFirst({
        where: eq(schema.prescriptions.id, resourceId),
        columns: { id: true, patientId: true, branchId: true },
      });
      if (!rx) throw new NotFoundException("Prescription not found");
      patientId = rx.patientId ?? null;
      branchId = rx.branchId ?? null;
    } else {
      const inv = await this.db.query.salesInvoices.findFirst({
        where: eq(schema.salesInvoices.id, resourceId),
        columns: { id: true, patientId: true, branchId: true },
      });
      if (!inv) throw new NotFoundException("Invoice not found");
      patientId = inv.patientId ?? null;
      branchId = inv.branchId ?? null;
    }

    this.assertBranchAccess(user, branchId);

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const [row] = await this.db
      .insert(schema.recordShareLinks)
      .values({
        token: this.newToken(),
        resourceType,
        resourceId,
        patientId,
        branchId,
        expiresAt,
        createdBy: user.sub,
      })
      .returning();

    return {
      token: row!.token,
      path: `/p/${row!.token}`,
      expiresAt: row!.expiresAt,
    };
  }

  async listForRecord(resourceType: ShareableType, resourceId: string) {
    const rows = await this.db
      .select()
      .from(schema.recordShareLinks)
      .where(
        and(
          eq(schema.recordShareLinks.resourceType, resourceType),
          eq(schema.recordShareLinks.resourceId, resourceId),
        ),
      )
      .orderBy(desc(schema.recordShareLinks.createdAt));

    const now = Date.now();
    return rows.map((r) => ({
      token: r.token,
      path: `/p/${r.token}`,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      viewCount: r.viewCount,
      lastViewedAt: r.lastViewedAt,
      active: !r.revokedAt && new Date(r.expiresAt).getTime() > now,
    }));
  }

  async revoke(token: string, user: { role: string; branchId?: string }) {
    const link = await this.db.query.recordShareLinks.findFirst({
      where: eq(schema.recordShareLinks.token, token),
    });
    if (!link) throw new NotFoundException("Share link not found");

    this.assertBranchAccess(user, link.branchId);

    // Idempotent: revoking an already dead link is not an error, so a
    // double-click from the UI does not surface a failure.
    if (link.revokedAt) return { revoked: true, alreadyRevoked: true };

    await this.db
      .update(schema.recordShareLinks)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.recordShareLinks.id, link.id));

    return { revoked: true, alreadyRevoked: false };
  }

  /**
   * Resolves a public token to a deliberately narrow view of the record.
   *
   * Revoked and expired links are refused with the same 404 as an unknown
   * token, so probing cannot distinguish "never existed" from "killed".
   */
  async resolvePublic(token: string) {
    const notFound = new NotFoundException("This link is invalid or has expired");

    if (!token || token.length < 16) throw notFound;

    const link = await this.db.query.recordShareLinks.findFirst({
      where: eq(schema.recordShareLinks.token, token),
    });
    if (!link) throw notFound;
    if (link.revokedAt) throw notFound;
    if (new Date(link.expiresAt).getTime() <= Date.now()) throw notFound;

    const payload =
      link.resourceType === "prescription"
        ? await this.prescriptionView(link.resourceId)
        : await this.invoiceView(link.resourceId);

    if (!payload) throw notFound;

    // Access trail. Fire and forget: a failed counter update must not stop a
    // patient reading their own record.
    this.db
      .update(schema.recordShareLinks)
      .set({
        viewCount: (link.viewCount ?? 0) + 1,
        lastViewedAt: new Date(),
      })
      .where(eq(schema.recordShareLinks.id, link.id))
      .catch((e) =>
        this.logger.warn(`share view counter failed: ${(e as Error).message}`),
      );

    return { data: { type: link.resourceType, ...payload } };
  }

  private async tokenNoForPrescription(prescriptionId: string) {
    const row = await this.db.query.clinicTokens.findFirst({
      where: eq(schema.clinicTokens.prescriptionId, prescriptionId),
      columns: { tokenNo: true },
    });
    return row?.tokenNo ?? null;
  }

  private async prescriptionView(id: string) {
    const rx = await this.db.query.prescriptions.findFirst({
      where: eq(schema.prescriptions.id, id),
      with: { patient: true, items: { with: { medicine: true } } },
    });
    if (!rx) return null;

    const tokenNo = await this.tokenNoForPrescription(rx.id);

    // Only fields a patient needs to recognise and use the prescription.
    // Deliberately absent: phone, address, other visits, internal ids, and the
    // uploaded scan, which can carry far more than this record.
    return {
      // No prescriptionNumber column exists; the UI shows a short id, so the
      // public view uses the same derivation rather than inventing a field.
      prescriptionNumber: rx.id.slice(0, 8).toUpperCase(),
      issuedDate: rx.issuedDate ?? rx.createdAt ?? null,
      expiryDate: rx.expiryDate ?? null,
      doctorName: rx.doctorName ?? null,
      status: rx.status ?? null,
      tokenNo,
      tokenLabel: formatTokenNo(tokenNo),
      patientName: maskPatientName((rx as any).patient?.name),
      items: (rx.items ?? []).map((it: any) => ({
        medicineName: it.medicine?.name ?? it.medicineName ?? null,
        dosage: it.dosage ?? null,
        frequency: it.frequency ?? null,
        duration: it.duration ?? null,
        quantityPrescribed: it.quantityPrescribed ?? null,
      })),
    };
  }

  private async invoiceView(id: string) {
    const inv = await this.db.query.salesInvoices.findFirst({
      where: eq(schema.salesInvoices.id, id),
      with: { patient: true, items: { with: { medicine: true } } },
    });
    if (!inv) return null;

    const tokenNo = inv.prescriptionId
      ? await this.tokenNoForPrescription(inv.prescriptionId)
      : null;

    return {
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.createdAt ?? null,
      status: inv.status ?? null,
      tokenNo,
      tokenLabel: formatTokenNo(tokenNo),
      patientName: maskPatientName((inv as any).patient?.name),
      subtotal: inv.subtotal ?? null,
      discountAmount: inv.discountAmount ?? null,
      taxAmount: inv.taxAmount ?? null,
      totalAmount: inv.totalAmount ?? null,
      amountPaid: inv.amountPaid ?? null,
      amountDue: inv.amountDue ?? null,
      items: (inv.items ?? []).map((it: any) => ({
        medicineName: it.medicine?.name ?? it.medicineName ?? null,
        quantity: it.quantity ?? null,
        unitPrice: it.unitPrice ?? it.mrp ?? null,
        lineTotal: it.lineTotal ?? it.totalAmount ?? null,
      })),
    };
  }
}
