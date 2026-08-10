import { Body, Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BillingService } from "./billing.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Public } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope, requireBranchScope } from "../../common/auth/branch-scope";
import {
  CreateInvoiceDto,
  QueryInvoiceDto, 
  VoidInvoiceDto, 
  ReturnInvoiceDto,
  createInvoiceSchema,
  queryInvoiceSchema,
  voidInvoiceSchema,
  returnInvoiceSchema,
  recordPaymentSchema
} from "@pharmerp/types";

@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("billing")
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get("invoices")
  @Roles("admin", "pharmacist", "cashier", "reports_analyst", "doctor")
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

  @Public()
  @Get("public/invoices/:id")
  @ApiOperation({ summary: "Get public invoice view for patient WhatsApp/SMS link" })
  findPublicOne(@Param("id") id: string) { return this.service.findOne(id); }

  @Get("invoices/:id")
  @Roles("admin", "pharmacist", "cashier", "doctor")
  findOne(@Param("id") id: string) { return this.service.findOne(id); }

  @Post("invoices")
  @Roles("admin", "pharmacist", "cashier")
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
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Void invoice and return stock" })
  voidInvoice(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.voidInvoice(id, voidInvoiceSchema.parse(body), user.sub);
  }

  @Post("invoices/:id/return")
  @Roles("admin", "pharmacist")
  @ApiOperation({ summary: "Create return invoice — restocks batches, creates refund payment" })
  createReturn(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createReturn(id, returnInvoiceSchema.parse(body), user.sub);
  }

  @Post("payments")
  @Roles("admin", "pharmacist", "cashier")
  @ApiOperation({ summary: "Record a payment against an invoice" })
  recordPayment(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.recordPayment(recordPaymentSchema.parse(body), user.sub);
  }

  @Get("invoices/:id/pdf")
  @Roles("admin", "pharmacist", "cashier")
  @ApiOperation({ summary: "Get presigned download URL for invoice PDF" })
  getPdf(@Param("id") id: string) {
    return this.service.getPdfUrl(id);
  }

  @Get("reports/end-of-day")
  @Roles("admin", "reports_analyst")
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
