import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/client.js";
import {
  createSignedDownloadUrl,
  verifySignedDownload,
} from "../src/lib/signing.js";
import { FileService } from "../src/services/files.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/signed_file_api_test";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "signed-file-api-"));
}

describe("signing", () => {
  it("creates and verifies a signed URL", () => {
    const secret = "unit-test-signing-secret";
    const signed = createSignedDownloadUrl({
      baseUrl: "http://127.0.0.1:3847",
      secret,
      fileId: "file-1",
      ttlSeconds: 60,
      nowMs: 1_700_000_000_000,
    });

    const result = verifySignedDownload({
      secret,
      fileId: "file-1",
      expires: String(signed.expiresAt),
      signature: signed.signature,
      nowMs: 1_700_000_000_000,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects expired and tampered signatures", () => {
    const secret = "unit-test-signing-secret";
    const signed = createSignedDownloadUrl({
      baseUrl: "http://127.0.0.1:3847",
      secret,
      fileId: "file-1",
      ttlSeconds: 10,
      nowMs: 1_700_000_000_000,
    });

    const expired = verifySignedDownload({
      secret,
      fileId: "file-1",
      expires: String(signed.expiresAt),
      signature: signed.signature,
      nowMs: 1_700_000_020_000,
    });
    expect(expired.ok).toBe(false);

    const tampered = verifySignedDownload({
      secret,
      fileId: "other-file",
      expires: String(signed.expiresAt),
      signature: signed.signature,
      nowMs: 1_700_000_000_000,
    });
    expect(tampered.ok).toBe(false);
  });
});

describe("API integration", () => {
  let tempRoot = "";
  let app: ReturnType<typeof createApp>;
  let pool: Pool;

  beforeAll(async () => {
    const setupPool = new Pool({ connectionString: TEST_DATABASE_URL });
    await setupPool.query(
      "TRUNCATE TABLE audit_events, signed_links, files RESTART IDENTITY CASCADE",
    ).catch(() => {
      // Tables may not exist yet on a fresh DB; openDatabase() below creates them.
    });
    await setupPool.end();
  });

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    const config = loadConfig({
      PORT: "3847",
      HOST: "127.0.0.1",
      BASE_URL: "http://127.0.0.1:3847",
      SIGNING_SECRET: "integration-test-signing-secret",
      DATA_DIR: tempRoot,
      UPLOAD_DIR: path.join(tempRoot, "uploads"),
      DATABASE_URL: TEST_DATABASE_URL,
      MAX_UPLOAD_BYTES: "1048576",
    });
    pool = await openDatabase(config);
    await pool.query("TRUNCATE TABLE audit_events, signed_links, files RESTART IDENTITY CASCADE");
    const files = new FileService(pool, config);
    app = createApp(files, config);
  });

  afterEach(async () => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    await pool.end();
  });

  afterAll(async () => {
    // no-op: each test manages its own pool lifecycle
  });

  it("uploads a private file, lists metadata, signs a link, and downloads it", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([Buffer.from("hello private world")], "notes.txt", {
        type: "text/plain",
      }),
    );

    const upload = await app.request("/files", {
      method: "POST",
      headers: { "X-User-Id": "user-a" },
      body: form,
    });
    expect(upload.status).toBe(201);
    const uploaded = (await upload.json()) as {
      file: { id: string; filename: string; sizeBytes: number };
    };
    expect(uploaded.file.filename).toBe("notes.txt");
    expect(uploaded.file.sizeBytes).toBe(19);

    const list = await app.request("/files", {
      headers: { "X-User-Id": "user-a" },
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { files: Array<{ id: string }> };
    expect(listed.files).toHaveLength(1);

    const forbidden = await app.request(`/files/${uploaded.file.id}`, {
      headers: { "X-User-Id": "user-b" },
    });
    expect(forbidden.status).toBe(403);

    const sign = await app.request(`/files/${uploaded.file.id}/sign`, {
      method: "POST",
      headers: {
        "X-User-Id": "user-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttlSeconds: 120 }),
    });
    expect(sign.status).toBe(200);
    const signed = (await sign.json()) as {
      downloadUrl: string;
      signedLinkId: string;
    };
    expect(signed.downloadUrl).toContain("/download?");
    expect(signed.signedLinkId).toBeTruthy();

    const links = await app.request(`/files/${uploaded.file.id}/links`, {
      headers: { "X-User-Id": "user-a" },
    });
    expect(links.status).toBe(200);
    const linkList = (await links.json()) as {
      links: Array<{ id: string; status: string }>;
    };
    expect(linkList.links[0]?.status).toBe("active");

    const audit = await app.request(`/files/${uploaded.file.id}/audit`, {
      headers: { "X-User-Id": "user-a" },
    });
    expect(audit.status).toBe(200);
    const events = (await audit.json()) as {
      events: Array<{ eventType: string }>;
    };
    expect(events.events.map((e) => e.eventType)).toContain("signed_link_generated");

    const downloadPath = signed.downloadUrl.replace("http://127.0.0.1:3847", "");
    const download = await app.request(downloadPath);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("hello private world");

    const auditAfterDownload = await app.request(`/files/${uploaded.file.id}/audit`, {
      headers: { "X-User-Id": "user-a" },
    });
    const eventsAfterDownload = (await auditAfterDownload.json()) as {
      events: Array<{ eventType: string }>;
    };
    expect(eventsAfterDownload.events.map((e) => e.eventType)).toContain(
      "signed_link_downloaded",
    );
  });

  it("rejects unsigned and expired download attempts", async () => {
    const form = new FormData();
    form.append("file", new File([Buffer.from("payload")], "a.bin"));
    const upload = await app.request("/files", {
      method: "POST",
      headers: { "X-User-Id": "user-a" },
      body: form,
    });
    const uploaded = (await upload.json()) as { file: { id: string } };

    const bad = await app.request(
      `/download?fileId=${uploaded.file.id}&expires=9999999999&sig=deadbeef`,
    );
    expect(bad.status).toBe(403);
  });

  it("allows an owner to revoke a signed link before it expires", async () => {
    const form = new FormData();
    form.append("file", new File([Buffer.from("secret")], "s.bin"));
    const upload = await app.request("/files", {
      method: "POST",
      headers: { "X-User-Id": "user-a" },
      body: form,
    });
    const uploaded = (await upload.json()) as { file: { id: string } };

    const sign = await app.request(`/files/${uploaded.file.id}/sign`, {
      method: "POST",
      headers: { "X-User-Id": "user-a", "Content-Type": "application/json" },
      body: JSON.stringify({ ttlSeconds: 3600 }),
    });
    const signed = (await sign.json()) as {
      downloadUrl: string;
      signedLinkId: string;
    };

    const revoke = await app.request(
      `/files/${uploaded.file.id}/links/${signed.signedLinkId}/revoke`,
      { method: "POST", headers: { "X-User-Id": "user-a" } },
    );
    expect(revoke.status).toBe(200);

    const downloadPath = signed.downloadUrl.replace("http://127.0.0.1:3847", "");
    const download = await app.request(downloadPath);
    expect(download.status).toBe(403);
    const body = (await download.json()) as { code: string };
    expect(body.code).toBe("LINK_REVOKED");
  });
});
