import { Processor, Process } from "@nestjs/bull";
import { Job } from "bull";
import { Logger } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { S3Service } from "../../common/s3/s3.service";

interface GeneratePdfJobData {
  invoiceId: string;
}

function rupee(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return `Rs. ${n.toFixed(2)}`;
}

function dateStr(d: Date | string | null | undefined): string {
  if (!d) return "N/A";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

@Processor("pdf-generation")
export class InvoicePdfWorker {
  private readonly logger = new Logger(InvoicePdfWorker.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly s3Service: S3Service,
  ) {}

  @Process()
  async handleGeneratePdf(job: Job<GeneratePdfJobData>) {
    this.logger.log(`Generating PDF for invoice ${job.data.invoiceId}`);
    const db = this.drizzle.db;

    // Load invoice with all relations
    const invoice = await db.query.salesInvoices.findFirst({
      where: eq(schema.salesInvoices.id, job.data.invoiceId),
      with: {
        items: { with: { medicine: true, batch: true } },
        patient: true,
        payments: true,
      },
    });

    if (!invoice) {
      this.logger.error(`Invoice ${job.data.invoiceId} not found`);
      return;
    }

    // Load branch if set (branchId is optional)
    const [branch] = invoice.branchId
      ? await db.select().from(schema.branches).where(eq(schema.branches.id, invoice.branchId))
      : [];

    try {
      const pdfBuffer = await this.buildPdf(invoice, branch ?? null);

      const key = `invoices/${invoice.invoiceNo}-${Date.now()}.pdf`;
      await this.s3Service.upload(pdfBuffer, key, "application/pdf");

      await db
        .update(schema.salesInvoices)
        .set({ pdfUrl: key })
        .where(eq(schema.salesInvoices.id, invoice.id));

      this.logger.log(`PDF uploaded for ${invoice.invoiceNo} → ${key}`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`PDF generation failed for ${invoice.invoiceNo}: ${err.message}`);
      throw error;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  Cash Memo PDF — matches traditional Radha Madhav Medical Hall layout
  //  Columns: Qty | Particulars | Batch No. | Mfg. | Exp. | SCH | MRP | Amount
  // ════════════════════════════════════════════════════════════════════════════
  private buildPdf(invoice: any, branch: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margin: 30,
        bufferPages: true,
        info: {
          Title: `Cash Memo ${invoice.invoiceNo}`,
          Author: branch?.name ?? "PharmERP",
        },
      });

      const buffers: Buffer[] = [];
      doc.on("data", (b: Buffer) => buffers.push(b));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const ML = 30;
      const PW = doc.page.width - ML * 2;
      const PAGE_BOTTOM = doc.page.height - 50;
      const BORDER = "#333333";
      const TXT = "#111111";
      const LABEL = "#555555";

      // ══════════════════════════════════════════════════════════════════════
      //  OUTER BORDER (double-line)
      // ══════════════════════════════════════════════════════════════════════
      doc.rect(ML, 20, PW, doc.page.height - 40)
        .strokeColor(BORDER).lineWidth(1.5).stroke();
      doc.rect(ML + 3, 23, PW - 6, doc.page.height - 46)
        .strokeColor(BORDER).lineWidth(0.5).stroke();

      // ══════════════════════════════════════════════════════════════════════
      //  HEADER — Shop Name, Subtitle, Address
      // ══════════════════════════════════════════════════════════════════════
      let y = 32;

      doc.font("Helvetica-Bold").fontSize(16).fillColor(TXT)
        .text(branch?.name ?? "RADHA MADHAV MEDICAL HALL", ML, y, {
          width: PW, align: "center", lineBreak: false,
        });
      y += 20;

      doc.font("Helvetica-Bold").fontSize(9).fillColor(LABEL)
        .text("CHEMIST & DRUGGIST", ML, y, {
          width: PW, align: "center", lineBreak: false,
        });
      y += 13;

      const addressParts = [branch?.address, branch?.state].filter(Boolean).join(", ");
      if (addressParts) {
        doc.font("Helvetica").fontSize(8).fillColor(TXT)
          .text(addressParts, ML, y, {
            width: PW, align: "center", lineBreak: false,
          });
        y += 12;
      }

      const contactParts = [branch?.phone, branch?.email].filter(Boolean).join("  |  ");
      if (contactParts) {
        doc.font("Helvetica").fontSize(7.5).fillColor(LABEL)
          .text(contactParts, ML, y, {
            width: PW, align: "center", lineBreak: false,
          });
        y += 11;
      }

      // Divider
      y += 2;
      doc.moveTo(ML + 8, y).lineTo(ML + PW - 8, y)
        .strokeColor(BORDER).lineWidth(1).stroke();
      y += 6;

      // ── CASH MEMO title ──
      doc.font("Helvetica-Bold").fontSize(12).fillColor(TXT)
        .text("CASH MEMO", ML, y, {
          width: PW, align: "center", lineBreak: false,
        });
      y += 18;

      doc.moveTo(ML + 8, y).lineTo(ML + PW - 8, y)
        .strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 8;

      // ══════════════════════════════════════════════════════════════════════
      //  META FIELDS — Memo No, Patient Name, Dr., Date
      // ══════════════════════════════════════════════════════════════════════
      const metaLeft = ML + 12;
      const metaRight = ML + PW * 0.55;
      const metaValLeft = metaLeft + 85;
      const metaValRight = metaRight + 45;
      const lineH = 14;

      const metaField = (label: string, value: string, x: number, valX: number, yPos: number) => {
        doc.font("Helvetica-Bold").fontSize(8).fillColor(LABEL)
          .text(label, x, yPos, { lineBreak: false });
        doc.font("Helvetica").fontSize(8.5).fillColor(TXT)
          .text(value, valX, yPos, { lineBreak: false });
      };

      metaField("Memo No.:", invoice.invoiceNo, metaLeft, metaValLeft, y);
      metaField("Date:", dateStr(invoice.createdAt), metaRight, metaValRight, y);
      y += lineH;

      metaField("Patient Name:", invoice.patient?.name ?? "Walk-in Customer", metaLeft, metaValLeft, y);
      if (invoice.patient?.phone) {
        metaField("Ph:", invoice.patient.phone, metaRight, metaValRight, y);
      }
      y += lineH;

      if (invoice.patient?.address) {
        metaField("Address:", invoice.patient.address, metaLeft, metaValLeft, y);
        y += lineH;
      }

      if (invoice.prescriptionId) {
        metaField("Prescribed by Dr.:", "As per Rx", metaLeft, metaValLeft, y);
        y += lineH;
      }

      y += 4;

      // ══════════════════════════════════════════════════════════════════════
      //  ITEMS TABLE
      //  Qty | Particulars | Batch No. | Mfg. | Exp. | SCH | MRP | Amount
      // ══════════════════════════════════════════════════════════════════════
      const tblX = ML + 6;
      const tblW = PW - 12;
      const cols = [
        { label: "Qty",         w: tblW * 0.06, align: "center" as const },
        { label: "Particulars", w: tblW * 0.30, align: "left"   as const },
        { label: "Batch No.",   w: tblW * 0.12, align: "center" as const },
        { label: "Mfg.",        w: tblW * 0.10, align: "center" as const },
        { label: "Exp.",        w: tblW * 0.10, align: "center" as const },
        { label: "SCH",         w: tblW * 0.07, align: "center" as const },
        { label: "MRP",         w: tblW * 0.10, align: "right"  as const },
        { label: "Amount",      w: tblW * 0.15, align: "right"  as const },
      ];

      // Helper: draws table header row and returns the Y after it
      const drawTableHeader = (headerY: number) => {
        doc.rect(tblX, headerY, tblW, 18)
          .strokeColor(BORDER).lineWidth(0.8).stroke();

        let cx = tblX;
        cols.forEach((col) => {
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor(TXT)
            .text(col.label, cx + 3, headerY + 5, {
              width: col.w - 6, align: col.align, lineBreak: false,
            });
          doc.moveTo(cx, headerY).lineTo(cx, headerY + 18)
            .strokeColor(BORDER).lineWidth(0.3).stroke();
          cx += col.w;
        });
        doc.moveTo(tblX + tblW, headerY).lineTo(tblX + tblW, headerY + 18)
          .strokeColor(BORDER).lineWidth(0.3).stroke();

        return headerY + 18;
      };

      y = drawTableHeader(y);

      const items: any[] = invoice.items ?? [];
      const ROW_H = 20;

      items.forEach((item: any) => {
        // Page break with header repeat
        if (y + ROW_H > PAGE_BOTTOM) {
          doc.addPage();
          doc.rect(ML, 20, PW, doc.page.height - 40)
            .strokeColor(BORDER).lineWidth(1.5).stroke();
          doc.rect(ML + 3, 23, PW - 6, doc.page.height - 46)
            .strokeColor(BORDER).lineWidth(0.5).stroke();
          y = drawTableHeader(30);
        }

        // Row border
        doc.rect(tblX, y, tblW, ROW_H)
          .strokeColor(BORDER).lineWidth(0.3).stroke();

        const med = item.medicine;
        const batchNo = item.batch?.batchNo ?? "--";
        const mfgDate = item.batch?.manufacturingDate ? dateStr(item.batch.manufacturingDate) : "--";
        const expDate = item.batch?.expiryDate ? dateStr(item.batch.expiryDate) : "--";
        const schedule = med?.schedule ?? "--";
        const mrp = Number(item.unitPrice ?? 0);
        const lineTotal = Number(item.lineTotal ?? 0);

        const rowData = [
          { text: String(item.quantity),     align: "center" as const },
          { text: med?.name ?? "Medicine",   align: "left"   as const },
          { text: batchNo,                   align: "center" as const },
          { text: mfgDate,                   align: "center" as const },
          { text: expDate,                   align: "center" as const },
          { text: schedule,                  align: "center" as const },
          { text: `${mrp.toFixed(2)}`,       align: "right"  as const },
          { text: `${lineTotal.toFixed(2)}`, align: "right"  as const },
        ];

        let cx = tblX;
        rowData.forEach((cell, i) => {
          doc.font("Helvetica").fontSize(7).fillColor(TXT)
            .text(cell.text, cx + 3, y + 6, {
              width: cols[i]!.w - 6, align: cell.align, lineBreak: false,
            });
          doc.moveTo(cx, y).lineTo(cx, y + ROW_H)
            .strokeColor(BORDER).lineWidth(0.3).stroke();
          cx += cols[i]!.w;
        });
        doc.moveTo(tblX + tblW, y).lineTo(tblX + tblW, y + ROW_H)
          .strokeColor(BORDER).lineWidth(0.3).stroke();

        y += ROW_H;
      });

      // Empty rows to fill space (minimum 8 visible rows like a cash memo pad)
      const emptyNeeded = Math.max(0, 8 - items.length);
      for (let i = 0; i < emptyNeeded; i++) {
        if (y + ROW_H > PAGE_BOTTOM) break;
        doc.rect(tblX, y, tblW, ROW_H)
          .strokeColor(BORDER).lineWidth(0.3).stroke();
        let cx = tblX;
        cols.forEach((col) => {
          doc.moveTo(cx, y).lineTo(cx, y + ROW_H)
            .strokeColor(BORDER).lineWidth(0.3).stroke();
          cx += col.w;
        });
        doc.moveTo(tblX + tblW, y).lineTo(tblX + tblW, y + ROW_H)
          .strokeColor(BORDER).lineWidth(0.3).stroke();
        y += ROW_H;
      }

      // ══════════════════════════════════════════════════════════════════════
      //  TOTALS — right-aligned below the table
      // ══════════════════════════════════════════════════════════════════════
      y += 4;
      const totLabelX = tblX + tblW * 0.60;
      const totValX = tblX + tblW * 0.82;
      const totValW = tblW * 0.18 - 6;

      const totRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(bold ? 9 : 8).fillColor(TXT)
          .text(label, totLabelX, y, { width: tblW * 0.20, align: "left", lineBreak: false });
        doc.font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(bold ? 9 : 8).fillColor(TXT)
          .text(value, totValX, y, { width: totValW, align: "right", lineBreak: false });
        y += 13;
      };

      // GST breakdown
      const totalCgst = items.reduce((s: number, i: any) => s + Number(i.cgstAmt ?? 0), 0);
      const totalSgst = items.reduce((s: number, i: any) => s + Number(i.sgstAmt ?? 0), 0);
      const totalIgst = items.reduce((s: number, i: any) => s + Number(i.igstAmt ?? 0), 0);

      if (Number(invoice.discountAmount) > 0) {
        totRow("Discount:", `- ${rupee(invoice.discountAmount)}`);
      }
      if (totalCgst > 0) totRow("CGST:", rupee(totalCgst));
      if (totalSgst > 0) totRow("SGST:", rupee(totalSgst));
      if (totalIgst > 0) totRow("IGST:", rupee(totalIgst));

      // Line above grand total
      doc.moveTo(totLabelX, y).lineTo(tblX + tblW - 6, y)
        .strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 5;

      totRow("TOTAL:", rupee(invoice.totalAmount), true);

      if (Number(invoice.amountDue) > 0) {
        totRow("Paid:", rupee(invoice.amountPaid));
        totRow("Due:", rupee(invoice.amountDue));
      }

      // ══════════════════════════════════════════════════════════════════════
      //  FOOTER — GSTIN, DL Nos., Sign of Pharmacist (on every page)
      // ══════════════════════════════════════════════════════════════════════
      const pages = doc.bufferedPageRange();
      for (let pg = 0; pg < pages.count; pg++) {
        doc.switchToPage(pg);

        const footY = doc.page.height - 46;

        doc.moveTo(ML + 8, footY - 6).lineTo(ML + PW - 8, footY - 6)
          .strokeColor(BORDER).lineWidth(0.5).stroke();

        // Left: GSTIN + DL numbers
        doc.font("Helvetica").fontSize(6.5).fillColor(LABEL);
        const footLines: string[] = [];
        if (branch?.gstin) footLines.push(`GSTIN: ${branch.gstin}`);
        if (branch?.drugLicense20B) footLines.push(`D.L. No: ${branch.drugLicense20B}`);
        if (branch?.drugLicense21B) footLines.push(branch.drugLicense21B);

        let fy = footY;
        footLines.forEach((line) => {
          doc.text(line, ML + 12, fy, { lineBreak: false });
          fy += 9;
        });

        // Right: Signature line + label
        const sigX = ML + PW * 0.65;
        doc.moveTo(sigX + 10, footY + 10).lineTo(sigX + PW * 0.28, footY + 10)
          .strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.font("Helvetica").fontSize(7).fillColor(LABEL)
          .text("Sign of Pharmacist", sigX, footY + 14, {
            width: PW * 0.30, align: "center", lineBreak: false,
          });

        // Page number (only if multi-page)
        if (pages.count > 1) {
          doc.font("Helvetica").fontSize(6).fillColor(LABEL)
            .text(`Page ${pg + 1} of ${pages.count}`, ML, doc.page.height - 28, {
              width: PW, align: "center", lineBreak: false,
            });
        }
      }

      doc.end();
    });
  }
}
