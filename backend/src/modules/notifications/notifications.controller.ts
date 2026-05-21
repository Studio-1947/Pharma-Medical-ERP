import { Controller, Get, Post, Param, Query, UseGuards, ParseBoolPipe, DefaultValuePipe } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@Controller("notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List notifications for the current user" })
  @ApiQuery({ name: "unreadOnly", required: false, type: Boolean })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  list(
    @CurrentUser() user: JwtPayload,
    @Query("unreadOnly", new DefaultValuePipe(false), ParseBoolPipe) unreadOnly: boolean,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.svc.findAll(user.sub, unreadOnly, page ? Number(page) : 1, limit ? Number(limit) : 20);
  }

  @Get("unread-count")
  @SkipThrottle()
  @ApiOperation({ summary: "Count of unread notifications" })
  async unreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.svc.unreadCount(user.sub);
    return { count };
  }

  @Post(":id/read")
  @ApiOperation({ summary: "Mark a notification as read" })
  markRead(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.markRead(id, user.sub);
  }

  @Post("mark-all-read")
  @ApiOperation({ summary: "Mark all notifications as read" })
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.svc.markAllRead(user.sub);
  }
}
