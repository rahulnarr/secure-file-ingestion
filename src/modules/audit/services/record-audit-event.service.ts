import type { AuditRepository } from "../audit.repository.js";
import type { NewAuditEvent } from "../audit.types.js";

export class RecordAuditEventService {
  constructor(private readonly audit: AuditRepository) {}

  execute(event: NewAuditEvent): Promise<void> {
    return this.audit.insert(event);
  }
}
