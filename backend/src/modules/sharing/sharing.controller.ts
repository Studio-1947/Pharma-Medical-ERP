import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  JwtPayload,
} from "../../common/decorators/current-user.decorator";
import { UserRole } from "@pharmerp/types";
import { SharingService } from "./sharing.service";

const createSchema = z.object({
  /** Optional override; the service clamps this to 1..30 days. */
  ttlDays: z.number().int().positive().max(30).optional(),
});

/**
 * Staff-side management of patient record share links.
 */
@ApiTags("sharing")
@Controller("sharing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class SharingController {
  constructor(private readonly service: SharingService) {}

  @Post("prescriptions/:id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SHOP_MANAGER,
    UserRole.DOCTOR,
  )
  @ApiOperation({ summary: "Create a shareable link for a prescription" })
  createForPrescription(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const { ttlDays } = createSchema.parse(body ?? {});
    return this.service
      .createLink("prescription", id, user, ttlDays)
      .then((data) => ({ data }));
  }

  @Post("invoices/:id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SHOP_MANAGER,
  )
  @ApiOperation({ summary: "Create a shareable link for an invoice" })
  createForInvoice(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const { ttlDays } = createSchema.parse(body ?? {});
    return this.service
      .createLink("invoice", id, user, ttlDays)
      .then((data) => ({ data }));
  }

  @Get("prescriptions/:id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SHOP_MANAGER,
    UserRole.DOCTOR,
  )
  @ApiOperation({ summary: "List share links issued for a prescription" })
  async listForPrescription(@Param("id") id: string) {
    return { data: await this.service.listForRecord("prescription", id) };
  }

  @Get("invoices/:id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SHOP_MANAGER,
  )
  @ApiOperation({ summary: "List share links issued for an invoice" })
  async listForInvoice(@Param("id") id: string) {
    return { data: await this.service.listForRecord("invoice", id) };
  }

  @Post(":token/revoke")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.SHOP_MANAGER,
    UserRole.DOCTOR,
  )
  @ApiOperation({ summary: "Revoke a share link immediately" })
  async revoke(
    @Param("token") token: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return { data: await this.service.revoke(token, user) };
  }
}
