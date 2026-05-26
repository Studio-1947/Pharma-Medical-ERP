import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import multipart from "@fastify/multipart";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { patchNestJsSwagger } from "nestjs-zod";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: process.env.NODE_ENV === "development" }),
  );

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  });

  app.setGlobalPrefix("api/v1");

  const rawOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
  const allowedOrigins = rawOrigin.split(",").map((o) => o.trim());
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`), false);
      }
    },
    credentials: true,
  });

  // Swagger
  patchNestJsSwagger();
  const config = new DocumentBuilder()
    .setTitle("PharmERP API")
    .setDescription("Medical Pharmacy ERP — REST API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT ?? 4000;
  await app.listen(port, "0.0.0.0");
  console.log(`PharmERP API running on http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap();

