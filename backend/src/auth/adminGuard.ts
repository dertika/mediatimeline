import type { FastifyReply, FastifyRequest } from "fastify";
import proxyAddr from "proxy-addr";

export interface AdminGuardOptions {
  trustedProxies: string[];
  userHeader: string;
  groupsHeader: string;
  allowedGroups: string[];
}

export interface AdminUser {
  name: string;
  groups: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    adminUser?: AdminUser;
  }
}

/**
 * Authelia (via nginx forward auth) sets Remote-User/Remote-Groups. Those
 * headers are only trusted when the TCP peer is one of the trusted proxies, so
 * a client that reaches the container directly cannot impersonate an admin.
 */
export function createAdminGuard(opts: AdminGuardOptions) {
  const isTrusted = proxyAddr.compile(opts.trustedProxies);
  const userHeader = opts.userHeader.toLowerCase();
  const groupsHeader = opts.groupsHeader.toLowerCase();

  return async function adminGuard(req: FastifyRequest, reply: FastifyReply) {
    const peer = req.socket.remoteAddress ?? "";
    const user = req.headers[userHeader];
    if (!isTrusted(peer, 0) || typeof user !== "string" || user.trim() === "") {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const rawGroups = req.headers[groupsHeader];
    const groups = (typeof rawGroups === "string" ? rawGroups : "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    if (opts.allowedGroups.length > 0 && !groups.some((g) => opts.allowedGroups.includes(g))) {
      return reply.code(403).send({ error: "forbidden" });
    }
    req.adminUser = { name: user.trim(), groups };
  };
}
