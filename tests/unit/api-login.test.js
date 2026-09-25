import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

globalThis.window = { LOCAL_CONFIG: { proxyUrl: "https://proxy.test/exec" } };
const { login, ApiError } = await import("../../src/api.js");

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const networkError = () => Promise.reject(new TypeError("Failed to fetch"));

describe("login", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { delete globalThis.fetch; });

  it("retries once after a network failure", async () => {
    fetch.mockImplementationOnce(networkError).mockResolvedValueOnce(ok({ success: true, token: "t1" }));
    await expect(login("pw")).resolves.toEqual({ token: "t1" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second failure", async () => {
    fetch.mockImplementation(networkError);
    await expect(login("pw")).rejects.toMatchObject({ code: "network" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a wrong password", async () => {
    fetch.mockResolvedValue(ok({ success: false, error: "invalid_password" }));
    await expect(login("pw")).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
