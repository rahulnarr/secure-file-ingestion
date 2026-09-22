import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { buildContainer } from "./container.js";
import { connectDatabase } from "./infrastructure/database/pool.js";

const config = loadConfig();
const pool = await connectDatabase(config.DATABASE_URL);
const app = createApp(buildContainer(config, pool));

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, () => {
  console.log(
    `signed-file-api listening on http://${config.HOST}:${config.PORT} (base ${config.BASE_URL})`,
  );
});

async function shutdown() {
  console.log("Shutting down...");
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
