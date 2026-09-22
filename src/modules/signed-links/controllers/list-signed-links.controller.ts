import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { toPublicSignedLink } from "../signed-link.mapper.js";
import type { ListSignedLinksService } from "../services/list-signed-links.service.js";

export class ListSignedLinksController {
  constructor(private readonly listSignedLinks: ListSignedLinksService) {}

  handle = async (c: Context<AppEnv>) => {
    const links = await this.listSignedLinks.execute(c.req.param("fileId")!, c.get("userId"));
    return c.json({ links: links.map(toPublicSignedLink) });
  };
}
