import { Injectable } from "@nestjs/common";
import { desc, eq, and, isNull } from "drizzle-orm";
import { DrizzleService } from "../../database/drizzle.service";
import * as schema from "../../database/schema";

@Injectable()
export class NotificationsService {
  constructor(private readonly drizzle: DrizzleService) {}

  private get db() {
    return this.drizzle.db;
  }

  async findAll(userId: string, unreadOnly = false, page = 1, limit = 20) {
    const conditions: any[] = [eq(schema.notifications.userId, userId)];
    if (unreadOnly) conditions.push(eq(schema.notifications.isRead, false));

    const where = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(schema.notifications)
        .where(where)
        .orderBy(desc(schema.notifications.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ count: schema.notifications.id })
        .from(schema.notifications)
        .where(where),
    ]);

    const total = countResult.length;
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.isRead, false)));
    return rows.length;
  }

  async markRead(id: string, userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)));
    return { success: true };
  }

  async markAllRead(userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(eq(schema.notifications.userId, userId));
    return { success: true };
  }

  async create(data: {
    userId?: string;
    type: typeof schema.notifications.$inferInsert["type"];
    title: string;
    message: string;
    resourceType?: string;
    resourceId?: string;
  }) {
    const [row] = await this.db.insert(schema.notifications).values(data).returning();
    return row;
  }
}
