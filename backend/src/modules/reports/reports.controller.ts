import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyReply } from "fastify";
import { ReportsService } from "./reports.service";
import { ExcelExportService } from "./excel-export.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope, requireBranchScope } from "../../common/auth/branch-scope";
import { parse } from "json2csv";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("reports")
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly excelExportService: ExcelExportService,
  ) {}

  @Get("branch-comparison")
  // Deliberately not open to reports_analyst: this is the one report that shows
  // every branch's numbers side by side, which is an org-wide view.
  @Roles("super_admin", "admin")
  @ApiOperation({
    summary: "Per-branch revenue, stock and expiry side by side, plus totals",
  })
  getBranchComparison(
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    return this.service.getBranchComparison(
      from || defaultFrom.toISOString().slice(0, 10),
      to || today,
    );
  }

  @Get("sales")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Sales trend for the last N days, grouped by day/week/month" })
  getSalesTrend(
    @CurrentUser() user: JwtPayload,
    @Query("days") days = "30",
    @Query("branchId") branchId?: string,
    @Query("groupBy") groupBy: "day" | "week" | "month" = "day",
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.getSalesTrend(parseInt(days), scoped, groupBy);
  }

  @Get("summary")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Aggregate revenue + invoice count for the last N days" })
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query("days") days = "30",
    @Query("branchId") branchId?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.getSummary(parseInt(days), scoped);
  }

  @Get("top-products")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Top N products by revenue" })
  getTopProducts(
    @CurrentUser() user: JwtPayload,
    @Query("days") days = "30",
    @Query("limit") limit = "5",
    @Query("branchId") branchId?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.getTopProducts(parseInt(days), parseInt(limit), scoped);
  }

  @Get("payment-methods")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Payment method revenue breakdown" })
  getPaymentMethods(
    @CurrentUser() user: JwtPayload,
    @Query("days") days = "30",
    @Query("branchId") branchId?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.getPaymentMethodBreakdown(parseInt(days), scoped);
  }

  @Get("purchase")
  @Roles("admin", "pharmacist", "reports_analyst", "inventory_manager")
  @ApiOperation({ summary: "Purchase order summary for a date range" })
  getPurchaseSummary(
    @CurrentUser() user: JwtPayload,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const scoped = resolveBranchScope(user, branchId);
    return this.service.getPurchaseSummary(from || today, to || today, scoped);
  }

  @Get("gst")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Export GSTR-1 data as CSV" })
  async getGstReport(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId: string,
    @Query("month") month: string,
    @Query("year") year: string,
    @Query("format") format: string,
    @Res() res: FastifyReply,
  ) {
    const scoped = requireBranchScope(user, branchId);
    const data = await this.service.getGstData(scoped, parseInt(month), parseInt(year));

    if (format === "csv") {
      const csv = parse(data);
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="gstr1-${year}-${month}.csv"`);
      return res.send(csv);
    }

    return res.send({ data });
  }

  @Get("gst/gstr1-json")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Download GSTR-1 return in official Government GST Portal JSON format" })
  async getGstr1Json(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId: string,
    @Query("month") month: string,
    @Query("year") year: string,
    @Res() res: FastifyReply,
  ) {
    const scoped = requireBranchScope(user, branchId);
    const json = await this.service.getGstr1GovernmentJson(scoped, parseInt(month), parseInt(year));

    res.header("Content-Type", "application/json");
    res.header("Content-Disposition", `attachment; filename="GSTR1_${json.gstin}_${json.fp}.json"`);
    return res.send(JSON.stringify(json, null, 2));
  }

  @Get("export/excel")
  @Roles("admin", "pharmacist", "reports_analyst")
  @ApiOperation({ summary: "Export report as styled .xlsx Excel spreadsheet" })
  async exportExcel(
    @CurrentUser() user: JwtPayload,
    @Query("type") type: string,
    @Query("branchId") branchId: string,
    @Res() res: FastifyReply,
    @Query("month") month?: string,
    @Query("year") year?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    let title = "Report";
    let columns: any[] = [];
    let rows: any[] = [];

    if (type === "gst") {
      const m = parseInt(month || "8");
      const y = parseInt(year || "2026");
      title = `GSTR-1 Tax Register (${m}-${y})`;
      rows = await this.service.getGstData(scoped || branchId, m, y);
      columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Invoice No", key: "invoiceNo", width: 20 },
        { header: "Customer GSTIN", key: "customerGstin", width: 18 },
        { header: "Item Name", key: "itemName", width: 25 },
        { header: "HSN Code", key: "hsnCode", width: 12 },
        { header: "Qty", key: "quantity", width: 10 },
        { header: "Taxable Amt", key: "taxableAmount", width: 16, numFmt: "₹#,##0.00" },
        { header: "CGST Amt", key: "cgstAmount", width: 14, numFmt: "₹#,##0.00" },
        { header: "SGST Amt", key: "sgstAmount", width: 14, numFmt: "₹#,##0.00" },
        { header: "IGST Amt", key: "igstAmount", width: 14, numFmt: "₹#,##0.00" },
        { header: "Total Amt", key: "totalAmount", width: 16, numFmt: "₹#,##0.00" },
      ];
    } else if (type === "scheduleH") {
      const f = from || new Date().toISOString().slice(0, 10);
      const t = to || new Date().toISOString().slice(0, 10);
      title = `Schedule H Register (${f} to ${t})`;
      rows = await this.service.getScheduleHData(scoped || branchId, f, t);
      columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Invoice No", key: "invoiceNo", width: 18 },
        { header: "Drug Name", key: "drugName", width: 25 },
        { header: "Class", key: "scheduleClass", width: 15 },
        { header: "Batch No", key: "batchNo", width: 15 },
        { header: "Qty", key: "quantity", width: 10 },
        { header: "Patient Name", key: "patientName", width: 20 },
        { header: "Doctor Name", key: "doctorName", width: 20 },
        { header: "Doctor Reg No", key: "doctorRegNo", width: 16 },
      ];
    } else {
      title = "Sales Trend Report";
      const trend = await this.service.getSalesTrend(30, scoped);
      rows = trend.rows;
      columns = [
        { header: "Date", key: "date", width: 16 },
        { header: "Invoices", key: "invoices", width: 12 },
        { header: "Revenue (₹)", key: "revenue", width: 18, numFmt: "₹#,##0.00" },
      ];
    }

    const buffer = await this.excelExportService.generateExcelBuffer(title, columns, rows);

    res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.header("Content-Disposition", `attachment; filename="${type}-report.xlsx"`);
    return res.send(buffer);
  }

  @Get("abc-analysis")
  @Roles("admin", "reports_analyst")
  @ApiOperation({ summary: "ABC product analysis (A=top 70% revenue, B=next 20%, C=bottom 10%) — powered by ClickHouse" })
  getAbcAnalysis(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId: string,
    @Query("days") days = "90",
  ) {
    const scoped = requireBranchScope(user, branchId);
    return this.service.getAbcAnalysis(scoped, parseInt(days));
  }

  @Get("hourly-pattern")
  @Roles("admin", "reports_analyst")
  @ApiOperation({ summary: "24h × 7-day sales heatmap — powered by ClickHouse" })
  getHourlySalesPattern(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId: string,
    @Query("days") days = "30",
  ) {
    const scoped = requireBranchScope(user, branchId);
    return this.service.getHourlySalesPattern(scoped, parseInt(days));
  }

  @Get("schedule-h-register")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Export Schedule H dispensing register as CSV" })
  async getScheduleHReport(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId: string,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("format") format: string,
    @Res() res: FastifyReply,
  ) {
    const scoped = requireBranchScope(user, branchId);
    const data = await this.service.getScheduleHData(scoped, from, to);

    if (format === "csv") {
      const csv = parse(data);
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="schedule-h-${from}-to-${to}.csv"`);
      return res.send(csv);
    }

    return res.send({ data });
  }
}
