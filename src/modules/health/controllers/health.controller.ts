import type { Context } from "hono";

export class HealthController {
  constructor(private readonly maxUploadBytes: number) {}

  handle = (c: Context) =>
    c.json({ status: "ok", service: "signed-file-api", maxUploadBytes: this.maxUploadBytes });
}
