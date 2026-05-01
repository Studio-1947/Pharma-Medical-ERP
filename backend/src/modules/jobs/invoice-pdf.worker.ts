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

@Processor("pdf-generation")
export class InvoicePdfWorker {
  private readonly logger = new Logger(InvoicePdfWorker.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly s3Service: S3Service,
  ) {}

  @Process()
  async handleGeneratePdf(job: Job<GeneratePdfJobData>) {
    this.logger.log(`Starting PDF generation for invoice ${job.data.invoiceId}...`);
    
    const db = this.drizzle.db;

    const [invoice] = await db
      .select()
      .from(schema.salesInvoices)
      .where(eq(schema.salesInvoices.id, job.data.invoiceId));

    if (!invoice) {
      this.logger.error(`Invoice ${job.data.invoiceId} not found.`);
      return;
    }

    try {
      // 1. Generate PDF in memory
      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        doc.fontSize(20).text("TAX INVOICE", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`Invoice No: ${invoice.invoiceNo}`);
        doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`);
        doc.text(`Total Amount: Rs. ${invoice.totalAmount}`);
        doc.text(`Payment Mode: ${invoice.paymentMode}`);
        doc.moveDown();
        doc.text("Thank you for your purchase!");
        
        doc.end();
      });

      // 2. Upload to MinIO
      const key = `invoices/${invoice.invoiceNo}-${Date.now()}.pdf`;
      await this.s3Service.upload(pdfBuffer, key, "application/pdf");

      // 3. Update invoice record
      await db
        .update(schema.salesInvoices)
        .set({ pdfUrl: key })
        .where(eq(schema.salesInvoices.id, invoice.id));

      this.logger.log(`Generated and uploaded PDF for invoice ${invoice.invoiceNo} successfully.`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to generate PDF for invoice ${invoice.invoiceNo}: ${err.message}`);
      throw error;
    }
  }
}
