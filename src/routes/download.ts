import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import { verifySignedDownload } from "../lib/signing.js";
import type { FileService } from "../services/files.js";
import { HttpError } from "../services/files.js";

export function createDownloadRouter(files: FileService, config: AppConfig) {
  const router = new Hono();

  router.get("/", async (c) => {
    const fileId = c.req.query("fileId") ?? "";
    const expires = c.req.query("expires") ?? "";
    const signature = c.req.query("sig") ?? "";

    // Step 1: stateless cryptographic check — rejects tampered or expired
    // links instantly without touching Postgres.
    const verification = verifySignedDownload({
      secret: config.SIGNING_SECRET,
      fileId,
      expires,
      signature,
    });

    if (!verification.ok) {
      throw new HttpError(403, verification.reason, "INVALID_SIGNED_URL");
    }

    // Step 2: confirm the link was actually issued by this service and has
    // not been revoked, and record the download attempt in the audit trail.
    const { file } = await files.consumeSignedLink(
      verification.claims.fileId,
      signature,
    );
    const bytes = files.readFileBytes(file);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": file.content_type,
        "Content-Length": String(file.size_bytes),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.original_filename)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return router;
}
