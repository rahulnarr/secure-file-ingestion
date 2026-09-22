import { Hono } from "hono";
import { z } from "zod";
import type { FileService } from "../services/files.js";
import { HttpError, toPublicFile, toPublicSignedLink } from "../services/files.js";

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
    const record = await files.upload({
      userId,
      filename: uploadedFile.name || "upload.bin",
      contentType: uploadedFile.type || "application/octet-stream",
      data: Buffer.from(arrayBuffer),
    });

    return c.json({ file: toPublicFile(record) }, 201);
  });

  router.get("/", async (c) => {
    const userId = c.get("userId");
    const items = (await files.listForUser(userId)).map(toPublicFile);
    return c.json({ files: items });
  });

  router.get("/:fileId", async (c) => {
    const userId = c.get("userId");
    const file = await files.getOwnedFile(c.req.param("fileId"), userId);
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

    const result = await files.createSignedLink(
      c.req.param("fileId"),
      userId,
      parsed.data.ttlSeconds,
    );

    return c.json({
      fileId: result.fileId,
      downloadUrl: result.downloadUrl,
      expiresAt: result.expiresAt,
      ttlSeconds: result.ttlSeconds,
      signedLinkId: result.signedLinkId,
    });
  });

  router.get("/:fileId/links", async (c) => {
    const userId = c.get("userId");
    const links = (await files.listSignedLinks(c.req.param("fileId"), userId)).map(
      toPublicSignedLink,
    );
    return c.json({ links });
  });

  router.post("/:fileId/links/:linkId/revoke", async (c) => {
    const userId = c.get("userId");
    await files.revokeSignedLink(c.req.param("fileId"), c.req.param("linkId"), userId);
    return c.json({ revoked: true });
  });

  router.get("/:fileId/audit", async (c) => {
    const userId = c.get("userId");
    const events = (await files.listAuditEvents(c.req.param("fileId"), userId)).map(
      (event) => ({
        id: event.id,
        fileId: event.file_id,
        userId: event.user_id,
        eventType: event.event_type,
        ttlSeconds: event.ttl_seconds,
        expiresAt: event.expires_at,
        createdAt: event.created_at,
      }),
    );
    return c.json({ events });
  });

  return router;
}
