import type { FastifyReply, FastifyRequest } from "fastify";
import proxyAddr from "proxy-addr";
import type { OidcSession } from "./oidc.js";

export interface AdminGuardOptions {
  trustedProxies: string[];
  userHeader: string;
  groupsHeader: string;
  allowedGroups: string[];
  /** Only with OpenID Connect: the second way to sign in, a signed session cookie. */
  oidc?: {
    readSession: (req: FastifyRequest) => OidcSession | null;
    /** Origin of server.publicBaseUrl, to turn away cross-site changes. */
    origin: string;
    /** Where the admin page sends people who are not signed in. */
    loginPath: string;
  };
}

export interface AdminUser {
  name: string;
  groups: string[];
  /** Through the proxy's headers (Authelia) or an OpenID Connect session. */
  via: "header" | "oidc";
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
 * Without those headers an OpenID Connect session (if configured) is the
 * other way in.
 */
export function createAdminGuard(opts: AdminGuardOptions) {
  const isTrusted = proxyAddr.compile(opts.trustedProxies);
  const userHeader = opts.userHeader.toLowerCase();
  const groupsHeader = opts.groupsHeader.toLowerCase();

  const inAllowedGroup = (groups: string[]) =>
    opts.allowedGroups.length === 0 || groups.some((g) => opts.allowedGroups.includes(g));
  const changesData = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);

  return async function adminGuard(req: FastifyRequest, reply: FastifyReply) {
    const peer = req.socket.remoteAddress ?? "";
    const user = req.headers[userHeader];
    if (isTrusted(peer, 0) && typeof user === "string" && user.trim() !== "") {
      const rawGroups = req.headers[groupsHeader];
      const groups = (typeof rawGroups === "string" ? rawGroups : "")
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
      if (!inAllowedGroup(groups)) return reply.code(403).send({ error: "forbidden" });
      req.adminUser = { name: user.trim(), groups, via: "header" };
      return;
    }

    const session = opts.oidc?.readSession(req);
    if (opts.oidc && session) {
      // A browser sends Origin on cross-site changes; own pages and plain tools send none or the right one.
      if (changesData(req.method) && req.headers.origin !== undefined && req.headers.origin !== opts.oidc.origin) {
        return reply.code(403).send({ error: "forbidden" });
      }
      if (!inAllowedGroup(session.groups)) return reply.code(403).send({ error: "forbidden" });
      req.adminUser = { name: session.name, groups: session.groups, via: "oidc" };
      return;
    }
    return reply.code(401).send(opts.oidc ? { error: "unauthorized", login: opts.oidc.loginPath } : { error: "unauthorized" });
  };
}
