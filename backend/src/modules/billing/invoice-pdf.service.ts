import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { eq } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { S3Service } from "../../common/s3/s3.service";

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

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly s3: S3Service,
  ) {}

  async generateAndUpload(invoiceId: string): Promise<string> {
    const db = this.drizzle.db;

    const invoice = await db.query.salesInvoices.findFirst({
      where: eq(schema.salesInvoices.id, invoiceId),
      with: {
        items: { with: { medicine: true, batch: true } },
        patient: true,
        payments: true,
      },
    });

    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    const [branch] = invoice.branchId
      ? await db.select().from(schema.branches).where(eq(schema.branches.id, invoice.branchId))
      : [];

    const pdfBuffer = await this.buildPdf(invoice, branch ?? null);
    const key = `invoices/${invoice.invoiceNo}-${Date.now()}.pdf`;

    await this.s3.upload(pdfBuffer, key, "application/pdf");

    await db
      .update(schema.salesInvoices)
      .set({ pdfUrl: key })
      .where(eq(schema.salesInvoices.id, invoice.id));

    this.logger.log(`PDF generated and uploaded for ${invoice.invoiceNo} → ${key}`);
    return key;
  }

  private buildPdf(invoice: any, branch: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 30, bottom: 10, left: 35, right: 35 },
        bufferPages: true,
        info: {
          Title: `Tax Invoice ${invoice.invoiceNo}`,
          Author: branch?.name ?? "PharmERP",
        },
      });

      const buffers: Buffer[] = [];
      doc.on("data", (b: Buffer) => buffers.push(b));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const ML = 35;
      const PW = doc.page.width - ML * 2;
      const PAGE_BOTTOM = doc.page.height - 70;

      const drawHeader = (headerY: number) => {
        doc.rect(ML, headerY, PW, 65).fill(BLUE);
        doc.fillColor("white").fontSize(18).font("Helvetica-Bold")
          .text(branch?.name ?? "PharmERP", ML + 12, headerY + 14, { width: PW * 0.55, lineBreak: false });
        doc.fontSize(8).font("Helvetica")
          .text(branch?.address ?? "", ML + 12, headerY + 34, { width: PW * 0.55, lineBreak: false })
          .text([branch?.phone, branch?.email].filter(Boolean).join("  |  "), ML + 12, headerY + 44, { width: PW * 0.55, lineBreak: false });
        doc.fontSize(16).font("Helvetica-Bold").fillColor("white")
          .text("TAX INVOICE", ML + PW * 0.58, headerY + 14, { width: PW * 0.42, align: "right", lineBreak: false });
        doc.fillColor(BLACK);
      };

      drawHeader(30);

      const metaY = 105;
      doc.rect(ML, metaY, PW, 54).strokeColor(DIVIDER).lineWidth(1).stroke();
      const col1X = ML + 10;
      const col2X = ML + PW * 0.5 + 10;

      doc.fontSize(7.5).font("Helvetica-Bold").fillColor(GRAY).text("BILLED TO", col1X, metaY + 6, { lineBreak: false });
      doc.fontSize(9).font("Helvetica-Bold").fillColor(BLACK)
        .text(invoice.patient?.name ?? "Walk-in Customer", col1X, metaY + 16, { lineBreak: false });
      if (invoice.patient?.phone) {
        doc.fontSize(8).font("Helvetica").fillColor(GRAY).text(`Ph: ${invoice.patient.phone}`, col1X, metaY + 27, { lineBreak: false });
      }

      const fieldLabel = (label: string, value: string, y: number) => {
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRAY).text(label, col2X, y, { width: 80, lineBreak: false });
        doc.font("Helvetica").fontSize(8.5).fillColor(BLACK).text(value, col2X + 82, y, { width: PW * 0.42, lineBreak: false });
      };
      fieldLabel("Invoice No:", invoice.invoiceNo, metaY + 6);
      fieldLabel("Date:", dateStr(invoice.createdAt), metaY + 18);
      fieldLabel("Status:", (invoice.status ?? "").toUpperCase(), metaY + 30);

      const colWidths = [PW * 0.33, PW * 0.14, PW * 0.1, PW * 0.1, PW * 0.1, PW * 0.1, PW * 0.13];
      const headers = ["Medicine", "Batch / Expiry", "Qty", "MRP", "GST%", "Tax", "Total"];

      const drawTableHeader = (tableY: number) => {
        doc.rect(ML, tableY, PW, 18).fill(LIGHT);
        doc.rect(ML, tableY, PW, 18).strokeColor(DIVIDER).lineWidth(0.5).stroke();
        let cx = ML;
        headers.forEach((h, i) => {
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRAY)
            .text(h, cx + 4, tableY + 5, { width: colWidths[i]! - 6, align: i >= 2 ? "right" : "left", lineBreak: false });
          cx += colWidths[i]!;
        });
        return tableY + 18;
      };

      let rowY = drawTableHeader(metaY + 64);
      const items: any[] = invoice.items ?? [];

      items.forEach((item: any, idx: number) => {
        const rowH = 22;
        if (rowY + rowH > PAGE_BOTTOM) {
          doc.addPage();
          rowY = drawTableHeader(30);
        }

        doc.rect(ML, rowY, PW, rowH).fill(idx % 2 === 0 ? "#ffffff" : LIGHT);
        doc.rect(ML, rowY, PW, rowH).strokeColor(DIVIDER).lineWidth(0.3).stroke();
        const taxAmt = Number(item.cgstAmt ?? 0) + Number(item.sgstAmt ?? 0) + Number(item.igstAmt ?? 0);
        const batchLabel = item.batch?.batchNo ?? item.batchId?.slice(0, 8) ?? "--";
        const expiryLabel = item.batch?.expiryDate ? `Exp: ${dateStr(item.batch.expiryDate)}` : "";
        const rowCols = [
          // Service lines (consultation fee) carry no medicine row — fall back
          // to the description stored on the line itself.
          { text: item.itemName ?? item.medicine?.name ?? item.medicineId, align: "left" },
          { text: `${batchLabel}\n${expiryLabel}`, align: "left" },
          { text: String(item.quantity), align: "right" },
          { text: rupee(item.unitPrice), align: "right" },
          { text: `${item.taxPct ?? 0}%`, align: "right" },
          { text: rupee(taxAmt), align: "right" },
          { text: rupee(item.lineTotal), align: "right" },
        ];
        let cx = ML;
        rowCols.forEach((col, i) => {
          doc.font("Helvetica").fontSize(7.5).fillColor(BLACK)
            .text(col.text, cx + 4, rowY + 3, { width: colWidths[i]! - 6, align: col.align as any });
          cx += colWidths[i]!;
        });
        rowY += rowH;
      });

      rowY += 8;
      if (rowY + 100 > PAGE_BOTTOM) {
        doc.addPage();
        rowY = 30;
      }

      const totLineX = ML + PW * 0.58;
      const totValX = ML + PW * 0.82;
      const totW = PW * 0.18;
      const totLine = (label: string, value: string, bold = false, color = BLACK) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 9 : 8).fillColor(GRAY)
          .text(label, totLineX, rowY, { width: PW * 0.22, lineBreak: false });
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 9 : 8).fillColor(color)
          .text(value, totValX, rowY, { width: totW, align: "right", lineBreak: false });
        rowY += 14;
      };

      totLine("Subtotal", rupee(invoice.subtotal));
      if (Number(invoice.discountAmount) > 0) totLine("Discount", `- ${rupee(invoice.discountAmount)}`);

      const totalCgst = items.reduce((s: number, i: any) => s + Number(i.cgstAmt ?? 0), 0);
      const totalSgst = items.reduce((s: number, i: any) => s + Number(i.sgstAmt ?? 0), 0);
      const totalIgst = items.reduce((s: number, i: any) => s + Number(i.igstAmt ?? 0), 0);
      if (totalCgst > 0) totLine("CGST", rupee(totalCgst));
      if (totalSgst > 0) totLine("SGST", rupee(totalSgst));
      if (totalIgst > 0) totLine("IGST", rupee(totalIgst));

      doc.moveTo(totLineX, rowY).lineTo(ML + PW, rowY).strokeColor(DIVIDER).lineWidth(0.5).stroke();
      rowY += 6;
      totLine("GRAND TOTAL", rupee(invoice.totalAmount), true, BLUE);
      totLine("Amount Paid", rupee(invoice.amountPaid));
      if (Number(invoice.amountDue) > 0) totLine("Balance Due", rupee(invoice.amountDue), false, "#dc2626");

      rowY += 6;
      if (invoice.payments?.length) {
        if (rowY + 30 > PAGE_BOTTOM) {
          doc.addPage();
          rowY = 30;
        }
        doc.font("Helvetica-Bold").fontSize(8).fillColor(GRAY).text("Payment Details:", ML, rowY, { lineBreak: false });
        rowY += 12;
        invoice.payments.forEach((p: any) => {
          doc.font("Helvetica").fontSize(7.5).fillColor(BLACK)
            .text(
              `${(p.mode ?? "").toUpperCase()}  ${rupee(p.amount)}${p.referenceNo ? `  (Ref: ${p.referenceNo})` : ""}`,
              ML + 10, rowY, { lineBreak: false }
            );
          rowY += 12;
        });
      }

      // Draw footer on all pages using bufferPages
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const footerY = doc.page.height - 45;
        doc.rect(ML, footerY, PW, 0.5).fill(DIVIDER);
        doc.fontSize(7).font("Helvetica").fillColor(GRAY)
          .text("This is a computer-generated invoice. No signature required.", ML, footerY + 8, { width: PW * 0.6, lineBreak: false });
        doc.text(`Generated on ${new Date().toLocaleString("en-IN")}`, ML + PW * 0.6, footerY + 8, { width: PW * 0.4, align: "right", lineBreak: false });
        if (invoice.prescriptionId) {
          doc.fontSize(7.5).font("Helvetica-Bold").fillColor("#7c3aed")
            .text("Rx — Dispensed against verified prescription", ML, footerY + 20, { width: PW * 0.6, lineBreak: false });
        }
        if (range.count > 1) {
          doc.fontSize(7).font("Helvetica").fillColor(GRAY)
            .text(`Page ${i + 1} of ${range.count}`, ML + PW * 0.6, footerY + 20, { width: PW * 0.4, align: "right", lineBreak: false });
        }
      }

      doc.end();
    });
  }
}
