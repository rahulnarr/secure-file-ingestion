import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { buildContainer } from "./container.js";
import { connectDatabase } from "./infrastructure/database/pool.js";
import { createLogger } from "./infrastructure/logging/logger.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

const pool = await connectDatabase(config.DATABASE_URL);
const app = createApp(buildContainer(config, pool, undefined, logger));

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, () => {
  logger.info(
    { host: config.HOST, port: config.PORT, baseUrl: config.BASE_URL },
    "signed-file-api listening",
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  process.exit(1);
});
