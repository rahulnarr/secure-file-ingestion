import type { Context } from "hono";
import type { z } from "zod";
import { ValidationError } from "../errors/domain-errors.js";

export async function parseJsonBody<S extends z.ZodType>(
  c: Context,
  schema: S,
  onInvalid: { message: string; code: string },
): Promise<z.infer<S>> {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    throw new ValidationError("JSON body required", "INVALID_JSON");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError(onInvalid.message, onInvalid.code, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}
