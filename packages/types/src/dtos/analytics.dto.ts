import { z } from "zod";

// ---------------------------------------------------------------------------
// ClickHouse event emitted per invoice line after a confirmed sale
// ---------------------------------------------------------------------------

export const saleEventSchema = z.object({
  invoiceId: z.string(),
  invoiceNo: z.string(),
  medicineId: z.string(),
  medicineName: z.string(),
  batchId: z.string(),
  quantity: z.number().int(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  taxAmount: z.number(),
  paymentMode: z.enum(["cash", "card", "upi", "insurance", "credit", "mixed"]),
  branchId: z.string(),
  staffId: z.string(),
  patientId: z.string().optional(),
  createdAt: z.string(), // ISO string — ClickHouse inserts as DateTime
});

export type SaleEventDto = z.infer<typeof saleEventSchema>;

// ---------------------------------------------------------------------------
// ABC Analysis response types
// ---------------------------------------------------------------------------

export const abcAnalysisRowSchema = z.object({
  medicineId: z.string(),
  medicineName: z.string(),
  revenue: z.number(),
  totalQty: z.number().int(),
  revenueShare: z.number(),  // 0–1 fraction of total revenue
  cumulativeShare: z.number(), // running cumulative share
  abcClass: z.enum(["A", "B", "C"]),
});

export type AbcAnalysisRowDto = z.infer<typeof abcAnalysisRowSchema>;

export const abcAnalysisResponseSchema = z.object({
  rows: z.array(abcAnalysisRowSchema),
  totals: z.object({
    totalRevenue: z.number(),
    totalProducts: z.number().int(),
    classACcount: z.number().int(),
    classBCount: z.number().int(),
    classCCount: z.number().int(),
  }),
});

export type AbcAnalysisResponseDto = z.infer<typeof abcAnalysisResponseSchema>;

// ---------------------------------------------------------------------------
// Hourly sales pattern (24 hours × 7 days heatmap)
// ---------------------------------------------------------------------------

export const hourlySalesRowSchema = z.object({
  hour: z.number().int().min(0).max(23),
  dayOfWeek: z.number().int().min(1).max(7), // 1=Mon … 7=Sun (ISO)
  invoiceCount: z.number().int(),
  revenue: z.number(),
});

export type HourlySalesRowDto = z.infer<typeof hourlySalesRowSchema>;

export const hourlySalesPatternResponseSchema = z.object({
  rows: z.array(hourlySalesRowSchema),
  peakHour: z.number().int(),
  peakDay: z.number().int(),
});

export type HourlySalesPatternResponseDto = z.infer<typeof hourlySalesPatternResponseSchema>;
