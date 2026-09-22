/**
 * Hand-authored OpenAPI 3.0 document describing every route this service
 * exposes. Served as raw JSON at GET /openapi.json and as an interactive
 * explorer (Swagger UI) at GET /docs — see src/app.ts. Keep this in sync
 * with src/modules/**\/*.routes.ts when adding or changing an endpoint.
 */
export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Signed File API",
    version: "1.0.0",
    description:
      "Private file uploads, metadata management, and cryptographically signed temporary download links.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Health", description: "Liveness" },
    { name: "Files", description: "Upload, list, update, delete file metadata" },
    { name: "Signed Links", description: "Create, list, and revoke signed download links" },
    { name: "Downloads", description: "Public, signature-gated file retrieval" },
    { name: "Audit", description: "Audit trail for a file" },
    { name: "Observability", description: "Metrics for monitoring and alerting" },
  ],
  components: {
    securitySchemes: {
      UserId: {
        type: "apiKey",
        in: "header",
        name: "X-User-Id",
        description: "Caller identity. All /files* endpoints are scoped to this value.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
        },
        required: ["error", "code"],
      },
      File: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string" },
          filename: { type: "string" },
          contentType: { type: "string" },
          sizeBytes: { type: "integer" },
          uploadedAt: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["stored"] },
        },
      },
      SignedLink: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          fileId: { type: "string", format: "uuid" },
          ttlSeconds: { type: "integer" },
          expiresAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          revokedAt: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", enum: ["active", "revoked"] },
        },
      },
      AuditEvent: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          fileId: { type: "string", format: "uuid" },
          userId: { type: "string" },
          eventType: {
            type: "string",
            enum: [
              "signed_link_generated",
              "signed_link_revoked",
              "signed_link_downloaded",
              "signed_link_download_rejected",
              "file_renamed",
              "file_deleted",
            ],
          },
          ttlSeconds: { type: "integer", nullable: true },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          metadata: { type: "object", nullable: true, additionalProperties: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing X-User-Id header",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Forbidden: {
        description: "Caller does not own this resource",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Resource not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      ValidationError: {
        description: "Request failed validation",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  security: [{ UserId: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Liveness check",
        security: [],
        responses: {
          "200": {
            description: "Service is up",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    service: { type: "string" },
                    maxUploadBytes: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/metrics": {
      get: {
        tags: ["Observability"],
        summary: "Prometheus metrics",
        description:
          "Text exposition format (Prometheus/OpenMetrics compatible) covering HTTP request volume/latency and per-layer failure counts. Point a Prometheus scrape config or the Datadog Agent's OpenMetrics check at this endpoint.",
        security: [],
        responses: {
          "200": {
            description: "Metrics in Prometheus text format",
            content: { "text/plain": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/files": {
      post: {
        tags: ["Files"],
        summary: "Upload a file",
        description: "Accepts a file and a user id (via X-User-Id); the server generates the file id.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { file: { type: "string", format: "binary" } },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Uploaded",
            content: {
              "application/json": {
                schema: { type: "object", properties: { file: { $ref: "#/components/schemas/File" } } },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "413": { description: "File exceeds MAX_UPLOAD_BYTES" },
        },
      },
      get: {
        tags: ["Files"],
        summary: "List the caller's files",
        responses: {
          "200": {
            description: "Files owned by the caller",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { files: { type: "array", items: { $ref: "#/components/schemas/File" } } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/files/batch": {
      post: {
        tags: ["Files"],
        summary: "Batch upload files",
        description:
          "Multipart field 'files' repeated once per file. Each file is uploaded independently; one bad file does not abort the batch. Returns 201 if every file succeeded, 207 if some failed.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  files: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "All files uploaded" },
          "207": { description: "Partial success — see the `failed` array in the response body" },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/files/batch-delete": {
      post: {
        tags: ["Files"],
        summary: "Batch delete files",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  fileIds: { type: "array", items: { type: "string", format: "uuid" } },
                },
                required: ["fileIds"],
              },
            },
          },
        },
        responses: {
          "200": { description: "All deletions succeeded" },
          "207": { description: "Partial success — see the `failed` array in the response body" },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/files/{fileId}": {
      parameters: [{ name: "fileId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        tags: ["Files"],
        summary: "Get file metadata (owner only)",
        responses: {
          "200": {
            description: "File metadata",
            content: {
              "application/json": {
                schema: { type: "object", properties: { file: { $ref: "#/components/schemas/File" } } },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Files"],
        summary: "Update file metadata (rename)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { filename: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated",
            content: {
              "application/json": {
                schema: { type: "object", properties: { file: { $ref: "#/components/schemas/File" } } },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Files"],
        summary: "Delete a file (owner only)",
        description:
          "Removes the blob and the file row (cascading its signed links). Audit history for this file survives the deletion.",
        responses: {
          "200": { description: "Deleted" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/files/{fileId}/sign": {
      parameters: [{ name: "fileId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      post: {
        tags: ["Signed Links"],
        summary: "Create a signed, temporary download link",
        description:
          "HMAC-SHA256 signs (fileId, expiresAt) and persists the signature/TTL/expiry so it can be listed, revoked, and audited. The signed URL remains valid across service restarts.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { ttlSeconds: { type: "integer", minimum: 1, maximum: 86400 } },
                required: ["ttlSeconds"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Signed link created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    signedLinkId: { type: "string", format: "uuid" },
                    fileId: { type: "string", format: "uuid" },
                    downloadUrl: { type: "string", format: "uri" },
                    expiresAt: { type: "integer", description: "Unix seconds" },
                    ttlSeconds: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/files/{fileId}/links": {
      parameters: [{ name: "fileId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        tags: ["Signed Links"],
        summary: "List every signed link generated for a file",
        responses: {
          "200": {
            description: "Signed links, newest first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { links: { type: "array", items: { $ref: "#/components/schemas/SignedLink" } } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/files/{fileId}/links/{linkId}/revoke": {
      parameters: [
        { name: "fileId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        { name: "linkId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      post: {
        tags: ["Signed Links"],
        summary: "Revoke an active signed link before it expires",
        responses: {
          "200": { description: "Revoked" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { description: "Link not found or already revoked" },
        },
      },
    },
    "/files/{fileId}/audit": {
      parameters: [{ name: "fileId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
      get: {
        tags: ["Audit"],
        summary: "Full audit trail for a file",
        description:
          "Generation, downloads (success/rejected), revocations, renames, and deletes. Remains readable for a file that's since been deleted, as long as the caller has their own audit history for it.",
        responses: {
          "200": {
            description: "Audit events, newest first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { events: { type: "array", items: { $ref: "#/components/schemas/AuditEvent" } } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/download": {
      get: {
        tags: ["Downloads"],
        summary: "Download a file via a signed URL",
        description:
          "Public endpoint (no X-User-Id required). Validates the HMAC signature and expiry statelessly first, then confirms the link exists and hasn't been revoked before streaming the file.",
        security: [],
        parameters: [
          { name: "fileId", in: "query", required: true, schema: { type: "string", format: "uuid" } },
          { name: "expires", in: "query", required: true, schema: { type: "integer" }, description: "Unix seconds" },
          { name: "sig", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "File bytes",
            content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
          },
          "403": { description: "Invalid signature, expired, unknown link, or revoked link" },
          "410": { description: "Signed link is valid but the underlying blob is missing" },
        },
      },
    },
  },
} as const;
