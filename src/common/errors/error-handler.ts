import type { ErrorHandler, NotFoundHandler } from "hono";
import { HttpError } from "./http-error.js";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code }, err.status as 400);
  }

  console.error("Unhandled error", err);
  return c.json({ error: "Internal server error", code: "INTERNAL" }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json({ error: "Not found", code: "NOT_FOUND" }, 404);
