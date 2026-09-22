import { Pool } from "pg";
import { runMigrations } from "./migrations.js";

export async function connectDatabase(databaseUrl: string, sslCaBase64?: string): Promise<Pool> {
  let connectionString = databaseUrl;
  let ssl: { ca: string; rejectUnauthorized: true } | undefined;

  if (sslCaBase64) {
    // node-postgres derives an `ssl` setting from the URL's `sslmode` param
    // and that derived value wins over an explicit `ssl` option passed
    // alongside a connection string — the combination of `sslmode=require`
    // plus an explicit `ca` reproducibly throws SELF_SIGNED_CERT_IN_CHAIN
    // even for a CA that `psql`/a plain `pg.Client` config object verify
    // successfully. Stripping `sslmode` and controlling SSL only via the
    // explicit `ssl` option avoids that conflict.
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    connectionString = url.toString();
    ssl = { ca: Buffer.from(sslCaBase64, "base64").toString("utf8"), rejectUnauthorized: true };
  }

  const pool = new Pool({ connectionString, ...(ssl ? { ssl } : {}) });
  // Connecting eagerly fails fast at boot if Postgres is unreachable.
  await runMigrations(pool);
  return pool;
}
