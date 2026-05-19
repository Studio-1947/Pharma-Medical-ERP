import { Controller, Get, Patch, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { eq, desc, and, isNull } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@ApiTags("alerts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("alerts")
export class AlertsController {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() { return this.drizzle.db; }

  @Get()
  @Roles("admin", "super_admin", "inventory_manager", "pharmacist")
  @ApiOperation({ summary: "List system alerts (expiry, reorder)" })
  async findAll(
    @Query("type") type?: string,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("limit") limit?: string,
  ) {
    const conditions: any[] = [];
    if (type) conditions.push(eq(schema.systemAlerts.type, type));
    if (unreadOnly === "true") conditions.push(eq(schema.systemAlerts.isRead, false));

    const rows = await this.db
      .select()
      .from(schema.systemAlerts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.systemAlerts.createdAt))
      .limit(Number(limit ?? 50));

    return { data: rows, total: rows.length };
  }

  @Patch(":id/read")
  @Roles("admin", "super_admin", "inventory_manager", "pharmacist")
  @ApiOperation({ summary: "Mark an alert as read" })
  async markRead(@Param("id") id: string) {
    await this.db
      .update(schema.systemAlerts)
      .set({ isRead: true })
      .where(eq(schema.systemAlerts.id, id));
    return { success: true };
  }

  @Patch("read-all")
  @Roles("admin", "super_admin", "inventory_manager", "pharmacist")
  @ApiOperation({ summary: "Mark all alerts as read" })
  async markAllRead() {
    await this.db
      .update(schema.systemAlerts)
      .set({ isRead: true })
      .where(eq(schema.systemAlerts.isRead, false));
    return { success: true };
  }
}
