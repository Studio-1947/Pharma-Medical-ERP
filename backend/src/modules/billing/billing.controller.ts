import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { parse } from "json2csv";
import { BillingService } from "./billing.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { assertBranchAccess, resolveBranchScope, requireBranchScope } from "../../common/auth/branch-scope";
import {
  createInvoiceSchema,
  queryInvoiceSchema,
  voidInvoiceSchema,
  returnInvoiceSchema,
  recordPaymentSchema,
  queryPatientLedgerSchema,
  queryReceivablesAgingSchema
} from "@pharmerp/types";

@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("billing")
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get("invoices")
  @Roles("admin", "shop_manager", "doctor")
  findAll(@Query() q: unknown, @CurrentUser() user: JwtPayload) {
    const query = queryInvoiceSchema.parse(q);
    // Doctors get this route only to read one patient's billing history inside
    // a consultation. Without a patient to scope to, the same call returns
    // every sale in the system, which is not theirs to see.
    if (user.role === "doctor" && !query.patientId) {
      throw new ForbiddenException("Doctors must query invoices for a specific patient");
    }
    const branchId = resolveBranchScope(user, query.branchId);
    return this.service.findAll({ ...query, branchId });
  }

  @Get("invoices/:id")
  @Roles("admin", "shop_manager", "doctor")
  async findOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const invoice = await this.service.findOne(id);
    assertBranchAccess(user, invoice.data.branchId);
    return invoice;
  }

  @Post("invoices")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Create invoice — atomically decrements stock (FEFO)" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createInvoiceSchema.parse(body);
    // Revenue has to land in a branch: per-branch sales reporting and the GST
    // return both key off it. Passing user.branchId straight through left
    // super_admin invoices with no branch at all.
    const branchId = requireBranchScope(user, dto.branchId);
    return this.service.create(dto, user.sub, branchId);
  }

  @Post("invoices/:id/void")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Void invoice and return stock" })
  async voidInvoice(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const invoice = await this.service.findOne(id);
    assertBranchAccess(user, invoice.data.branchId);
    return this.service.voidInvoice(id, voidInvoiceSchema.parse(body), user.sub);
  }

  @Post("invoices/:id/return")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Create return invoice — restocks batches, creates refund payment" })
  async createReturn(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const invoice = await this.service.findOne(id);
    assertBranchAccess(user, invoice.data.branchId);
    return this.service.createReturn(id, returnInvoiceSchema.parse(body), user.sub);
  }

  @Post("payments")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Record a payment against an invoice" })
  async recordPayment(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = recordPaymentSchema.parse(body);
    const invoice = await this.service.findOne(dto.invoiceId);
    assertBranchAccess(user, invoice.data.branchId);
    return this.service.recordPayment(dto, user.sub);
  }

  @Get("invoices/:id/pdf")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Get presigned download URL for invoice PDF" })
  async getPdf(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const invoice = await this.service.findOne(id);
    assertBranchAccess(user, invoice.data.branchId);
    return this.service.getPdfUrl(id);
  }

  // ─── Receivables ─────────────────────────────────────────────────────────────

  @Get("receivables/aging")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Receivables aging — open customer dues banded by days outstanding" })
  async receivablesAging(@Query() q: unknown, @CurrentUser() user: JwtPayload, @Res() res: FastifyReply) {
    const query = queryReceivablesAgingSchema.parse(q);
    const branchId = resolveBranchScope(user, query.branchId);
    const aging = await this.service.getReceivablesAging({ ...query, branchId });

    if (query.format === "csv") {
      const fields = [
        "patientName",
        "patientPhone",
        "current",
        "d1_30",
        "d31_60",
        "d61_90",
        "d90plus",
        "overdue",
        "total",
        "invoiceCount",
        "overdueInvoiceCount",
        "oldestInvoiceDate",
      ];
      const csv = parse(aging.patients, { fields });
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="receivables-aging.csv"`);
      return res.send(csv);
    }

    return res.send({ data: aging });
  }

  @Get("patients/:id/ledger")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "Patient account statement — invoices and payments with running balance" })
  async patientLedger(@Param("id") id: string, @Query() q: unknown, @Res() res: FastifyReply) {
    const query = queryPatientLedgerSchema.parse(q);
    const ledger = await this.service.getPatientLedger(id, query);

    if (query.format === "csv") {
      const fields = ["date", "type", "reference", "debit", "credit", "balance"];
      const csv = parse(ledger.entries, { fields });
      res.header("Content-Type", "text/csv");
      res.header("Content-Disposition", `attachment; filename="patient-ledger-${id}.csv"`);
      return res.send(csv);
    }

    return res.send({ data: ledger });
  }

  @Get("reports/end-of-day")
  @Roles("admin", "shop_manager")
  @ApiOperation({ summary: "End-of-day sales summary for a branch" })
  eod(
    @CurrentUser() user: JwtPayload,
    @Query("branchId") branchId?: string,
    @Query("date") date?: string,
  ) {
    const scoped = resolveBranchScope(user, branchId);
    return this.service.endOfDaySummary(scoped, date);
  }
}
