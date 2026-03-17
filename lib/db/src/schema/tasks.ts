import { pgTable, text, serial, timestamp, boolean, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("idle"),
  totalAccounts: integer("total_accounts").notNull().default(1),
  successCount: integer("success_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  useProxy: boolean("use_proxy").notNull().default(false),
  emailDomain: text("email_domain"),
  logs: json("logs").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, startedAt: true, completedAt: true, successCount: true, failedCount: true, logs: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
