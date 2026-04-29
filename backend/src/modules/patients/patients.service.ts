import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PatientsRepository } from "./patients.repository";
import type { CreatePatientDto, UpdatePatientDto, QueryPatientDto } from "@pharmerp/types";

@Injectable()
export class PatientsService {
  constructor(private readonly repo: PatientsRepository) {}

  findAll(query: QueryPatientDto) { return this.repo.findPaginated(query); }

  async findOne(id: string) {
    const p = await this.repo.findById(id);
    if (!p) throw new NotFoundException(`Patient ${id} not found`);
    return { data: p };
  }

  async create(dto: CreatePatientDto) {
    const existing = await this.repo.findByPhone(dto.phone);
    if (existing) throw new ConflictException("Phone number already registered");
    const p = await this.repo.create(dto);
    return { data: p, message: "Patient registered" };
  }

  async update(id: string, dto: UpdatePatientDto) {
    await this.findOne(id);
    const p = await this.repo.update(id, dto);
    return { data: p, message: "Patient updated" };
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.repo.softDelete(id);
    return { message: "Patient deleted" };
  }
}
