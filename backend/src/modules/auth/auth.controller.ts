import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import { Public, Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser, JwtPayload } from "../../common/decorators/current-user.decorator";
import { loginSchema, registerSchema, refreshTokenSchema } from "@pharmerp/types";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  @ApiOperation({ summary: "Register a new user" })
  async register(@Body() body: unknown, @Req() req: FastifyRequest) {
    const dto = registerSchema.parse(body);
    return this.authService.register(dto);
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login and receive JWT pair" })
  async login(@Body() body: unknown, @Req() req: FastifyRequest) {
    const dto = loginSchema.parse(body);
    return this.authService.login(dto, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate refresh token" })
  async refresh(@Body() body: unknown, @Req() req: FastifyRequest) {
    const { refreshToken } = refreshTokenSchema.parse(body);
    return this.authService.refresh(refreshToken, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke all refresh tokens for current user" })
  async logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Change current user's password" })
  async changePassword(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };
    return this.authService.changePassword(user.sub, currentPassword, newPassword);
  }
}
