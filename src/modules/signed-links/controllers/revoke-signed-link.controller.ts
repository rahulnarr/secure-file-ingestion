import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import type { RevokeSignedLinkService } from "../services/revoke-signed-link.service.js";

export class RevokeSignedLinkController {
  constructor(private readonly revokeSignedLink: RevokeSignedLinkService) {}

  handle = async (c: Context<AppEnv>) => {
    await this.revokeSignedLink.execute(
      c.req.param("fileId")!,
      c.req.param("linkId")!,
      c.get("userId"),
    );
    return c.json({ revoked: true });
  };
}
