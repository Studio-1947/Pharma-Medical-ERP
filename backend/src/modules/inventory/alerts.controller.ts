import { Controller, Get, NotFoundException, Patch, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AlertsRepository } from "./alerts.repository";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { resolveBranchScope } from "../../common/auth/branch-scope";

@ApiTags("alerts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("alerts")
export class AlertsController {
  constructor(private readonly repo: AlertsRepository) {}

  @Get()
  @Roles("admin", "super_admin", "shop_manager")
  @ApiOperation({ summary: "List system alerts for your branch (expiry, reorder)" })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query("type") type?: string,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("limit") limit?: string,
    @Query("branchId") branchId?: string,
  ) {
    const rows = await this.repo.findVisible({
      branchId: resolveBranchScope(user, branchId),
      type,
      unreadOnly: unreadOnly === "true",
      limit: Number(limit ?? 50),
    });
    return { data: rows, total: rows.length };
  }

  @Get("unread-count")
  @Roles("admin", "super_admin", "shop_manager")
  @ApiOperation({ summary: "Unread alert count for your branch" })
  async unreadCount(@CurrentUser() user: JwtPayload) {
    return { count: await this.repo.unreadCount(resolveBranchScope(user)) };
  }

  // Declared before :id/read so "read-all" is not captured as an alert id.
  @Patch("read-all")
  @Roles("admin", "super_admin", "shop_manager")
  @ApiOperation({ summary: "Mark all of your branch's alerts as read" })
  async markAllRead(@CurrentUser() user: JwtPayload) {
    // Scoped: this used to clear every unread alert in the company, so one
    // branch dismissing its expiry warnings silently cleared everyone else's.
    const count = await this.repo.markAllRead(resolveBranchScope(user));
    return { success: true, count };
  }

  @Patch(":id/read")
  @Roles("admin", "super_admin", "shop_manager")
  @ApiOperation({ summary: "Mark an alert as read" })
  async markRead(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const ok = await this.repo.markRead(id, resolveBranchScope(user));
    if (!ok) throw new NotFoundException(`Alert ${id} not found`);
    return { success: true };
  }
}
