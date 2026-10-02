import type { FastifyRequest } from "fastify";
import type { Config } from "./config.js";

/** Absolute base URL for links that leave the app (share links, link previews). */
export function publicBaseUrl(config: Config, req: FastifyRequest): string {
  return config.server.publicBaseUrl ?? `${req.protocol}://${req.host}`;
}
