import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminRepository } from "./admin.repository";
import { ImpersonationService } from "./impersonation.service";
import { UsersRepository } from "../users/users.repository";
import { AuthModule } from "../auth/auth.module";

/**
 * AuthModule supplies AuthRepository and — via its JwtModule re-export —
 * JwtService, which ImpersonationService needs to sign scoped tokens.
 *
 * UsersRepository is re-provided rather than imported from UsersModule (which
 * exports only UsersService), matching how BillingModule re-provides the
 * repositories it reads. Safe because it depends only on the @Global
 * DrizzleService, so no second connection or state is created.
 *
 * AuditService needs no import — AuditModule is @Global.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminRepository,
    ImpersonationService,
    UsersRepository,
  ],
  exports: [AdminService],
})
export class AdminModule {}
