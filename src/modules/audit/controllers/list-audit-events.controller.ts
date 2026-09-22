import type { Context } from "hono";
import type { AppEnv } from "../../../common/types/app-env.js";
import { toPublicAuditEvent } from "../audit.mapper.js";
import type { ListAuditEventsService } from "../services/list-audit-events.service.js";

export class ListAuditEventsController {
  constructor(private readonly listAuditEvents: ListAuditEventsService) {}

  handle = async (c: Context<AppEnv>) => {
    const events = await this.listAuditEvents.execute(c.req.param("fileId")!, c.get("userId"));
    return c.json({ events: events.map(toPublicAuditEvent) });
  };
}
