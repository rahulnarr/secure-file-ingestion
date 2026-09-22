# Architecture: Signed File API

High-level request lifecycle and data flow for private uploads and cryptographically signed downloads.

```mermaid
flowchart TD
  subgraph clients [Clients]
    Owner[Authenticated owner<br/>X-User-Id]
    Recipient[Anyone with a signed URL]
  end

  subgraph api [signed-file-api]
    Upload["POST /files<br/>POST /files/batch"]
    Meta["GET /files<br/>GET /files/:id<br/>PATCH /files/:id"]
    Delete["DELETE /files/:id<br/>POST /files/batch-delete"]
    Sign["POST /files/:id/sign"]
    Links["GET /files/:id/links<br/>POST /files/:id/links/:linkId/revoke"]
    Audit["GET /files/:id/audit"]
    Download["GET /download?fileId&expires&sig"]
    Signer[HMAC-SHA256 signer<br/>fileId + TTL -> signature<br/>shared SIGNING_SECRET]
    Guard[Signature + expiry validator<br/>stateless, no DB read]
  end

  subgraph storage [Persistence]
    FS[(Non-public local uploads directory<br/>file bytes)]
    PG[(PostgreSQL<br/>files · signed_links · audit_events)]
  end

  Owner --> Upload
  Upload --> FS
  Upload --> PG

  Owner --> Meta
  Meta --> PG

  Owner --> Delete
  Delete -->|remove blob| FS
  Delete -->|delete row + cascade signed_links| PG
  Delete -->|audit: file_deleted<br/>survives the delete| PG

  Owner --> Sign
  Sign --> Signer
  Sign -->|persist signature, TTL, expiry| PG
  Sign -->|audit: signed_link_generated| PG
  Sign -->|signed URL| Owner

  Owner --> Links
  Links --> PG

  Owner -->|share URL| Recipient
  Recipient --> Download
  Download --> Guard
  Guard -->|1. crypto valid?| PG
  PG -->|2. exists & not revoked?| Guard
  Guard -->|valid| FS
  Guard -->|invalid, expired, or revoked| Recipient
  FS -->|file bytes| Recipient
  Download -->|audit: downloaded / rejected| PG

  Owner --> Audit
  Audit --> PG
```

## Lifecycle notes

1. **Upload** — Multipart bytes land only under the configured non-public `UPLOAD_DIR` on local disk. Metadata (owner, filename, size, content type, path) is written to the `files` table in Postgres. `POST /files/batch` does the same for multiple files in one request, uploading each independently so one bad file (empty, too large) doesn't fail the rest.
2. **Metadata & lifecycle** — Owners can list (`GET /files`), fetch (`GET /files/:id`), rename (`PATCH /files/:id`), and delete (`DELETE /files/:id`, or `POST /files/batch-delete` for many) files scoped strictly to their `X-User-Id`. Delete removes the blob from disk and the `files` row (cascading its `signed_links`), but preserves a `file_deleted` audit event with a metadata snapshot of what was removed.
3. **Sign** — Owner requests a TTL for a `fileId`. The service derives an HMAC-SHA256 signature over `fileId.expiresAt` using `SIGNING_SECRET`, then persists the signature, TTL, and expiry in the `signed_links` table and records a `signed_link_generated` audit event. Because the signature is a pure function of `(fileId, expiresAt, secret)`, it can always be recomputed and re-verified even if the process restarts.
4. **Download** — Public endpoint runs two checks in order:
   - **Stateless crypto check**: recompute the HMAC and check expiry — rejects tampered or expired links instantly without a database round trip.
   - **Postgres check**: confirm a matching `signed_links` row exists and `revoked_at IS NULL` — this is what makes revocation possible and confirms the link was actually issued by this service (not just well-formed).
   Every attempt (success or rejection) writes an audit event.
5. **Link management** — Owners can list all signed links ever generated for a file (`GET /files/:id/links`) with status (`active`/`revoked`) and revoke any active link before its natural expiry (`POST /files/:id/links/:linkId/revoke`).
6. **Audit** — `GET /files/:id/audit` returns the full event history: generation, successful downloads, rejected downloads, revocations, renames, and deletes. Audit events have **no foreign key to `files`**, by design — an audit trail must remain queryable after the resource it describes is gone.

## Layered request flow (Controller → Service → Repository)

Every endpoint follows the same path through the layers. Signed-link download is shown here as an example:

```mermaid
flowchart LR
  Req["GET /download?fileId&expires&sig"] --> Route[downloads.routes.ts]
  Route --> Ctrl[DownloadFileController<br/>parse query, build Response]
  Ctrl --> Svc[DownloadFileService<br/>orchestrates the use case]
  Svc --> Signer[UrlSigner<br/>stateless HMAC + expiry]
  Svc --> Access[FileAccessService<br/>resolve file]
  Svc --> Redeem[RedeemSignedLinkService<br/>provenance + revocation + audit]
  Svc --> Blob[BlobStorage interface]
  Access --> FileRepo[FileRepository interface]
  Redeem --> LinkRepo[SignedLinkRepository interface]
  Redeem --> Audit[RecordAuditEventService]
  Audit --> AuditRepo[AuditRepository interface]
  FileRepo -.-> PG[(PostgreSQL)]
  LinkRepo -.-> PG
  AuditRepo -.-> PG
  Blob -.-> FS[(Local disk)]
```

- **Controllers** only translate HTTP to and from a service call.
- **Services** hold one use case each, and depend on repository and storage **interfaces**, not concrete implementations.
- **Repositories** own the SQL for a single table.
- `container.ts` is the composition root. It binds each interface to its implementation (`Pg*Repository`, `LocalBlobStorage`), so a different backend such as DigitalOcean Spaces means adding an implementation without editing any service.

## Exceptions, logging, and retries

```mermaid
flowchart TD
  Controller[Any controller] --> Service[Any service]
  Service -->|calls a method on| RepoIface[FileRepository / SignedLinkRepository /<br/>AuditRepository / BlobStorage interface]
  RepoIface -.->|container.ts wraps the real impl with| Proxy[makeResilient Proxy]
  Proxy --> Retry[withRetry: exponential backoff + jitter,<br/>bounded by maxAttempts AND maxElapsedMs]
  Retry -->|calls the real method| Impl[Pg*Repository / LocalBlobStorage]
  Impl -->|throws raw pg/fs error| Retry
  Retry -->|isRetryableDatabaseError /<br/>isRetryableStorageError says yes,<br/>budget remains| Retry
  Retry -->|non-retryable, or budget exhausted| Wrap[wrapDatabaseError / wrapStorageError]
  Wrap -->|permanent failure| DBErr[DatabaseError / StorageError<br/>isRetryable=false]
  Wrap -->|was transient, ran out of budget| Exhausted[RetryExhaustedError]
  DBErr --> Bubble[AppError propagates up through<br/>service -> controller -> Hono]
  Exhausted --> Bubble
  Service -->|throws directly for business rules| Domain[ValidationError / NotFoundError /<br/>ForbiddenError / UnauthorizedError]
  Domain --> Bubble
  Bubble --> Handler[Global error handler]
  Handler -->|logs full AppError metadata| Logger[(pino structured logger)]
  Handler -->|error, code, correct HTTP status| Client[HTTP response]
```

Every custom exception — whatever layer it's thrown from — shares one base, `AppError`: a `code`, an HTTP `statusCode`, an `isRetryable` flag, structured `context`, and (via `Error.cause`) the original low-level failure. That uniformity is what lets the single global error handler log every failure the same way and always return a consistent `{ error, code }` body, regardless of whether the root cause was a validation rule, an ownership check, a dropped Postgres connection, or a busy filesystem handle.

Retrying happens once, generically, at the repository/storage boundary — not scattered through service code — via a `Proxy` (`makeResilient`) that `container.ts` wraps around every `Pg*Repository` and the `BlobStorage`. This is the boundary where "client-to-service call during file creation and storage" (writing the blob, inserting the `files` row) and "persisting to the DB" (every other repository call) actually happen, so it covers both cases the same way without each service needing its own retry logic.

## Why Postgres instead of only stateless HMAC verification

The signature alone is enough to prove a link *could* have come from this service, but storing the generated link in Postgres adds real product value beyond cryptographic proof:

- **Revocation** — an owner can invalidate a leaked link immediately, without waiting for TTL expiry or rotating the shared secret (which would invalidate every other outstanding link too).
- **Auditability** — "list every link ever generated for this file" and "list every download attempt" are only possible with a persisted record.
- **Restart safety is preserved** — Postgres, like the HMAC secret, is durable across process restarts, so this doesn't reintroduce the in-memory-state problem the signing scheme was designed to avoid.

## Deployment (DigitalOcean)

```mermaid
flowchart LR
  Dev[git push origin main] --> GHA[GitHub Actions: deploy.yml]
  GHA -->|1. run full test suite| CI[ci.yml, reused via workflow_call]
  CI -->|pass| SCP[scp rendered .env]
  SCP --> SSH[ssh: git pull, npm ci, npm run build, systemctl restart]
  SSH --> Droplet[Droplet: Caddy :80/:443 -> node :3847]
  Droplet --> PG[(DO Managed PostgreSQL)]
  Droplet --> Disk[(Droplet's local disk: uploads/)]
```

- **File bytes** (`UPLOAD_DIR`) stay on local disk on the Droplet — this is why the target is a Droplet with a persistent volume, not App Platform's ephemeral filesystem or a multi-instance deployment (see the Droplet vs. App Platform discussion above).
- **Metadata, signed links, and audit events** live in a DigitalOcean **Managed PostgreSQL** cluster — same `DATABASE_URL`-driven config as local dev, no code changes.
- **Caddy** terminates TLS (automatic, once a domain is pointed at the Droplet) and reverse-proxies to the app, which only listens on `127.0.0.1`; the DO Firewall exposes just 22/80/443.
- See [`infra/README.md`](../infra/README.md) for the exact provisioning and deploy commands, and `.github/workflows/deploy.yml` for the CI/CD pipeline that runs the test suite before every deploy.
