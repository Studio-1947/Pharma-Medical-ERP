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

const BLUE = "#1d4ed8";
const GRAY = "#64748b";
const LIGHT = "#f8fafc";
const BLACK = "#0f172a";
const DIVIDER = "#e2e8f0";

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

  private buildPdf(invoice: any, branch: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: {
          Title: `Tax Invoice ${invoice.invoiceNo}`,
          Author: branch?.name ?? "PharmERP",
        },
      });

      const buffers: Buffer[] = [];
      doc.on("data", (b: Buffer) => buffers.push(b));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const PW = doc.page.width - 80; // usable width
      const ML = 40;

      // ── Header band ──────────────────────────────────────────────────────
      doc.rect(ML, 30, PW, 70).fill(BLUE);

      doc
        .fillColor("white")
        .fontSize(18)
        .font("Helvetica-Bold")
        .text(branch?.name ?? "PharmERP", ML + 12, 44, { width: PW * 0.55 });

      doc
        .fontSize(8)
        .font("Helvetica")
        .text(branch?.address ?? "", ML + 12, 64, { width: PW * 0.55 })
        .text(
          [branch?.phone, branch?.email].filter(Boolean).join("  |  "),
          ML + 12,
          74,
          { width: PW * 0.55 },
        );

      doc
        .fontSize(16)
        .font("Helvetica-Bold")
        .fillColor("white")
        .text("TAX INVOICE", ML + PW * 0.58, 42, {
          width: PW * 0.42,
          align: "right",
        });

      doc.fillColor(BLACK);

      // ── Invoice meta box ─────────────────────────────────────────────────
      const metaY = 116;
      doc.rect(ML, metaY, PW, 58).strokeColor(DIVIDER).lineWidth(1).stroke();

      // Left: patient info
      const col1X = ML + 10;
      const col2X = ML + PW * 0.5 + 10;

      doc
        .fontSize(7.5)
        .font("Helvetica-Bold")
        .fillColor(GRAY)
        .text("BILLED TO", col1X, metaY + 8);

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(BLACK)
        .text(invoice.patient?.name ?? "Walk-in Customer", col1X, metaY + 18);

      if (invoice.patient?.phone) {
        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor(GRAY)
          .text(`Ph: ${invoice.patient.phone}`, col1X, metaY + 29);
      }

      if (invoice.patient?.address) {
        doc
          .fontSize(7.5)
          .text(invoice.patient.address, col1X, metaY + 39, {
            width: PW * 0.45,
          });
      }

      // Right: invoice details
      const fieldLabel = (label: string, value: string, y: number) => {
        doc
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .fillColor(GRAY)
          .text(label, col2X, y, { width: 80, align: "left" });
        doc
          .font("Helvetica")
          .fontSize(8.5)
          .fillColor(BLACK)
          .text(value, col2X + 82, y, { width: PW * 0.42, align: "left" });
      };

      fieldLabel("Invoice No:", invoice.invoiceNo, metaY + 8);
      fieldLabel("Date:", dateStr(invoice.createdAt), metaY + 20);
      fieldLabel("Status:", (invoice.status ?? "").toUpperCase(), metaY + 32);
      if (invoice.customerGstin) {
        fieldLabel("Customer GSTIN:", invoice.customerGstin, metaY + 44);
      }

      // ── Items table ───────────────────────────────────────────────────────
      const tableY = metaY + 68;
      const colWidths = [PW * 0.33, PW * 0.14, PW * 0.1, PW * 0.1, PW * 0.1, PW * 0.1, PW * 0.13];
      const headers = ["Medicine", "Batch / Expiry", "Qty", "MRP", "GST%", "Tax", "Total"];

      // Table header row
      doc.rect(ML, tableY, PW, 18).fill(LIGHT);
      doc.rect(ML, tableY, PW, 18).strokeColor(DIVIDER).lineWidth(0.5).stroke();

      let cx = ML;
      headers.forEach((h, i) => {
        doc
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .fillColor(GRAY)
          .text(h, cx + 4, tableY + 5, {
            width: colWidths[i]! - 6,
            align: i >= 2 ? "right" : "left",
          });
        cx += colWidths[i]!;
      });

      // Item rows
      let rowY = tableY + 18;
      const items: any[] = invoice.items ?? [];

      items.forEach((item: any, idx: number) => {
        const rowH = 22;
        if (idx % 2 === 0) {
          doc.rect(ML, rowY, PW, rowH).fill("#ffffff");
        } else {
          doc.rect(ML, rowY, PW, rowH).fill(LIGHT);
        }
        doc.rect(ML, rowY, PW, rowH).strokeColor(DIVIDER).lineWidth(0.3).stroke();

        const med = item.medicine;
        const taxAmt =
          Number(item.cgstAmt ?? 0) +
          Number(item.sgstAmt ?? 0) +
          Number(item.igstAmt ?? 0);

        const expiryLabel = item.batch?.expiryDate
          ? `Exp: ${dateStr(item.batch.expiryDate)}`
          : "";
        const batchLabel = item.batch?.batchNo ?? item.batchId?.slice(0, 8) ?? "--";

        const rowCols = [
          { text: med?.name ?? item.medicineId, align: "left" },
          { text: `${batchLabel}\n${expiryLabel}`, align: "left" },
          { text: String(item.quantity), align: "right" },
          { text: rupee(item.unitPrice), align: "right" },
          { text: `${item.taxPct ?? 0}%`, align: "right" },
          { text: rupee(taxAmt), align: "right" },
          { text: rupee(item.lineTotal), align: "right" },
        ];

        cx = ML;
        rowCols.forEach((col, i) => {
          doc
            .font("Helvetica")
            .fontSize(7.5)
            .fillColor(BLACK)
            .text(col.text, cx + 4, rowY + 4, {
              width: colWidths[i]! - 6,
              align: col.align as any,
            });
          cx += colWidths[i]!;
        });

        rowY += rowH;
      });

      // ── Totals section ────────────────────────────────────────────────────
      rowY += 8;
      const totLineX = ML + PW * 0.58;
      const totValX = ML + PW * 0.82;
      const totW = PW * 0.2;

      const totLine = (label: string, value: string, bold = false, color = BLACK) => {
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(bold ? 9 : 8)
          .fillColor(GRAY)
          .text(label, totLineX, rowY, { width: PW * 0.22, align: "left" });
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(bold ? 9 : 8)
          .fillColor(color)
          .text(value, totValX, rowY, { width: totW, align: "right" });
        rowY += 14;
      };

      totLine("Subtotal", rupee(invoice.subtotal));
      if (Number(invoice.discountAmount) > 0) {
        totLine("Discount", `- ${rupee(invoice.discountAmount)}`);
      }

      // GST breakdown
      const totalCgst = items.reduce((s: number, i: any) => s + Number(i.cgstAmt ?? 0), 0);
      const totalSgst = items.reduce((s: number, i: any) => s + Number(i.sgstAmt ?? 0), 0);
      const totalIgst = items.reduce((s: number, i: any) => s + Number(i.igstAmt ?? 0), 0);

      if (totalCgst > 0) totLine("CGST", rupee(totalCgst));
      if (totalSgst > 0) totLine("SGST", rupee(totalSgst));
      if (totalIgst > 0) totLine("IGST", rupee(totalIgst));

      // Separator
      doc
        .moveTo(totLineX, rowY)
        .lineTo(ML + PW, rowY)
        .strokeColor(DIVIDER)
        .lineWidth(0.5)
        .stroke();
      rowY += 6;

      totLine("GRAND TOTAL", rupee(invoice.totalAmount), true, BLUE);
      totLine("Amount Paid", rupee(invoice.amountPaid));
      if (Number(invoice.amountDue) > 0) {
        totLine("Balance Due", rupee(invoice.amountDue), false, "#dc2626");
      }

      // ── Payment details ───────────────────────────────────────────────────
      rowY += 8;
      if (invoice.payments?.length) {
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor(GRAY)
          .text("Payment Details:", ML, rowY);
        rowY += 12;

        invoice.payments.forEach((p: any) => {
          doc
            .font("Helvetica")
            .fontSize(7.5)
            .fillColor(BLACK)
            .text(
              `${(p.mode ?? "").toUpperCase()}  ${rupee(p.amount)}${p.referenceNo ? `  (Ref: ${p.referenceNo})` : ""}`,
              ML + 10,
              rowY,
            );
          rowY += 12;
        });
      }

      // ── Footer ────────────────────────────────────────────────────────────
      const footerY = doc.page.height - 55;
      doc.rect(ML, footerY, PW, 0.5).fill(DIVIDER);

      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor(GRAY)
        .text(
          "This is a computer-generated invoice. No signature required.",
          ML,
          footerY + 8,
          { width: PW * 0.6, align: "left" },
        );

      doc.text(
        `Generated on ${new Date().toLocaleString("en-IN")}`,
        ML + PW * 0.6,
        footerY + 8,
        { width: PW * 0.4, align: "right" },
      );

      // Rx stamp if prescription-linked
      if (invoice.prescriptionId) {
        doc
          .fontSize(7.5)
          .font("Helvetica-Bold")
          .fillColor("#7c3aed")
          .text(
            "Rx — Dispensed against verified prescription",
            ML,
            footerY + 20,
            { width: PW },
          );
      }

      doc.end();
    });
  }
}
