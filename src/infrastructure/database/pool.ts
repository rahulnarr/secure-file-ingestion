import { Pool } from "pg";
import { runMigrations } from "./migrations.js";

export async function connectDatabase(databaseUrl: string, sslCaBase64?: string): Promise<Pool> {
  // An explicit `ssl` config always wins over any `sslmode=...` in the
  // connection string, so passing a real CA here gets full certificate
  // verification instead of a driver default like "trust any cert".
  const ssl = sslCaBase64
    ? { ca: Buffer.from(sslCaBase64, "base64").toString("utf8"), rejectUnauthorized: true }
    : undefined;

  const pool = new Pool({ connectionString: databaseUrl, ...(ssl ? { ssl } : {}) });
  // Connecting eagerly fails fast at boot if Postgres is unreachable.
  await runMigrations(pool);
  return pool;
}
