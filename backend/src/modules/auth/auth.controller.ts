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
import { Throttle } from "@nestjs/throttler";
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

  @UseGuards(JwtAuthGuard)
  @Roles("super_admin", "admin")
  @Post("register")
  @ApiOperation({ summary: "Create a new staff user (super_admin or admin only)" })
  async register(@Body() body: unknown, @CurrentUser() caller: JwtPayload) {
    const dto = registerSchema.parse(body);
    return this.authService.register(dto, caller);
  }

  @Public()
  // Credential endpoints get a far tighter budget than the global 100/min,
  // which allows ~100 password guesses a minute per IP. Kept at 10 rather
  // than 5 because a branch's terminals share one public IP behind NAT, so a
  // shift change can legitimately produce several logins in a minute.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
