import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { parseJsonBody } from "../../../common/validation/parse-json-body.js";
import { createSignedLinkSchema } from "../signed-link.schemas.js";
import type { CreateSignedLinkService } from "../services/create-signed-link.service.js";

export class CreateSignedLinkController {
  private readonly schema;

  constructor(
    private readonly createSignedLink: CreateSignedLinkService,
    maxTtlSeconds: number,
  ) {
    this.schema = createSignedLinkSchema(maxTtlSeconds);
  }

  handle = async (c: Context<AppEnv>) => {
    const { ttlSeconds } = await parseJsonBody(c, this.schema, {
      message: `ttlSeconds must be a positive integer within the configured limit`,
      code: "INVALID_TTL",
    });
    const link = await this.createSignedLink.execute(
      c.req.param("fileId")!,
      c.get("userId"),
      ttlSeconds,
    );
    return c.json(link);
  };
}
