import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { DrizzleService } from "../../database/drizzle.service";
import { auditLogs } from "../../database/schema";

/**
 * Factory that creates an interceptor writing to audit_logs after each mutating request.
 */
export function AuditInterceptor(entity: string, action: string) {
  @Injectable()
  class ConcreteAuditInterceptor implements NestInterceptor {
    constructor(public readonly drizzle: DrizzleService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
      const req = context.switchToHttp().getRequest();
      const userId: string | undefined = req.user?.sub;
      const ip: string = req.ip;
      const ua: string = req.headers["user-agent"] ?? "";

      return next.handle().pipe(
        tap(async (result) => {
          const entityId: string | undefined =
            result?.data?.id ?? req.params?.id;
          await this.drizzle.db.insert(auditLogs).values({
            userId,
            action,
            entity,
            entityId,
            newValue: JSON.stringify(result?.data ?? {}),
            ipAddress: ip as any,
            userAgent: ua,
          });
        }),
      );
    }
  }

  return ConcreteAuditInterceptor;
}
