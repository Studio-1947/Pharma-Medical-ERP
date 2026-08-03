import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";

/**
 * Global so any module can record an audit entry without restating the import.
 * Mirrors DrizzleModule, which AuditService depends on.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
