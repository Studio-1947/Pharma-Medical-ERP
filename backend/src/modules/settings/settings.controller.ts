import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { UserRole } from "@pharmerp/types";
import { SettingsService, BillingFlow } from "./settings.service";

const setBillingFlowSchema = z.object({
  flow: z.enum(["old", "new"]),
});

@ApiTags("settings")
@Controller("settings")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SHOP_MANAGER,
    UserRole.DOCTOR,
  )
  @ApiOperation({ summary: "Get global application settings" })
  async getAll() {
    // Expose the normalized billingFlow only; the raw key/value store is an
    // implementation detail and is not part of the API contract.
    const billingFlow = await this.service.getBillingFlow();
    return { data: { billingFlow } };
  }

  @Put("billing-flow")
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary:
      "Switch between old billing (legacy POS) and new billing (patient-first counter desk). Super admin only.",
  })
  setBillingFlow(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { flow } = setBillingFlowSchema.parse(body);
    return this.service.setBillingFlow(flow as BillingFlow, user.sub);
  }
}
