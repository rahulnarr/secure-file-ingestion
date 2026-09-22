import path from "node:path";
import { z } from "zod";

/**
 * The single source of truth for every environment-driven and otherwise
 * configurable value in the service. Nothing outside this file should read
 * `process.env` directly, and business-rule constants that plausibly need
 * tuning per environment (TTL ceilings, retry policy, batch limits) live
 * here rather than being hardcoded next to the code that uses them.
 */
const envSchema = z.object({
  // --- HTTP server ---
  PORT: z.coerce.number().int().positive().default(3847),
  HOST: z.string().default("0.0.0.0"),
  BASE_URL: z.string().url().default("http://127.0.0.1:3847"),

  // --- Signing / crypto ---
  SIGNING_SECRET: z
    .string()
    .min(16, "SIGNING_SECRET must be at least 16 characters")
    .default("dev-only-signing-secret-change-me"),
  MAX_TTL_SECONDS: z.coerce.number().int().positive().max(31_536_000).default(86_400),

  // --- Storage ---
  DATA_DIR: z.string().default("./data"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MAX_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(20),

  // --- Database ---
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required, e.g. postgres://user:pass@host:5432/db")
    .default("postgres://postgres:postgres@127.0.0.1:5432/signed_file_api"),
  // Base64-encoded PEM CA certificate for verifying a managed Postgres
  // provider's TLS chain (e.g. DigitalOcean's per-cluster CA via
  // `doctl databases get-ca`). Omitted for local/dev Postgres, which has no
  // TLS in front of it.
  DATABASE_SSL_CA_BASE64: z.string().optional(),

  // --- Logging ---
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // --- Retry policy for transient DB / storage failures ---
  // Applied uniformly wherever a repository or blob-storage call can fail
  // transiently (client-to-DB, client-to-filesystem), via a Proxy wrapper —
  // see src/infrastructure/resilience.
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(100),
  RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(2_000),
  RETRY_MAX_ELAPSED_MS: z.coerce.number().int().positive().default(10_000),
});

export type AppConfig = z.infer<typeof envSchema> & {
  uploadDirAbsolute: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    uploadDirAbsolute: path.resolve(parsed.UPLOAD_DIR),
  };
}

export type RetryPolicyConfig = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxElapsedMs: number;
};

export function retryPolicyFromConfig(config: AppConfig): RetryPolicyConfig {
  return {
    maxAttempts: config.RETRY_MAX_ATTEMPTS,
    baseDelayMs: config.RETRY_BASE_DELAY_MS,
    maxDelayMs: config.RETRY_MAX_DELAY_MS,
    maxElapsedMs: config.RETRY_MAX_ELAPSED_MS,
  };
}
