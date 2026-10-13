import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export const CLIENT_ID = "mediatimeline";
export const CLIENT_SECRET = "s3cret";

/** What the fake provider answers; tests change it before a login. */
export interface MockOidcState {
  user: { sub: string; preferred_username?: string; email?: string; groups?: string[] };
  /** Where the user claims are put: the ID token or only the user info endpoint (like Authelia by default). */
  claimsIn: "idtoken" | "userinfo";
  /** Sends a nonce the client did not ask for. */
  wrongNonce: boolean;
}

/**
 * A small OpenID Connect provider for the tests: discovery, keys, the
 * authorization endpoint (signs in at once), the token endpoint with the PKCE
 * and secret checks, and user info. Not a replacement for a real provider.
 */
export async function startMockOidc() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const app = Fastify();
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string }>();
  const tokens = new Map<string, MockOidcState["user"]>();
  const state: MockOidcState = {
    user: { sub: "u1", preferred_username: "alice", email: "alice@example.test", groups: ["admins"] },
    claimsIn: "idtoken",
    wrongNonce: false,
  };
  let issuer = "";

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.get("/.well-known/openid-configuration", async () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
  }));
  app.get("/jwks", async () => ({ keys: [jwk] }));

  app.get<{ Querystring: Record<string, string> }>("/authorize", async (req, reply) => {
    const q = req.query;
    if (q.client_id !== CLIENT_ID || q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const code = randomUUID();
    codes.set(code, { nonce: q.nonce ?? "", challenge: q.code_challenge, redirectUri: q.redirect_uri ?? "" });
    const back = new URL(q.redirect_uri!);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.state ?? "");
    return reply.redirect(back.href);
  });

  app.post<{ Body: Record<string, string> }>("/token", async (req, reply) => {
    const b = req.body;
    const basic = req.headers.authorization?.startsWith("Basic ")
      ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":")
      : null;
    const secret = b.client_secret ?? basic?.[1];
    const entry = codes.get(b.code ?? "");
    codes.delete(b.code ?? "");
    const challenge = createHash("sha256")
      .update(b.code_verifier ?? "")
      .digest("base64url");
    if (!entry || secret !== CLIENT_SECRET || challenge !== entry.challenge || b.redirect_uri !== entry.redirectUri) {
      return reply.code(400).send({ error: "invalid_grant" });
    }
    const user = state.user;
    const accessToken = randomUUID();
    tokens.set(accessToken, user);
    const inToken = state.claimsIn === "idtoken" ? user : { sub: user.sub };
    const idToken = await new SignJWT({ ...inToken, nonce: state.wrongNonce ? "someone-elses" : entry.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { access_token: accessToken, token_type: "Bearer", expires_in: 300, id_token: idToken };
  });

  app.get("/userinfo", async (req, reply) => {
    const user = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    return user ? user : reply.code(401).send({ error: "invalid_token" });
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  issuer = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { app, issuer, state };
}
