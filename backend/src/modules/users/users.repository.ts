import { Injectable } from "@nestjs/common";
import { eq, and } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";
import { UpdateUserDto } from "@pharmerp/types";

@Injectable()
export class UsersRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findAll() {
    return this.db.query.users.findMany({
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    });
  }

  async findById(id: string) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
  }

  async update(id: string, data: UpdateUserDto) {
    const [user] = await this.db
      .update(schema.users)
      .set({
        ...data,
        role: data.role as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async delete(id: string) {
    // Soft delete if preferred, but here we do actual delete for staff management
    // or set isActive to false. Let's do set isActive: false as a "delete" in ERPs
    const [user] = await this.db
      .update(schema.users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }
}
