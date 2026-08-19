import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PatientsRepository } from "./patients.repository";
import type { CreatePatientDto, UpdatePatientDto, QueryPatientDto } from "@pharmerp/types";
import type { JwtPayload } from "../../common/decorators/current-user.decorator";

@Injectable()
export class PatientsService {
  constructor(private readonly repo: PatientsRepository) {}

  async findAll(query: QueryPatientDto, user?: JwtPayload) {
    const doctorId = user?.role === "doctor" ? user.sub : undefined;
    return this.repo.findPaginated(query, doctorId);
  }

  async findOne(id: string, user?: JwtPayload) {
    const p = await this.repo.findById(id);
    if (!p) throw new NotFoundException(`Patient ${id} not found`);

    if (user?.role === "doctor") {
      const isServed = await this.repo.isPatientServedByDoctor(id, user.sub);
      if (!isServed) {
        throw new ForbiddenException("Access denied: You can only access records of patients assigned to or served by you.");
      }
    }
    return { data: p };
  }

  async create(dto: CreatePatientDto, user?: JwtPayload) {
    const existing = await this.repo.findByPhone(dto.phone);
    if (existing) throw new ConflictException("Phone number already registered");
    // A doctor registering a patient is registering someone they are about to
    // see, so the patient joins that doctor's queue in the same breath — and in
    // the same transaction, so they can never be registered without a number.
    // Every other role is registering a patient at the counter, which is not a
    // clinic visit and must not mint a queue token.
    if (user?.role === "doctor" && user.branchId) {
      const p = await this.repo.createWithDoctorToken(dto, user.sub, user.branchId);
      return { data: p, message: "Patient registered and added to your queue" };
    }

    const p = await this.repo.create(dto);
    return { data: p, message: "Patient registered" };
  }

  async update(id: string, dto: UpdatePatientDto, user?: JwtPayload) {
    await this.findOne(id, user);
    const p = await this.repo.update(id, dto);
    return { data: p, message: "Patient updated" };
  }

  async remove(id: string) {
    const p = await this.repo.findById(id);
    if (!p) throw new NotFoundException(`Patient ${id} not found`);
    await this.repo.softDelete(id);
    return { message: "Patient deleted" };
  }
}
