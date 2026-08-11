import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import multipart from "@fastify/multipart";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { patchNestJsSwagger } from "nestjs-zod";
import { AppModule } from "./app.module";
import { runMigrations } from "./database/run-migrations";

async function bootstrap() {
  // Apply DB migrations before serving. In prod this is the only place with
  // network access to the private DB, so it can't be done from CI. Runs by
  // default in production; opt in elsewhere with RUN_MIGRATIONS_ON_BOOT=true,
  // opt out with RUN_MIGRATIONS_ON_BOOT=false.
  const shouldMigrate =
    process.env.RUN_MIGRATIONS_ON_BOOT === "true" ||
    (process.env.NODE_ENV === "production" &&
      process.env.RUN_MIGRATIONS_ON_BOOT !== "false");
  if (shouldMigrate) {
    await runMigrations();
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: process.env.NODE_ENV === "development",
      // Fastify defaults to 1 MB, which rejects the catalogue bulk-import: a
      // 5.5k-row supplier sheet is ~3.6 MB of JSON. It has to arrive in one
      // request because the "last row wins" de-duplication needs to see the
      // whole file at once, so splitting it across requests is not an option.
      // Set here rather than per-route: Fastify snapshots a route's parser
      // limit before onRoute hooks run, so mutating it there has no effect.
      // 16 MB leaves room for roughly 4x the current catalogue.
      bodyLimit: 16 * 1024 * 1024,
    }),
  );

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  });

  app.setGlobalPrefix("api/v1");

  // Production Security Headers
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook("onRequest", async (_request: unknown, reply: any) => {
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-XSS-Protection", "1; mode=block");
    reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  const rawOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  const allowedOrigins = rawOrigin.split(",").map((o) => o.trim());
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`), false);
      }
    },
    credentials: true,
  });

  // Swagger — only expose API explorer in non-production environments
  if (process.env.NODE_ENV !== "production") {
    patchNestJsSwagger();
    const config = new DocumentBuilder()
      .setTitle("PharmERP API")
      .setDescription("Medical Pharmacy ERP — REST API")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);
  }

  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get("/health", (_req: unknown, res: any) => {
    res.send({ status: "ok", timestamp: new Date().toISOString() });
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port, "0.0.0.0");
  console.log(`PharmERP API running on http://localhost:${port}`);
  if (process.env.NODE_ENV !== "production") {
    console.log(`Swagger docs: http://localhost:${port}/docs`);
  }
}

bootstrap();

