import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
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
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ".env" }),

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
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
