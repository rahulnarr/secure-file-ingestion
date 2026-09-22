import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { createApp } from "./app.js";
import { FileService } from "./services/files.js";

const config = loadConfig();
const pool = await openDatabase(config);
const files = new FileService(pool, config);
const app = createApp(files, config);

console.log(
  `signed-file-api listening on http://${config.HOST}:${config.PORT} (base ${config.BASE_URL})`,
);

const server = serve({
  fetch: app.fetch,
  hostname: config.HOST,
  port: config.PORT,
});

async function shutdown() {
  console.log("Shutting down...");
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
