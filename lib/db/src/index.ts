import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database is not available. Set DATABASE_URL to enable database features.");
    this.name = "DatabaseUnavailableError";
  }
}

let pool: pg.Pool | null = null;
let db: NodePgDatabase<typeof schema>;

if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });
} else {
  console.warn(
    "[db] DATABASE_URL is not set — database features will be unavailable.",
  );
  db = new Proxy({} as NodePgDatabase<typeof schema>, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      throw new DatabaseUnavailableError();
    },
  });
}

export { pool, db };

export function isDatabaseAvailable(): boolean {
  return process.env.DATABASE_URL !== undefined;
}

export * from "./schema";
