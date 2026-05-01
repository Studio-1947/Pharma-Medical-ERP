import { Injectable } from "@nestjs/common";
import { and, between, eq, inArray, sql } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

@Injectable()
export class ReportsService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async getGstData(branchId: string, month: number, year: number) {
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();

    const results = await this.db
      .select({
        invoiceNo: schema.salesInvoices.invoiceNo,
        date: schema.salesInvoices.createdAt,
        customerGstin: schema.salesInvoices.customerGstin,
        itemName: schema.medicines.name,
        hsnCode: schema.medicines.hsnCode,
        quantity: schema.salesInvoiceItems.quantity,
        unitPrice: schema.salesInvoiceItems.unitPrice,
        taxableAmount: sql<number>`CAST(${schema.salesInvoiceItems.lineTotal} AS FLOAT) - CAST(${schema.salesInvoiceItems.cgstAmt} AS FLOAT) - CAST(${schema.salesInvoiceItems.sgstAmt} AS FLOAT) - CAST(${schema.salesInvoiceItems.igstAmt} AS FLOAT)`,
        cgstAmount: schema.salesInvoiceItems.cgstAmt,
        sgstAmount: schema.salesInvoiceItems.sgstAmt,
        igstAmount: schema.salesInvoiceItems.igstAmt,
        totalAmount: schema.salesInvoiceItems.lineTotal,
      })
      .from(schema.salesInvoices)
      .innerJoin(
        schema.salesInvoiceItems,
        eq(schema.salesInvoices.id, schema.salesInvoiceItems.invoiceId),
      )
      .innerJoin(
        schema.medicines,
        eq(schema.salesInvoiceItems.medicineId, schema.medicines.id),
      )
      .where(
        and(
          eq(schema.salesInvoices.branchId, branchId),
          eq(schema.salesInvoices.status, "confirmed"),
          between(schema.salesInvoices.createdAt, new Date(startDate), new Date(endDate)),
        ),
      );

    return results.map(r => ({
      ...r,
      date: r.date.toISOString().split("T")[0],
    }));
  }

  async getScheduleHData(branchId: string, fromDate: string, toDate: string) {
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);

    const results = await this.db
      .select({
        date: schema.salesInvoices.createdAt,
        invoiceNo: schema.salesInvoices.invoiceNo,
        drugName: schema.medicines.name,
        scheduleClass: schema.medicines.scheduleClass,
        batchId: schema.salesInvoiceItems.batchId,
        quantity: schema.salesInvoiceItems.quantity,
        patientName: schema.patients.name,
        doctorName: schema.prescriptions.doctorName,
        doctorRegNo: schema.prescriptions.doctorRegNo,
      })
      .from(schema.salesInvoices)
      .innerJoin(
        schema.salesInvoiceItems,
        eq(schema.salesInvoices.id, schema.salesInvoiceItems.invoiceId),
      )
      .innerJoin(
        schema.medicines,
        eq(schema.salesInvoiceItems.medicineId, schema.medicines.id),
      )
      .leftJoin(
        schema.patients,
        eq(schema.salesInvoices.patientId, schema.patients.id),
      )
      .leftJoin(
        schema.prescriptions,
        eq(schema.salesInvoices.prescriptionId, schema.prescriptions.id),
      )
      .where(
        and(
          eq(schema.salesInvoices.branchId, branchId),
          eq(schema.salesInvoices.status, "confirmed"),
          between(schema.salesInvoices.createdAt, start, end),
          inArray(schema.medicines.scheduleClass, ["SCHEDULE_H", "SCHEDULE_H1", "SCHEDULE_X"]),
        ),
      );

    // Fetch batch numbers to enrich data
    const batchIds = [...new Set(results.map(r => r.batchId))];
    let batchMap: Record<string, string> = {};
    if (batchIds.length > 0) {
      const batches = await this.db
        .select({ id: schema.inventoryBatches.id, batchNo: schema.inventoryBatches.batchNo })
        .from(schema.inventoryBatches)
        .where(inArray(schema.inventoryBatches.id, batchIds));
      
      batchMap = batches.reduce((acc, curr) => {
        acc[curr.id] = curr.batchNo;
        return acc;
      }, {} as Record<string, string>);
    }

    return results.map(r => ({
      date: r.date.toISOString().split("T")[0],
      invoiceNo: r.invoiceNo,
      drugName: r.drugName,
      scheduleClass: r.scheduleClass,
      batchNo: batchMap[r.batchId!] || "N/A",
      quantity: r.quantity,
      patientName: r.patientName || "N/A",
      doctorName: r.doctorName || "N/A",
      doctorRegNo: r.doctorRegNo || "N/A",
    }));
  }
}
