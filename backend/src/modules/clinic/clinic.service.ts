import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ClinicRepository } from "./clinic.repository";
import type { CreateClinicTokenDto, QueryClinicTokenDto, UpdateClinicTokenDto } from "@pharmerp/types";

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

@Injectable()
export class ClinicService {
  constructor(private readonly repo: ClinicRepository) {}

  findAll(query: QueryClinicTokenDto) {
    return this.repo.findPaginated(query);
  }

  async findOne(id: string) {
    const token = await this.repo.findById(id);
    if (!token) throw new NotFoundException(`Clinic token ${id} not found`);
    return { data: token };
  }

  async create(dto: CreateClinicTokenDto) {
    const doctor = await this.repo.findActiveDoctor(dto.doctorId);
    if (!doctor) {
      throw new UnprocessableEntityException("Selected doctor is not a valid active doctor");
    }
    const token = await this.repo.create(dto);
    return { data: token, message: "Token generated" };
  }

  async update(id: string, dto: UpdateClinicTokenDto) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Clinic token ${id} not found`);
    if (TERMINAL_STATUSES.has(existing.status) && dto.status && dto.status !== existing.status) {
      throw new UnprocessableEntityException(`Token is already ${existing.status} and cannot change status`);
    }
    const updated = await this.repo.update(id, dto);
    return { data: updated, message: "Token updated" };
  }

  findDoctors() {
    return this.repo.findDoctors().then((data) => ({ data }));
  }
}
