import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "../../src/common/validation/parse-json-body.js";

function fakeContext(json: () => Promise<unknown>): Context {
  return { req: { json } } as unknown as Context;
}

const schema = z.object({ ttlSeconds: z.number().int().min(1) });

describe("parseJsonBody", () => {
  it("returns the parsed data when it matches the schema", async () => {
    const c = fakeContext(async () => ({ ttlSeconds: 60 }));
    await expect(
      parseJsonBody(c, schema, { message: "invalid", code: "BAD" }),
    ).resolves.toEqual({ ttlSeconds: 60 });
  });

  it("throws ValidationError when the body isn't valid JSON", async () => {
    const c = fakeContext(async () => {
      throw new Error("not json");
    });
    await expect(
      parseJsonBody(c, schema, { message: "invalid", code: "BAD" }),
    ).rejects.toMatchObject({ code: "INVALID_JSON", statusCode: 400 });
  });

  it("throws ValidationError with the caller's message/code when schema validation fails", async () => {
    const c = fakeContext(async () => ({ ttlSeconds: -1 }));
    await expect(
      parseJsonBody(c, schema, { message: "ttlSeconds must be positive", code: "INVALID_TTL" }),
    ).rejects.toMatchObject({ code: "INVALID_TTL", message: "ttlSeconds must be positive" });
  });
});
