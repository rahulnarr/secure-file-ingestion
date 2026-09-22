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
  DATABASE_PATH: z.string().default("./data/files.db"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
});

export type AppConfig = z.infer<typeof envSchema> & {
  uploadDirAbsolute: string;
  databasePathAbsolute: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    uploadDirAbsolute: path.resolve(parsed.UPLOAD_DIR),
    databasePathAbsolute: path.resolve(parsed.DATABASE_PATH),
  };
}
