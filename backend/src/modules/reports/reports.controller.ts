import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyReply } from "fastify";
import { ReportsService } from "./reports.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { parse } from "json2csv";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("reports")
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get("sales")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Sales trend for the last N days, grouped by day/week/month" })
  getSalesTrend(
    @Query("days") days = "30",
    @Query("branchId") branchId?: string,
    @Query("groupBy") groupBy: "day" | "week" | "month" = "day",
  ) {
    return this.service.getSalesTrend(parseInt(days), branchId, groupBy);
  }

  @Get("summary")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Aggregate revenue + invoice count for the last N days" })
  getSummary(
    @Query("days") days = "30",
    @Query("branchId") branchId?: string,
  ) {
    return this.service.getSummary(parseInt(days), branchId);
  }

  @Get("top-products")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Top N products by revenue" })
  getTopProducts(
    @Query("days") days = "30",
    @Query("limit") limit = "5",
    @Query("branchId") branchId?: string,
  ) {
    return this.service.getTopProducts(parseInt(days), parseInt(limit), branchId);
  }

  @Get("payment-methods")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Payment method revenue breakdown" })
  getPaymentMethods(
    @Query("days") days = "30",
    @Query("branchId") branchId?: string,
  ) {
    return this.service.getPaymentMethodBreakdown(parseInt(days), branchId);
  }

  @Get("purchase")
  @Roles("admin", "pharmacist", "reports_analyst", "inventory_manager")
  @ApiOperation({ summary: "Purchase order summary for a date range" })
  getPurchaseSummary(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("warehouseId") warehouseId?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    return this.service.getPurchaseSummary(from || today, to || today, warehouseId);
  }

  @Get("gst")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Export GSTR-1 data as CSV" })
  async getGstReport(
    @Query("branchId") branchId: string,
    @Query("month") month: string,
    @Query("year") year: string,
    @Query("format") format: string,
    @Res() res: FastifyReply,
  ) {
    const data = await this.service.getGstData(branchId, parseInt(month), parseInt(year));
    
    if (format === "csv") {
      const csv = parse(data);
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="gstr1-${year}-${month}.csv"`);
      return res.send(csv);
    }

    return res.send({ data });
  }

  @Get("abc-analysis")
  @Roles("admin", "reports_analyst")
  @ApiOperation({ summary: "ABC product analysis (A=top 70% revenue, B=next 20%, C=bottom 10%) — powered by ClickHouse" })
  getAbcAnalysis(
    @Query("branchId") branchId: string,
    @Query("days") days = "90",
  ) {
    return this.service.getAbcAnalysis(branchId, parseInt(days));
  }

  @Get("hourly-pattern")
  @Roles("admin", "reports_analyst")
  @ApiOperation({ summary: "24h × 7-day sales heatmap — powered by ClickHouse" })
  getHourlySalesPattern(
    @Query("branchId") branchId: string,
    @Query("days") days = "30",
  ) {
    return this.service.getHourlySalesPattern(branchId, parseInt(days));
  }

  @Get("schedule-h-register")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Export Schedule H dispensing register as CSV" })
  async getScheduleHReport(
    @Query("branchId") branchId: string,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("format") format: string,
    @Res() res: FastifyReply,
  ) {
    const data = await this.service.getScheduleHData(branchId, from, to);
    
    if (format === "csv") {
      const csv = parse(data);
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="schedule-h-${from}-to-${to}.csv"`);
      return res.send(csv);
    }

    return res.send({ data });
  }
}
