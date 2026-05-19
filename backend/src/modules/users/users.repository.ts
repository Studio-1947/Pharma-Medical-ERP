import { Injectable } from "@nestjs/common";
import { eq, desc, ilike, or } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { UpdateUserDto } from "@pharmerp/types";

export interface InviteUserData {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId?: string | null;
  passwordHash: string;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findAll(search?: string) {
    const query = this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt));

    if (search) {
      return query.where(
        or(
          ilike(schema.users.email, `%${search}%`),
          ilike(schema.users.firstName, `%${search}%`),
          ilike(schema.users.lastName, `%${search}%`),
        ),
      );
    }

    return query;
  }

  async findById(id: string) {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        lastLoginAt: schema.users.lastLoginAt,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return user ?? null;
  }

  async findByEmail(email: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    return user ?? null;
  }

  async create(data: InviteUserData) {
    const [user] = await this.db
      .insert(schema.users)
      .values({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role as any,
        branchId: data.branchId ?? null,
        passwordHash: data.passwordHash,
        isActive: true,
      })
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        createdAt: schema.users.createdAt,
      });
    return user;
  }

  async update(id: string, data: UpdateUserDto) {
    const [user] = await this.db
      .update(schema.users)
      .set({ ...data, role: data.role as any, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        role: schema.users.role,
        branchId: schema.users.branchId,
        isActive: schema.users.isActive,
        updatedAt: schema.users.updatedAt,
      });
    return user ?? null;
  }

  async setActive(id: string, isActive: boolean) {
    const [user] = await this.db
      .update(schema.users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning({ id: schema.users.id, isActive: schema.users.isActive });
    return user ?? null;
  }

  async changeRole(id: string, role: string) {
    const [user] = await this.db
      .update(schema.users)
      .set({ role: role as any, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        role: schema.users.role,
        updatedAt: schema.users.updatedAt,
      });
    return user ?? null;
  }
}
