import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { UserRole, updateUserSchema } from "@pharmerp/types";

@ApiTags("users")
@Controller("users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "List all users (paginated)" })
  getAllUsers(
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.usersService.getAllUsers(search, page ? Number(page) : 1, limit ? Number(limit) : 20);
  }

  @Get(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Get user by ID" })
  getUserById(@Param("id") id: string) {
    return this.usersService.getUserById(id);
  }

  @Post("invite")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Invite a new user (creates account with temp password)" })
  inviteUser(@Body() body: any) {
    return this.usersService.inviteUser(body);
  }

  @Patch(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Update user profile fields" })
  updateUser(@Param("id") id: string, @Body() body: unknown) {
    const dto = updateUserSchema.parse(body);
    return this.usersService.updateUser(id, dto);
  }

  @Patch(":id/role")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Change user role" })
  changeRole(@Param("id") id: string, @Body("role") role: string) {
    return this.usersService.changeRole(id, role);
  }

  @Patch(":id/deactivate")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Deactivate user account" })
  deactivate(@Param("id") id: string) {
    return this.usersService.deactivateUser(id);
  }

  @Patch(":id/reactivate")
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Reactivate a deactivated user account" })
  reactivate(@Param("id") id: string) {
    return this.usersService.reactivateUser(id);
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
}
