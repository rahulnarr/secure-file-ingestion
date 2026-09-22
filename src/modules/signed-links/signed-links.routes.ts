import { Hono } from "hono";
import type { AppEnv } from "../../common/types/app-env.js";
import type { CreateSignedLinkController } from "./controllers/create-signed-link.controller.js";
import type { ListSignedLinksController } from "./controllers/list-signed-links.controller.js";
import type { RevokeSignedLinkController } from "./controllers/revoke-signed-link.controller.js";

export type SignedLinksControllers = {
  create: CreateSignedLinkController;
  list: ListSignedLinksController;
  revoke: RevokeSignedLinkController;
};

export function createSignedLinksRoutes(controllers: SignedLinksControllers) {
  const router = new Hono<AppEnv>();

  router.post("/:fileId/sign", controllers.create.handle);
  router.get("/:fileId/links", controllers.list.handle);
  router.post("/:fileId/links/:linkId/revoke", controllers.revoke.handle);

  return router;
}
