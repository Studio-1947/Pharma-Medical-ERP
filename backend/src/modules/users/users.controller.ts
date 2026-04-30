import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { UserRole, updateUserSchema } from "@pharmerp/types";

@ApiTags("users")
@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Get all users (Admin only)" })
  async getAllUsers() {
    return this.usersService.getAllUsers();
  }

  @Get(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Get user by ID" })
  async getUserById(@Param("id") id: string) {
    return this.usersService.getUserById(id);
  }

  @Patch(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: "Update user details" })
  async updateUser(@Param("id") id: string, @Body() body: unknown) {
    const dto = updateUserSchema.parse(body);
    return this.usersService.updateUser(id, dto);
  }

  @Delete(":id")
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Delete (deactivate) user" })
  async deleteUser(@Param("id") id: string) {
    return this.usersService.deleteUser(id);
  }
}
