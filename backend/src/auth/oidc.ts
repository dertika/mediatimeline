import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as client from "openid-client";
import type { Config } from "../config.js";

/** Signed cookie with the admin session after a successful OpenID Connect login. */
export const SESSION_COOKIE = "mt_admin";
/** Short-lived signed cookie that carries state, nonce and PKCE verifier through the login. */
const LOGIN_COOKIE = "mt_oidc";
const LOGIN_COOKIE_PATH = "/api/auth";
const LOGIN_MAX_AGE_SECONDS = 600;

export interface OidcSession {
  name: string;
  groups: string[];
  /** Unix time in seconds. */
  exp: number;
}

/** Reads the session cookie; null when it is missing, forged or expired. */
export function readSession(req: FastifyRequest): OidcSession | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const { valid, value } = req.unsignCookie(raw);
  if (!valid || !value) return null;
  try {
    const session = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OidcSession>;
    if (typeof session.name !== "string" || !session.name || !Array.isArray(session.groups)) return null;
    if (typeof session.exp !== "number" || session.exp <= Date.now() / 1000) return null;
    return { name: session.name, groups: session.groups.filter((g) => typeof g === "string"), exp: session.exp };
  } catch {
    return null;
  }
}

function setSession(reply: FastifyReply, session: OidcSession, maxAge: number): void {
  reply.setCookie(SESSION_COOKIE, Buffer.from(JSON.stringify(session)).toString("base64url"), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: "auto",
    signed: true,
    maxAge,
  });
}

/** Only paths inside the admin page are valid targets after a login. */
function safeReturn(value: unknown): string {
  return typeof value === "string" && /^\/admin([/?#].*)?$/.test(value) && !value.includes("\\") ? value : "/admin";
}

/** The provider is looked up on the first login, not at startup: a wrong issuer must not stop the service. */
export class OidcProvider {
  private configuration: Promise<client.Configuration> | null = null;

  constructor(private readonly opts: NonNullable<Config["admin"]["oidc"]>) {}

  get(): Promise<client.Configuration> {
    if (!this.configuration) {
      const issuer = new URL(this.opts.issuer);
      const execute = issuer.protocol === "http:" ? [client.allowInsecureRequests] : undefined;
      const discovered = this.opts.clientSecret
        ? client.discovery(issuer, this.opts.clientId, this.opts.clientSecret, undefined, { execute })
        : client.discovery(issuer, this.opts.clientId, undefined, client.None(), { execute });
      this.configuration = discovered;
      // A failed lookup is tried again on the next login.
      discovered.catch(() => {
        if (this.configuration === discovered) this.configuration = null;
      });
    }
    return this.configuration;
  }
}

const asList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  return [];
};

export async function oidcRoutes(
  app: FastifyInstance,
  config: Config,
  oidc: OidcProvider,
): Promise<void> {
  const opts = config.admin.oidc!;
  const redirectUri = `${config.server.publicBaseUrl}/api/auth/callback`;
  const limit = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.get<{ Querystring: { return?: string } }>("/api/auth/login", limit, async (req, reply) => {
    try {
      const provider = await oidc.get();
      const verifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(provider, {
        redirect_uri: redirectUri,
        scope: opts.scopes.join(" "),
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      reply.setCookie(LOGIN_COOKIE, JSON.stringify({ state, nonce, verifier, returnTo: safeReturn(req.query.return) }), {
        path: LOGIN_COOKIE_PATH,
        httpOnly: true,
        sameSite: "lax",
        secure: "auto",
        signed: true,
        maxAge: LOGIN_MAX_AGE_SECONDS,
      });
      return reply.redirect(url.href);
    } catch (err) {
      req.log.error({ err }, "OpenID Connect: login could not be started");
      return reply.redirect("/admin?login=failed");
    }
  });

  app.get("/api/auth/callback", limit, async (req, reply) => {
    const raw = req.cookies[LOGIN_COOKIE];
    reply.clearCookie(LOGIN_COOKIE, { path: LOGIN_COOKIE_PATH });
    try {
      const unsigned = raw ? req.unsignCookie(raw) : null;
      if (!unsigned?.valid || !unsigned.value) throw new Error("login cookie missing, expired or forged");
      const login = JSON.parse(unsigned.value) as { state: string; nonce: string; verifier: string; returnTo: string };

      const provider = await oidc.get();
      const tokens = await client.authorizationCodeGrant(provider, new URL(req.url, config.server.publicBaseUrl), {
        pkceCodeVerifier: login.verifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      });
      const claims: Record<string, unknown> = { ...tokens.claims() };
      // Some providers (Authelia by default) keep user claims out of the ID token.
      if (claims[opts.groupsClaim] === undefined || (claims[opts.usernameClaim] === undefined && !claims.email)) {
        try {
          Object.assign(claims, await client.fetchUserInfo(provider, tokens.access_token, String(claims.sub)));
        } catch (err) {
          req.log.warn({ err }, "OpenID Connect: user info could not be read");
        }
      }

      const groups = asList(claims[opts.groupsClaim]);
      const allowed = config.admin.allowedGroups;
      if (allowed.length > 0 && !groups.some((g) => allowed.includes(g))) {
        req.log.warn({ groups }, "OpenID Connect: user is in none of admin.allowedGroups");
        return reply.redirect("/admin?login=forbidden");
      }
      const name = [claims[opts.usernameClaim], claims.email, claims.sub].find(
        (v): v is string => typeof v === "string" && v.trim() !== "",
      );
      if (!name) throw new Error("no user name in the token");

      const maxAge = Math.round(opts.sessionHours * 3600);
      setSession(reply, { name: name.trim(), groups, exp: Math.floor(Date.now() / 1000) + maxAge }, maxAge);
      return reply.redirect(safeReturn(login.returnTo));
    } catch (err) {
      req.log.error({ err }, "OpenID Connect: login failed");
      return reply.redirect("/admin?login=failed");
    }
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });
}
