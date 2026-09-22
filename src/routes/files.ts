import { Hono } from "hono";
import { z } from "zod";
import type { FileService } from "../services/files.js";
import { HttpError, toPublicFile, toPublicSignedLink } from "../services/files.js";

type Variables = {
  userId: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Batch upload: multipart field 'files' repeated once per file, e.g.
  //   -F 'files=@a.txt' -F 'files=@b.txt'
  // Each file is uploaded independently; a bad file doesn't abort the batch.
  router.post("/batch", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody({ all: true });
    const raw = body.files;

    if (!raw) {
      throw new HttpError(400, "multipart field 'files' is required", "MISSING_FILES");
    }

    const fileFields = (Array.isArray(raw) ? raw : [raw]).filter(
      (item): item is File => typeof item !== "string",
    );

    if (fileFields.length === 0) {
      throw new HttpError(400, "multipart field 'files' is required", "MISSING_FILES");
    }

    const inputs = await Promise.all(
      fileFields.map(async (file) => ({
        filename: file.name || "upload.bin",
        contentType: file.type || "application/octet-stream",
        data: Buffer.from(await file.arrayBuffer()),
      })),
    );

    const result = await files.batchUpload(userId, inputs);
    const status = result.failed.length === 0 ? 201 : 207;

    return c.json(
      {
        uploaded: result.uploaded.map(toPublicFile),
        failed: result.failed,
      },
      status,
    );
  });

  router.post("/batch-delete", async (c) => {
    const userId = c.get("userId");
    const schema = z.object({
      fileIds: z.array(z.string().regex(UUID_RE, "must be a valid UUID")).min(1),
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
        "fileIds must be a non-empty array of UUIDs",
        "INVALID_BATCH_DELETE",
      );
    }

    const result = await files.batchDelete(userId, parsed.data.fileIds);
    const status = result.failed.length === 0 ? 200 : 207;

    return c.json(result, status);
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

  router.patch("/:fileId", async (c) => {
    const userId = c.get("userId");
    const schema = z.object({
      filename: z.string().min(1).max(255).optional(),
    });

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      throw new HttpError(400, "JSON body required", "INVALID_JSON");
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid update payload", "INVALID_UPDATE");
    }

    const updated = await files.updateMetadata(c.req.param("fileId"), userId, parsed.data);
    return c.json({ file: toPublicFile(updated) });
  });

  router.delete("/:fileId", async (c) => {
    const userId = c.get("userId");
    await files.delete(c.req.param("fileId"), userId);
    return c.json({ deleted: true, fileId: c.req.param("fileId") });
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
        metadata: event.metadata,
        createdAt: event.created_at,
      }),
    );
    return c.json({ events });
  });

  return router;
}
