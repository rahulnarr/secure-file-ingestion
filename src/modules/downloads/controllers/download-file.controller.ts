import type { Context } from "hono";
import type { DownloadFileService } from "../services/download-file.service.js";

export class DownloadFileController {
  constructor(private readonly downloadFile: DownloadFileService) {}

  handle = async (c: Context) => {
    const { file, bytes } = await this.downloadFile.execute({
      fileId: c.req.query("fileId") ?? "",
      expires: c.req.query("expires") ?? "",
      signature: c.req.query("sig") ?? "",
    });

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": file.content_type,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.original_filename)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
