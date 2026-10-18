/**
 * `fetch` for the admin API. When the Authelia session has expired, the proxy answers
 * with a redirect to the login page of another origin, which a plain `fetch` can only
 * report as a network error. Here that case reloads the page instead, so that the
 * browser itself is sent to the login and comes back to the admin page afterwards.
 */

const RELOAD_KEY = "mt-admin-login-reload";
/** At most one automatic reload in this time, so that a misbehaving proxy cannot cause a loop. */
const RELOAD_WINDOW_MS = 15_000;

/** Reloads the page to reach the login; false if it did so just now already (or cannot tell). */
export function reloadForLogin(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY)) < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** Whether the admin page itself would now redirect to a login. */
async function sessionExpired(): Promise<boolean> {
  try {
    const res = await fetch("/admin", { redirect: "manual", cache: "no-store" });
    return res.type === "opaqueredirect";
  } catch {
    return false;
  }
}

export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(input, { ...init, redirect: "manual" });
  } catch (err) {
    if (init.signal?.aborted || (err as Error).name === "AbortError") throw err;
    // A network error: only reload when the session is the reason, not when the connection is down.
    if (await sessionExpired()) reloadForLogin();
    throw err;
  }
  if (res.type === "opaqueredirect") {
    reloadForLogin();
    throw new Error("session expired");
  }
  return res;
}
