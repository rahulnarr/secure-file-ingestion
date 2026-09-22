import { Pool } from "pg";
import { runMigrations } from "./migrations.js";

export async function connectDatabase(databaseUrl: string): Promise<Pool> {
  const pool = new Pool({ connectionString: databaseUrl });
  // Connecting eagerly fails fast at boot if Postgres is unreachable.
  await runMigrations(pool);
  return pool;
}
