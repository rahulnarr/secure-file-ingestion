import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { parseJsonBody } from "../../../common/validation/parse-json-body.js";
import { createSignedLinkSchema, MAX_TTL_SECONDS } from "../signed-link.schemas.js";
import type { CreateSignedLinkService } from "../services/create-signed-link.service.js";

export class CreateSignedLinkController {
  constructor(private readonly createSignedLink: CreateSignedLinkService) {}

  handle = async (c: Context<AppEnv>) => {
    const { ttlSeconds } = await parseJsonBody(c, createSignedLinkSchema, {
      message: `ttlSeconds must be an integer between 1 and ${MAX_TTL_SECONDS}`,
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
