import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "../errors/http-error.js";

export async function parseJsonBody<S extends z.ZodType>(
  c: Context,
  schema: S,
  onInvalid: { message: string; code: string },
): Promise<z.infer<S>> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    throw new HttpError(400, "JSON body required", "INVALID_JSON");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new HttpError(400, onInvalid.message, onInvalid.code);
  }
  return parsed.data;
}
