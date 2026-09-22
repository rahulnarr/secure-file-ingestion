import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3847),
  HOST: z.string().default("0.0.0.0"),
  BASE_URL: z.string().url().default("http://127.0.0.1:3847"),
  SIGNING_SECRET: z
    .string()
    .min(16, "SIGNING_SECRET must be at least 16 characters")
    .default("dev-only-signing-secret-change-me"),
  DATA_DIR: z.string().default("./data"),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required, e.g. postgres://user:pass@host:5432/db")
    .default("postgres://postgres:postgres@127.0.0.1:5432/signed_file_api"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MAX_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(20),
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
