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

/** Maps HTTP statuses we raise deliberately onto stable codes for the UI. */
const HTTP_STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "NOT_SIGNED_IN",
  403: "NOT_PERMITTED",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "CANNOT_COMPLETE",
  429: "TOO_MANY_REQUESTS",
};

/**
 * A short code the person on the counter can read out.
 *
 * Six characters from an unambiguous alphabet — no O/0, I/1, or S/5 — because
 * it will be read aloud down a phone line more often than it is copied.
 */
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
function makeReference(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return `PH-${out}`;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const reference = makeReference();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let errors: unknown = undefined;
    // Stable, machine-readable classification. The UI maps this to plain
    // language and to what the person at the counter should do next; the
    // message alone is not enough, because a good message for a pharmacist is
    // not the same sentence as a good message for a cashier.
    let code = "INTERNAL_ERROR";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === "string" ? res : (res as any).message ?? message;
      code = HTTP_STATUS_CODES[status] ?? "REQUEST_FAILED";
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      message = "Validation failed";
      code = "VALIDATION_FAILED";
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
          code: "BAD_REQUEST",
          message: pg.message,
          reference,
          path: request.url,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      switch (pgCode) {
        case "23505": // unique_violation
          status = HttpStatus.CONFLICT;
          message = "Resource already exists";
          code = "DUPLICATE";
          break;
        case "23503": // foreign_key_violation
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = "Referenced resource does not exist";
          code = "MISSING_REFERENCE";
          break;
        case "23502": // not_null_violation
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = pg.column
            ? `Required field "${pg.column}" is missing`
            : "A required field is missing";
          code = "REQUIRED_FIELD";
          break;
        case "22P02":
          // invalid_text_representation — a bad enum literal or a malformed
          // uuid reaching the driver. That is client input, so it must not
          // surface as a 500 with a stack trace attached.
          status = HttpStatus.BAD_REQUEST;
          message = "Invalid value for a typed column";
          code = "INVALID_VALUE";
          break;
        case "40P01": // deadlock_detected
        case "40001": // serialization_failure
          // Two tills contended and Postgres broke the tie by killing one. The
          // sale was not recorded, and simply repeating it succeeds.
          status = HttpStatus.CONFLICT;
          message =
            "Another till was billing the same stock at that moment. Nothing was saved — please try again.";
          code = "RETRY_SAFE";
          this.logger.warn(`Postgres ${pgCode} on ${request.url}: ${pg.message}`);
          break;
        case "42703": // undefined_column
        case "42P01": // undefined_table
          // Schema drift: the running code references a column/table the DB
          // lacks — almost always a pending migration not applied to this DB.
          status = HttpStatus.INTERNAL_SERVER_ERROR;
          message =
            "Database schema mismatch - a pending migration may not be applied";
          code = "SCHEMA_MISMATCH";
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

    if (status >= 500) {
      // Only server faults get logged against the reference: those are the ones
      // a person will ring up about. A 422 the cashier can fix themselves does
      // not need a support trail.
      this.logger.error(
        `[${reference}] ${status} ${code} on ${request.method} ${request.url}: ${message}`,
      );
    }

    reply.status(status).send({
      success: false,
      code,
      message,
      // Short, readable, and unique enough to find in the logs. Non-technical
      // staff cannot describe a stack trace, but they can read six characters
      // off the screen down the phone.
      reference,
      errors,
      stack: isDev && exception instanceof Error ? exception.stack : undefined,
      originalError: isDev && exception instanceof Error ? exception.message : undefined,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
