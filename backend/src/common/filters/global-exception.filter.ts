import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let errors: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === "string" ? res : (res as any).message ?? message;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = "Validation failed";
      errors = exception.flatten().fieldErrors;
    } else if (exception instanceof Error) {
      // Drizzle/Postgres errors expose a SQLSTATE `code` (sometimes on `cause`).
      const pg = exception as any;
      const pgCode: string | undefined = pg.code ?? pg.cause?.code;

      // Fastify rejects malformed requests before the handler runs (empty body
      // under application/json, bad content-type, payload too large). Those
      // carry their own 4xx statusCode and are the caller's fault, so passing
      // them through as 500 both misreports them and hides them in error logs.
      if (
        typeof pg.statusCode === "number" &&
        pg.statusCode >= 400 &&
        pg.statusCode < 500 &&
        typeof pgCode === "string" &&
        pgCode.startsWith("FST_")
      ) {
        reply.status(pg.statusCode).send({
          success: false,
          message: pg.message,
          path: request.url,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      switch (pgCode) {
        case "23505": // unique_violation
          status = HttpStatus.CONFLICT;
          message = "Resource already exists";
          break;
        case "23503": // foreign_key_violation
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = "Referenced resource does not exist";
          break;
        case "23502": // not_null_violation
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = pg.column
            ? `Required field "${pg.column}" is missing`
            : "A required field is missing";
          break;
        case "42703": // undefined_column
        case "42P01": // undefined_table
          // Schema drift: the running code references a column/table the DB
          // lacks — almost always a pending migration not applied to this DB.
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message =
            "Database schema mismatch - a pending migration may not be applied";
          this.logger.error(
            `Postgres schema error ${pgCode}: ${pg.message} (table=${pg.table ?? "?"}, column=${pg.column ?? "?"})`,
            exception.stack,
          );
          break;
        default:
          this.logger.error(
            `Unhandled error${pgCode ? ` [pg ${pgCode}]` : ""}: ${exception.message}`,
            exception.stack,
          );
      }
    }

    const isDev = process.env.NODE_ENV === "development";

    reply.status(status).send({
      success: false,
      message,
      errors,
      stack: isDev && exception instanceof Error ? exception.stack : undefined,
      originalError: isDev && exception instanceof Error ? exception.message : undefined,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
