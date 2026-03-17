import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const proxiesTable = pgTable("proxies", {
  id: serial("id").primaryKey(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  username: text("username"),
  password: text("password"),
  protocol: text("protocol").notNull().default("http"),
  status: text("status").notNull().default("untested"),
  lastChecked: timestamp("last_checked"),
});

export const insertProxySchema = createInsertSchema(proxiesTable).omit({ id: true, lastChecked: true });
export type InsertProxy = z.infer<typeof insertProxySchema>;
export type Proxy = typeof proxiesTable.$inferSelect;
