# Architecture: Signed File API

High-level request lifecycle and data flow for private uploads and cryptographically signed downloads.

```mermaid
flowchart TD
  subgraph clients [Clients]
    Owner[Authenticated owner<br/>X-User-Id]
    Recipient[Anyone with a signed URL]
  end

  subgraph api [signed-file-api]
    Upload["POST /files"]
    Meta["GET /files<br/>GET /files/:id"]
    Sign["POST /files/:id/sign"]
    Audit["GET /files/:id/audit"]
    Download["GET /download?fileId&expires&sig"]
    Signer[HMAC-SHA256 signer<br/>shared SIGNING_SECRET]
    Guard[Signature + expiry validator]
  end

  subgraph storage [Local persistence]
    FS[(Non-public upload directory)]
    DB[(SQLite: files + audit_events)]
  end

  Owner --> Upload
  Upload --> FS
  Upload --> DB

  Owner --> Meta
  Meta --> DB

  Owner --> Sign
  Sign --> DB
  Sign --> Signer
  Sign -->|audit: signed_link_generated| DB
  Sign -->|signed URL| Owner

  Owner -->|share URL| Recipient
  Recipient --> Download
  Download --> Guard
  Guard -->|valid| FS
  Guard -->|invalid or expired| Recipient
  FS -->|file bytes| Recipient

  Owner --> Audit
  Audit --> DB
```

## Lifecycle notes

1. **Upload** — Multipart bytes land only under the configured non-public `UPLOAD_DIR`. Metadata (owner, filename, size, content type, path) is written to SQLite.
2. **Sign** — Owners request a TTL. The service HMAC-signs `fileId.expiresAt` with `SIGNING_SECRET` and records an audit event. No server-side token store is required, so links remain valid across restarts.
3. **Download** — Public endpoint recomputes the HMAC, checks expiry with a timing-safe compare, then streams the private blob if valid.
4. **Metadata / audit** — Owners can list files and inspect signed-link generation history for a given file.
