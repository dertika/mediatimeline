import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminFetch, reloadForLogin } from "./adminFetch";

const redirect = () => ({ type: "opaqueredirect", status: 0 }) as Response;
const ok = (status = 200) => new Response("{}", { status });

describe("adminFetch", () => {
  let reload: ReturnType<typeof vi.fn>;
  let store: Record<string, string>;
  let now: number;

  beforeEach(() => {
    reload = vi.fn();
    store = {};
    now = 1_000_000;
    vi.stubGlobal("location", { reload });
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) });
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reloads the page when the proxy redirects to the login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => redirect()));
    await expect(adminFetch("/api/admin/me")).rejects.toThrow("session expired");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("asks fetch not to follow redirects", async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    await adminFetch("/api/admin/me", { method: "POST" });
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/me", { method: "POST", redirect: "manual" });
  });

  it("passes normal answers through, including errors", async () => {
    for (const status of [200, 401, 403, 502]) {
      vi.stubGlobal("fetch", vi.fn(async () => ok(status)));
      expect((await adminFetch("/api/admin/me")).status).toBe(status);
    }
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads after a network error when the admin page redirects to the login", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/admin") return redirect();
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(adminFetch("/api/admin/me")).rejects.toThrow("Failed to fetch");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the connection is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(adminFetch("/api/admin/me")).rejects.toThrow("Failed to fetch");
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the admin page answers normally", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/admin") return ok();
      throw new TypeError("Failed to fetch");
    }));
    await expect(adminFetch("/api/admin/me")).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves aborted requests alone", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(adminFetch("/api/admin/geocode?q=a", { signal: controller.signal })).rejects.toThrow("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads at most once in 15 seconds", () => {
    expect(reloadForLogin()).toBe(true);
    now += 5_000;
    expect(reloadForLogin()).toBe(false);
    now += 11_000;
    expect(reloadForLogin()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload without usable session storage", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    });
    expect(reloadForLogin()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
