import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import type { SaleEventDto, AbcAnalysisResponseDto, HourlySalesPatternResponseDto } from "@pharmerp/types";

@Injectable()
export class ClickHouseService implements OnModuleInit {
  private readonly logger = new Logger(ClickHouseService.name);
  private client!: ClickHouseClient;
  private available = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>("CLICKHOUSE_URL", "http://localhost:8123");
    const database = this.config.get<string>("CLICKHOUSE_DB", "pharmerp_analytics");

    this.client = createClient({ url, database });

    try {
      await this.client.ping();
      await this.ensureSchema(database);
      this.available = true;
      this.logger.log(`ClickHouse connected at ${url}`);
    } catch (err) {
      this.logger.warn(`ClickHouse unavailable — analytics events will be silently dropped (${(err as Error).message})`);
    }
  }

  private async ensureSchema(database: string) {
    await this.client.exec({
      query: `CREATE DATABASE IF NOT EXISTS \`${database}\``,
    });

    await this.client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS \`${database}\`.sale_events (
          event_id     UUID       DEFAULT generateUUIDv4(),
          invoice_id   String,
          invoice_no   String,
          medicine_id  String,
          medicine_name String,
          batch_id     String,
          quantity     UInt32,
          unit_price   Float64,
          line_total   Float64,
          tax_amount   Float64,
          payment_mode LowCardinality(String),
          branch_id    String,
          staff_id     String,
          patient_id   String    DEFAULT '',
          created_at   DateTime  DEFAULT now()
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (branch_id, created_at, medicine_id)
      `,
    });
  }

  // Fire-and-forget safe wrapper — never throws to caller
  async insertSaleEvents(events: SaleEventDto[]): Promise<void> {
    if (!this.available || events.length === 0) return;

    try {
      await this.client.insert({
        table: "sale_events",
        values: events.map((e) => ({
          invoice_id: e.invoiceId,
          invoice_no: e.invoiceNo,
          medicine_id: e.medicineId,
          medicine_name: e.medicineName,
          batch_id: e.batchId,
          quantity: e.quantity,
          unit_price: e.unitPrice,
          line_total: e.lineTotal,
          tax_amount: e.taxAmount,
          payment_mode: e.paymentMode,
          branch_id: e.branchId,
          staff_id: e.staffId,
          patient_id: e.patientId ?? "",
          created_at: e.createdAt,
        })),
        format: "JSONEachRow",
      });
    } catch (err) {
      this.logger.error(`ClickHouse insert failed: ${(err as Error).message}`);
    }
  }

  async getAbcAnalysis(branchId: string, days: number): Promise<AbcAnalysisResponseDto> {
    if (!this.available) return { rows: [], totals: { totalRevenue: 0, totalProducts: 0, classACcount: 0, classBCount: 0, classCCount: 0 } };

    const result = await this.client.query({
      query: `
        WITH
          total AS (
            SELECT sum(line_total) AS total_revenue
            FROM sale_events
            WHERE branch_id = {branchId: String}
              AND created_at >= now() - INTERVAL {days: UInt32} DAY
          ),
          ranked AS (
            SELECT
              medicine_id,
              medicine_name,
              sum(line_total)  AS revenue,
              sum(quantity)    AS total_qty,
              sum(line_total) / (SELECT total_revenue FROM total) AS revenue_share
            FROM sale_events
            WHERE branch_id = {branchId: String}
              AND created_at >= now() - INTERVAL {days: UInt32} DAY
            GROUP BY medicine_id, medicine_name
            ORDER BY revenue DESC
          )
        SELECT
          medicine_id,
          medicine_name,
          revenue,
          total_qty,
          revenue_share,
          sum(revenue_share) OVER (ORDER BY revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_share,
          CASE
            WHEN sum(revenue_share) OVER (ORDER BY revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) <= 0.7 THEN 'A'
            WHEN sum(revenue_share) OVER (ORDER BY revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) <= 0.9 THEN 'B'
            ELSE 'C'
          END AS abc_class
        FROM ranked
      `,
      query_params: { branchId, days },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      medicine_id: string;
      medicine_name: string;
      revenue: number;
      total_qty: number;
      revenue_share: number;
      cumulative_share: number;
      abc_class: "A" | "B" | "C";
    }>;

    const mapped = rows.map((r) => ({
      medicineId: r.medicine_id,
      medicineName: r.medicine_name,
      revenue: Number(r.revenue),
      totalQty: Number(r.total_qty),
      revenueShare: Number(r.revenue_share),
      cumulativeShare: Number(r.cumulative_share),
      abcClass: r.abc_class,
    }));

    const totalRevenue = mapped.reduce((s, r) => s + r.revenue, 0);
    return {
      rows: mapped,
      totals: {
        totalRevenue,
        totalProducts: mapped.length,
        classACcount: mapped.filter((r) => r.abcClass === "A").length,
        classBCount: mapped.filter((r) => r.abcClass === "B").length,
        classCCount: mapped.filter((r) => r.abcClass === "C").length,
      },
    };
  }

  async getHourlySalesPattern(branchId: string, days: number): Promise<HourlySalesPatternResponseDto> {
    if (!this.available) return { rows: [], peakHour: 0, peakDay: 1 };

    const result = await this.client.query({
      query: `
        SELECT
          toHour(created_at)      AS hour,
          toDayOfWeek(created_at) AS day_of_week,
          count()                 AS invoice_count,
          sum(line_total)         AS revenue
        FROM sale_events
        WHERE branch_id = {branchId: String}
          AND created_at >= now() - INTERVAL {days: UInt32} DAY
        GROUP BY hour, day_of_week
        ORDER BY day_of_week, hour
      `,
      query_params: { branchId, days },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      hour: number;
      day_of_week: number;
      invoice_count: number;
      revenue: number;
    }>;

    const mapped = rows.map((r) => ({
      hour: Number(r.hour),
      dayOfWeek: Number(r.day_of_week),
      invoiceCount: Number(r.invoice_count),
      revenue: Number(r.revenue),
    }));

    const peak = mapped.reduce((best, r) => (r.revenue > best.revenue ? r : best), { hour: 0, dayOfWeek: 1, revenue: 0, invoiceCount: 0 });

    return { rows: mapped, peakHour: peak.hour, peakDay: peak.dayOfWeek };
  }
}
