import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { z } from "zod";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { BullModule } from "@nestjs/bull";
import { DrizzleModule } from "./database/drizzle.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { BillingModule } from "./modules/billing/billing.module";
import { PatientsModule } from "./modules/patients/patients.module";
import { PrescriptionsModule } from "./modules/prescriptions/prescriptions.module";
import { ProcurementModule } from "./modules/procurement/procurement.module";
import { HrModule } from "./modules/hr/hr.module";
import { DistributionModule } from "./modules/distribution/distribution.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { S3Module } from "./common/s3/s3.module";
import { ClickHouseModule } from "./common/clickhouse/clickhouse.module";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      validate: (config: Record<string, unknown>) => {
        const schema = z.object({
          DATABASE_URL: z.string().min(1),
          REDIS_URL: z.string().min(1).optional(),
          JWT_PRIVATE_KEY: z.string().min(1),
          JWT_PUBLIC_KEY: z.string().min(1),
          JWT_EXPIRES_IN: z.string().default("8h"),
          REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
          PORT: z.coerce.number().default(4000),
          NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
          CORS_ORIGIN: z.string().default("http://localhost:3000"),
          S3_ENDPOINT: z.string().optional(),
          S3_BUCKET: z.string().optional(),
          S3_ACCESS_KEY: z.string().optional(),
          S3_SECRET_KEY: z.string().optional(),
          CLICKHOUSE_URL: z.string().optional(),
          CLICKHOUSE_DB: z.string().optional(),
        });
        return schema.parse(config);
      },
    }),

    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    // Redis / BullMQ
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get("REDIS_URL")
          ? { url: config.get<string>("REDIS_URL") }
          : { host: "localhost", port: 6379 },
      }),
    }),

    DrizzleModule,
    AuthModule,
    UsersModule,
    InventoryModule,
    BillingModule,
    PatientsModule,
    PrescriptionsModule,
    ProcurementModule,
    HrModule,
    DistributionModule,
    ReportsModule,
    JobsModule,
    NotificationsModule,
    S3Module,
    ClickHouseModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
