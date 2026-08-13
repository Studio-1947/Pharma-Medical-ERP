import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DistributionService } from "./distribution.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  JwtPayload,
} from "../../common/decorators/current-user.decorator";
import { requireBranchScope } from "../../common/auth/branch-scope";
import {
  createTransferSchema,
  deliverTransferSchema,
  queryTransferSchema,
} from "@pharmerp/types";

@ApiTags("distribution")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("distribution")
export class DistributionController {
  constructor(private readonly service: DistributionService) {}

  @Get("transfers")
  @Roles("super_admin", "admin", "shop_manager")
  @ApiOperation({ summary: "List stock transfers" })
  findAll(@Query() q: unknown) {
    return this.service.findAll(queryTransferSchema.parse(q));
  }

  @Get("transfers/:id")
  @Roles("super_admin", "admin", "shop_manager")
  @ApiOperation({ summary: "Get stock transfer details" })
  findById(@Param("id") id: string) {
    return this.service.findById(id);
  }

  @Post("transfers")
  @Roles("super_admin", "admin", "shop_manager")
  @ApiOperation({ summary: "Create a new stock transfer" })
  create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const dto = createTransferSchema.parse(body);
    // Stock may only be sent out of the caller's own branch. Without this a
    // branch admin could drain another branch's shelves into their own.
    // The destination is unrestricted — receiving is confirmed by that branch.
    requireBranchScope(user, dto.fromBranchId);
    return this.service.create(dto, user.sub);
  }

  @Patch("transfers/:id/approve")
  @Roles("super_admin", "admin")
  @ApiOperation({ summary: "Approve and dispatch a draft transfer" })
  approve(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.approve(id, user.sub);
  }

  @Patch("transfers/:id/deliver")
  @Roles("super_admin", "admin", "shop_manager")
  @ApiOperation({ summary: "Mark transfer as delivered with received quantities" })
  deliver(@Param("id") id: string, @Body() body: unknown) {
    const { items } = deliverTransferSchema.parse(body);
    return this.service.deliver(id, { status: "delivered" }, items);
  }

  @Patch("transfers/:id/cancel")
  @Roles("super_admin", "admin")
  @ApiOperation({ summary: "Cancel a draft transfer" })
  cancel(@Param("id") id: string) {
    return this.service.cancel(id);
  }
}
