import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { PrescriptionsRepository } from "./prescriptions.repository";
import { S3Service } from "../../common/s3/s3.service";
import type { CreatePrescriptionDto, QueryPrescriptionDto, VerifyPrescriptionDto } from "@pharmerp/types";

@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  constructor(
    private readonly repo: PrescriptionsRepository,
    private readonly s3Service: S3Service,
  ) {}

  findAll(query: QueryPrescriptionDto) {
    return this.repo.findPaginated(query);
  }

  async findOne(id: string) {
    const prescription = await this.repo.findById(id);
    if (!prescription) throw new NotFoundException(`Prescription ${id} not found`);

    // Generate signed URL if image exists
    let signedUrl: string | undefined;
    if (prescription.fileUrl && !prescription.fileUrl.startsWith("http")) {
      try {
        signedUrl = await this.s3Service.getPresignedUrl(prescription.fileUrl);
      } catch (e) {
        this.logger.error(
          `Failed to generate presigned URL for prescription ${id}: ${(e as Error).message}`,
          (e as Error).stack,
        );
      }
    }

    return { 
      data: { 
        ...prescription, 
        displayUrl: signedUrl ?? prescription.fileUrl 
      } 
    };
  }

  async create(dto: CreatePrescriptionDto) {
    const prescription = await this.repo.create(dto);
    return { data: prescription, message: "Prescription created" };
  }

  async verify(id: string, dto: VerifyPrescriptionDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Prescription ${id} not found`);

    if (existing.status === "verified") {
      throw new UnprocessableEntityException("Prescription is already verified");
    }
    if (existing.status === "rejected") {
      throw new UnprocessableEntityException("Prescription has already been rejected");
    }

    const updated = await this.repo.verify(id, dto, userId);
    return { data: updated, message: dto.action === "verify" ? "Prescription verified" : "Prescription rejected" };
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.softDelete(id);
    return { message: "Prescription deleted" };
  }
}
