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

@ApiTags("distribution")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("distribution")
export class DistributionController {
  constructor(private readonly service: DistributionService) {}

  @Get("transfers")
  @Roles("super_admin", "admin", "distribution_staff")
  @ApiOperation({ summary: "List stock transfers" })
  findAll(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("status") status?: string,
  ) {
    return this.service.findAll({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
    });
  }

  @Get("transfers/:id")
  @Roles("super_admin", "admin", "distribution_staff")
  @ApiOperation({ summary: "Get stock transfer details" })
  findById(@Param("id") id: string) {
    return this.service.findById(id);
  }

  @Post("transfers")
  @Roles("super_admin", "admin", "distribution_staff")
  @ApiOperation({ summary: "Create a new stock transfer" })
  create(@Body() body: any, @CurrentUser() user: JwtPayload) {
    return this.service.create(body, user.sub);
  }

  @Patch("transfers/:id/approve")
  @Roles("super_admin", "admin")
  @ApiOperation({ summary: "Approve and dispatch a draft transfer" })
  approve(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.approve(id, user.sub);
  }

  @Patch("transfers/:id/deliver")
  @Roles("super_admin", "admin", "distribution_staff")
  @ApiOperation({ summary: "Mark transfer as delivered with received quantities" })
  deliver(
    @Param("id") id: string,
    @Body() body: { status: "delivered" | "rejected"; podFileUrl?: string; items: any[] },
  ) {
    const { items, ...dto } = body;
    return this.service.deliver(id, dto, items ?? []);
  }

  @Patch("transfers/:id/cancel")
  @Roles("super_admin", "admin")
  @ApiOperation({ summary: "Cancel a draft transfer" })
  cancel(@Param("id") id: string) {
    return this.service.cancel(id);
  }
}
