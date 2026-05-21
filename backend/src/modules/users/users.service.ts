import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { UsersRepository } from "./users.repository";
import { UpdateUserDto, UserRole } from "@pharmerp/types";

export interface InviteUserDto {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId?: string | null;
  temporaryPassword: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async getAllUsers(search?: string, page = 1, limit = 20) {
    return this.repo.findAll(search, page, limit);
  }

  async getUserById(id: string) {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async inviteUser(dto: InviteUserDto) {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictException("Email already registered");

    const validRoles = Object.values(UserRole) as string[];
    if (!validRoles.includes(dto.role)) {
      throw new BadRequestException(`Invalid role: ${dto.role}`);
    }

    const rawPassword = (dto as any).password ?? dto.temporaryPassword;
    const passwordHash = await argon2.hash(rawPassword, {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 65536,
      parallelism: 1,
    });

    return this.repo.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      branchId: dto.branchId,
      passwordHash,
    });
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.repo.update(id, dto);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async changeRole(id: string, role: string) {
    const validRoles = Object.values(UserRole) as string[];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }
    const user = await this.repo.changeRole(id, role);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async deactivateUser(id: string) {
    const user = await this.repo.setActive(id, false);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async reactivateUser(id: string) {
    const user = await this.repo.setActive(id, true);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async getNotificationPrefs(userId: string) {
    const prefs = await this.repo.getNotificationPrefs(userId);
    return { data: prefs };
  }

  async updateNotificationPrefs(userId: string, prefs: Record<string, { email: boolean; sms: boolean }>) {
    await this.repo.updateNotificationPrefs(userId, prefs);
    return { success: true };
  }
}
