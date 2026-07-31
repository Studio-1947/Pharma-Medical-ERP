import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ClinicRepository } from "./clinic.repository";
import type { CreateClinicTokenDto, QueryClinicTokenDto, UpdateClinicTokenDto } from "@pharmerp/types";
import type { JwtPayload } from "../../common/decorators/current-user.decorator";

const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

/**
 * A doctor may only ever see and act on their own queue, so `doctorId` — which
 * arrives as a client-supplied query param — is pinned to the caller. Without
 * this, any doctor could read a colleague's full list of patients by editing
 * the param, or drop it entirely and read every queue in the system.
 *
 * Reception roles (admin, cashier) legitimately work across all of a branch's
 * doctors, so for them the param stays a free filter; branch scoping is what
 * bounds their reach.
 */
function resolveDoctorScope(user: JwtPayload, requestedDoctorId?: string): string | undefined {
  if (user.role !== "doctor") return requestedDoctorId;

  if (requestedDoctorId && requestedDoctorId !== user.sub) {
    throw new ForbiddenException("You can only access your own consultation queue");
  }
  return user.sub;
}

@Injectable()
export class ClinicService {
  constructor(private readonly repo: ClinicRepository) {}

  /**
   * Rejects a token that belongs to another branch. `branchId` is null only on
   * rows predating branch scoping, which stay visible to super_admin alone.
   */
  private assertInBranch(token: { branchId: string | null }, user: JwtPayload) {
    if (user.role === "super_admin") return;
    if (!token.branchId || token.branchId !== user.branchId) {
      throw new ForbiddenException("You can only access data for your own branch");
    }
  }

  private assertOwnQueue(token: { doctorId: string }, user: JwtPayload) {
    if (user.role === "doctor" && token.doctorId !== user.sub) {
      throw new ForbiddenException("You can only update tokens on your own queue");
    }
  }

  // async so a rejected scope check surfaces as a rejected promise rather than
  // a synchronous throw, matching every other method on this service.
  async findAll(query: QueryClinicTokenDto, user: JwtPayload) {
    return this.repo.findPaginated({
      ...query,
      doctorId: resolveDoctorScope(user, query.doctorId),
    });
  }

  async findOne(id: string, user: JwtPayload) {
    const token = await this.repo.findById(id);
    if (!token) throw new NotFoundException(`Clinic token ${id} not found`);
    this.assertInBranch(token, user);
    this.assertOwnQueue(token, user);
    return { data: token };
  }

  /** `branchId` is pre-resolved by the controller via requireBranchScope. */
  async create(dto: CreateClinicTokenDto, branchId: string) {
    const doctor = await this.repo.findActiveDoctor(dto.doctorId);
    if (!doctor) {
      throw new UnprocessableEntityException("Selected doctor is not a valid active doctor");
    }
    // A doctor posted to another branch must not be bookable from this one.
    if (doctor.branchId && doctor.branchId !== branchId) {
      throw new UnprocessableEntityException("Selected doctor does not practise at this branch");
    }

    const patient = await this.repo.findLivePatient(dto.patientId);
    if (!patient) {
      throw new UnprocessableEntityException("Selected patient does not exist");
    }

    this.assertNotBackdated(dto.date);

    const openToken = await this.repo.findOpenTokenForPatient(
      dto.patientId,
      dto.doctorId,
      dto.date,
    );
    if (openToken) {
      throw new UnprocessableEntityException(
        `Patient already holds open token #${openToken.tokenNo} with this doctor today`,
      );
    }

    const token = await this.repo.create({ ...dto, branchId });
    return { data: token, message: "Token generated" };
  }

  async update(id: string, dto: UpdateClinicTokenDto, user: JwtPayload) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException(`Clinic token ${id} not found`);

    this.assertInBranch(existing, user);
    this.assertOwnQueue(existing, user);

    if (TERMINAL_STATUSES.has(existing.status) && dto.status && dto.status !== existing.status) {
      throw new UnprocessableEntityException(`Token is already ${existing.status} and cannot change status`);
    }

    // The FK guarantees the prescription exists, not that it belongs to this
    // patient. Linking someone else's prescription would surface their
    // medication list inside this consultation, so the ownership is checked here.
    if (dto.prescriptionId && dto.prescriptionId !== existing.prescriptionId) {
      const prescription = await this.repo.findPrescriptionPatientId(dto.prescriptionId);
      if (!prescription) {
        throw new UnprocessableEntityException("Referenced prescription does not exist");
      }
      if (prescription.patientId !== existing.patientId) {
        throw new UnprocessableEntityException(
          "Prescription belongs to a different patient and cannot be linked to this token",
        );
      }
    }

    const updated = await this.repo.update(id, dto);
    return { data: updated, message: "Token updated" };
  }

  findDoctors(branchId?: string) {
    return this.repo.findDoctors(branchId).then((data) => ({ data }));
  }

  /**
   * Tokens are for consultations that have not happened yet, so a past date is
   * a typo rather than a use case. One day of slack absorbs the gap between the
   * server clock (UTC) and the clinic's local calendar day (IST), which would
   * otherwise reject a legitimate same-day token booked before 05:30 IST.
   */
  private assertNotBackdated(date: string) {
    const earliest = new Date();
    earliest.setUTCDate(earliest.getUTCDate() - 1);
    if (date < earliest.toISOString().slice(0, 10)) {
      throw new UnprocessableEntityException("Cannot generate a token for a past date");
    }
  }
}
