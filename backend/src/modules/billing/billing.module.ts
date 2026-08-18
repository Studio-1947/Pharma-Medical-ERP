import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { BillingRepository } from "./billing.repository";
import { TaxService } from "./tax.service";
import { InvoicePdfService } from "./invoice-pdf.service";
import { BatchRepository } from "../inventory/batch.repository";
import { StockMovementRepository } from "../inventory/stock-movement.repository";
import { PatientsRepository } from "../patients/patients.repository";

@Module({
  // No Redis: the invoice series moved to Postgres so it could roll back with
  // the sale that failed, and nothing else in billing needed the client.
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingRepository,
    TaxService,
    InvoicePdfService,
    BatchRepository,
    StockMovementRepository,
    PatientsRepository,
  ],
  exports: [BillingService],
})
export class BillingModule {}
