import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service";
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
  updateUserSchema,
  // Named "admin" because the console is its only caller, but this is the
  // shared account-creation shape — /users/invite is the single API path
  // allowed to mint a super_admin.
  adminCreateUserSchema,
  adminUserQuerySchema,
} from "@pharmerp/types";

/** Pulls the client address and agent off the request for the audit trail. */
function reqMeta(req: any) {
  return { ip: req?.ip, userAgent: req?.headers?.["user-agent"] };
}

@ApiTags("users")
@Controller("users")
@ApiBearerAuth()
// NoImpersonationGuard is applied per-method, not here. User administration is
// exactly the surface an impersonated session must not reach, but the two
// `me/notification-prefs` routes are ordinary self-service: blocking those
// would break the impersonated view of the app, which is the whole point of
// impersonating.
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "List users (paginated, branch-scoped, filterable)" })
  getAllUsers(@Query() query: unknown, @CurrentUser() caller: JwtPayload) {
    return this.usersService.getAllUsers(
      adminUserQuerySchema.parse(query ?? {}),
      caller,
    );
  }

  @Get("me/notification-prefs")
  @ApiOperation({ summary: "Get current user's notification preferences" })
  getNotificationPrefs(@CurrentUser() user: JwtPayload) {
    return this.usersService.getNotificationPrefs(user.sub);
  }

  @Put("me/notification-prefs")
  @ApiOperation({ summary: "Save current user's notification preferences" })
  updateNotificationPrefs(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, { email: boolean; sms: boolean }>,
  ) {
    return this.usersService.updateNotificationPrefs(user.sub, body);
  }

  @Get(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Get user by ID" })
  getUserById(@Param("id") id: string, @CurrentUser() caller: JwtPayload) {
    return this.usersService.getUserById(id, caller);
  }

  @Post("invite")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({
    summary:
      "Create a staff account with an initial password (super_admin may create any role)",
  })
  inviteUser(
    @Body() body: unknown,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    const dto = adminCreateUserSchema.parse(body);
    return this.usersService.inviteUser(dto, caller, reqMeta(req));
  }

  @Patch(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Update user profile fields" })
  updateUser(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    const dto = updateUserSchema.parse(body);
    return this.usersService.updateUser(id, dto, caller, reqMeta(req));
  }

  @Patch(":id/role")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Change user role" })
  changeRole(
    @Param("id") id: string,
    @Body("role") role: string,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    return this.usersService.changeRole(id, role, caller, reqMeta(req));
  }

  @Patch(":id/deactivate")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Deactivate user account" })
  deactivate(
    @Param("id") id: string,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    return this.usersService.deactivateUser(id, caller, reqMeta(req));
  }

  @Patch(":id/reactivate")
  @Roles(UserRole.SUPER_ADMIN)
  @UseGuards(NoImpersonationGuard)
  @ApiOperation({ summary: "Reactivate a deactivated user account" })
  reactivate(
    @Param("id") id: string,
    @CurrentUser() caller: JwtPayload,
    @Req() req: any,
  ) {
    return this.usersService.reactivateUser(id, caller, reqMeta(req));
  }
}
