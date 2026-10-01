import { hash, verify } from "@node-rs/argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Share } from "../store/db.js";

export const UNLOCK_COOKIE = "mt_unlock";

export function hashPassword(password: string): Promise<string> {
  // @node-rs/argon2 defaults to argon2id
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function cookiePath(share: Share): string {
  return `/api/public/timeline/${share.token}`;
}

/** Cookie payload: shareId:passwordVersion:expiresEpochSeconds (signed by @fastify/cookie). */
export function setUnlockCookie(reply: FastifyReply, share: Share, ttlHours: number): void {
  const maxAge = Math.round(ttlHours * 3600);
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  reply.setCookie(UNLOCK_COOKIE, `${share.id}:${share.passwordVersion}:${exp}`, {
    path: cookiePath(share),
    httpOnly: true,
    sameSite: "lax",
    secure: "auto",
    signed: true,
    maxAge,
  });
}

export function isUnlocked(req: FastifyRequest, share: Share): boolean {
  const raw = req.cookies[UNLOCK_COOKIE];
  if (!raw) return false;
  const { valid, value } = req.unsignCookie(raw);
  if (!valid || !value) return false;
  const [id, version, exp] = value.split(":").map(Number);
  return id === share.id && version === share.passwordVersion && exp! > Date.now() / 1000;
}
