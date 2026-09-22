import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { createApp } from "./app.js";
import { FileService } from "./services/files.js";

const config = loadConfig();
const db = openDatabase(config);
const files = new FileService(db, config);
const app = createApp(files, config);

console.log(
  `signed-file-api listening on http://${config.HOST}:${config.PORT} (base ${config.BASE_URL})`,
);

serve({
  fetch: app.fetch,
  hostname: config.HOST,
  port: config.PORT,
});
