import { Hono } from "hono";
import { z } from "zod";
import type { FileService } from "../services/files.js";
import { HttpError, toPublicFile } from "../services/files.js";

type Variables = {
  userId: string;
};

export function createFilesRouter(files: FileService) {
  const router = new Hono<{ Variables: Variables }>();

  router.use("*", async (c, next) => {
    const userId = c.req.header("x-user-id")?.trim();
    if (!userId) {
      return c.json(
        { error: "Missing required header X-User-Id", code: "MISSING_USER" },
        401,
      );
    }
    c.set("userId", userId);
    await next();
  });

  router.post("/", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const fileField = body.file;

    if (!fileField || typeof fileField === "string" || Array.isArray(fileField)) {
      throw new HttpError(400, "multipart field 'file' is required", "MISSING_FILE");
    }

    const uploadedFile = fileField as File;
    const arrayBuffer = await uploadedFile.arrayBuffer();
    const record = files.upload({
      userId,
      filename: uploadedFile.name || "upload.bin",
      contentType: uploadedFile.type || "application/octet-stream",
      data: Buffer.from(arrayBuffer),
    });

    return c.json({ file: toPublicFile(record) }, 201);
  });

  router.get("/", (c) => {
    const userId = c.get("userId");
    const items = files.listForUser(userId).map(toPublicFile);
    return c.json({ files: items });
  });

  router.get("/:fileId", (c) => {
    const userId = c.get("userId");
    const file = files.getOwnedFile(c.req.param("fileId"), userId);
    return c.json({ file: toPublicFile(file) });
  });

  router.post("/:fileId/sign", async (c) => {
    const userId = c.get("userId");
    const schema = z.object({
      ttlSeconds: z.coerce.number().int().min(1).max(86_400),
    });

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      throw new HttpError(400, "JSON body required", "INVALID_JSON");
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "ttlSeconds must be an integer between 1 and 86400",
        "INVALID_TTL",
      );
    }

    const result = files.createSignedLink(
      c.req.param("fileId"),
      userId,
      parsed.data.ttlSeconds,
    );

    return c.json({
      fileId: result.fileId,
      downloadUrl: result.downloadUrl,
      expiresAt: result.expiresAt,
      ttlSeconds: result.ttlSeconds,
      auditEventId: result.auditEventId,
    });
  });

  router.get("/:fileId/audit", (c) => {
    const userId = c.get("userId");
    const events = files.listAuditEvents(c.req.param("fileId"), userId).map((event) => ({
      id: event.id,
      fileId: event.file_id,
      userId: event.user_id,
      eventType: event.event_type,
      ttlSeconds: event.ttl_seconds,
      expiresAt: event.expires_at,
      createdAt: event.created_at,
    }));
    return c.json({ events });
  });

  return router;
}
