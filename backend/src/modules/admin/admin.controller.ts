import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { ImpersonationService } from "./impersonation.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { NoImpersonationGuard } from "../../common/guards/no-impersonation.guard";
import {
  CurrentUser,
  JwtPayload,
} from "../../common/decorators/current-user.decorator";
import {
  UserRole,
  adminSetPasswordSchema,
  auditLogQuerySchema,
  impersonateSchema,
  sessionQuerySchema,
} from "@pharmerp/types";

function reqMeta(req: any) {
  return { ip: req?.ip, userAgent: req?.headers?.["user-agent"] };
}

/**
 * Super-admin developer console.
 *
 * Only holds the capabilities that exist nowhere else: system overview, audit
 * read, session read/revoke, force-set-password, and impersonation. Users,
 * branches, medicines and every other entity are reached through their own
 * modules — super_admin already passes RolesGuard on all of them, so
 * duplicating that CRUD here would only create a second surface to secure.
 *
 * NoImpersonationGuard is applied per-method rather than class-level because
 * /impersonate/stop is by definition called while impersonating.
 */
@ApiTags("admin")
@Controller("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly impersonation: ImpersonationService,
  ) {}

  @Get("overview")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "System-wide counts and health for the console" })
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get("audit-logs")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Read the audit trail (paginated, filterable)" })
  listAuditLogs(@Query() query: unknown) {
    return this.adminService.listAuditLogs(auditLogQuerySchema.parse(query ?? {}));
  }

  @Get("audit-logs/actions")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Distinct audit action names for filtering" })
  listAuditActions() {
    return this.adminService.listAuditActions();
  }

  @Get("sessions")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "List refresh-token sessions across all users" })
  listSessions(@Query() query: unknown) {
    return this.adminService.listSessions(sessionQuerySchema.parse(query ?? {}));
  }

  @Post("sessions/:sessionId/revoke")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Revoke a single session (device)" })
  revokeSession(
    @Param("sessionId") sessionId: string,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    return this.adminService.revokeSession(sessionId, caller, reqMeta(req));
  }

  @Post("users/:id/revoke-sessions")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Revoke every session for a user" })
  revokeAllSessions(
    @Param("id") id: string,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    return this.adminService.revokeAllSessions(id, caller, reqMeta(req));
  }

  @Post("users/:id/password")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Set a user's password without the current one" })
  setPassword(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    const dto = adminSetPasswordSchema.parse(body ?? {});
    return this.adminService.setPassword(id, dto, caller, reqMeta(req));
  }

  // NOTE: declared before /impersonate/:userId so the literal segment is not
  // captured by the parameterised route.
  @Post("impersonate/stop")
  // No @Roles: during impersonation the caller's role is the target's, so
  // requiring super_admin here would make it impossible to stop. Authority
  // comes from the `act` claim the service checks.
  @ApiOperation({ summary: "End the current impersonation session" })
  stopImpersonation(@CurrentUser() caller: JwtPayload, @Req() req: any) {
    return this.impersonation.stop(caller, reqMeta(req));
  }

  @Post("impersonate/:userId")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({
    summary: "Start impersonating a user (returns a short-lived access token)",
  })
  startImpersonation(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    const dto = impersonateSchema.parse(body ?? {});
    return this.impersonation.start(userId, caller, dto, reqMeta(req));
  }
}
