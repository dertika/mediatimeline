import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { FastifyReply, FastifyRequest } from "fastify";

const FORWARDED_REQUEST_HEADERS = ["range", "if-none-match", "if-modified-since", "if-range"];
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export function forwardableHeaders(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

/** Pipes an upstream Immich media response to the client without buffering. */
export function pipeUpstream(
  reply: FastifyReply,
  upstream: Response,
  cacheControl: string,
): FastifyReply {
  if (upstream.status === 404) {
    void upstream.body?.cancel();
    return reply.code(404).send({ error: "not_found" });
  }
  if (!upstream.ok && upstream.status !== 304 && upstream.status !== 416) {
    void upstream.body?.cancel();
    return reply.code(502).send({ error: "upstream_error" });
  }

  reply.code(upstream.status);
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) reply.header(name, value);
  }
  reply.header("cache-control", cacheControl);

  if (!upstream.body || upstream.status === 304) return reply.send();
  return reply.send(Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>));
}
