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
      // Drizzle/Postgres constraint errors
      const pg = exception as any;
      if (pg.code === "23505") {
        status = HttpStatus.CONFLICT;
        message = "Resource already exists";
      } else if (pg.code === "23503") {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        message = "Referenced resource does not exist";
      } else {
        this.logger.error(exception.message, exception.stack);
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
