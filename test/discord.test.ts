import { describe, it, expect } from "vitest";
import { sendToChannel, splitContent, SendError, DISCORD_MAX_CONTENT } from "../src/discord.js";

const creds = { webhookUrl: "https://discord.com/api/webhooks/123456789/abcDEFtoken_XYZ" };

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("sendToChannel", () => {
  it("POSTs the text as JSON content to the webhook with wait=true and returns the message id", async () => {
    const { fn, calls } = fakeFetch(() => json({ id: "1427000000000000001", content: "hello" }));
    const id = await sendToChannel("hello", creds, fn);
    expect(id).toBe("1427000000000000001");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://discord.com/api/webhooks/123456789/abcDEFtoken_XYZ?wait=true");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ content: "hello" });
  });

  it("accepts a 204 No Content response", async () => {
    const { fn } = fakeFetch(() => new Response(null, { status: 204 }));
    await expect(sendToChannel("hello", creds, fn)).resolves.toBe("");
  });

  it("throws SendError with the status and body excerpt on a non-2xx response", async () => {
    const { fn } = fakeFetch(() => json({ message: "Unknown Webhook", code: 10015 }, 404));
    await expect(sendToChannel("hello", creds, fn)).rejects.toBeInstanceOf(SendError);
    await expect(sendToChannel("hello", creds, fn)).rejects.toMatchObject({ status: 404 });
    await expect(sendToChannel("hello", creds, fn)).rejects.toThrow(/404.*Unknown Webhook/);
  });

  it("never includes the webhook token in a SendError message", async () => {
    const throwing = (async () => {
      throw new TypeError("Failed to parse URL from discord.com/api/webhooks/123456789/abcDEFtoken_XYZ");
    }) as unknown as typeof fetch;
    const err = await sendToChannel("hello", creds, throwing).catch((e) => e as Error);
    expect(err).toBeInstanceOf(SendError);
    expect(err.message).not.toContain("abcDEFtoken_XYZ");
    expect(err.message).toContain("[redacted]");

    const { fn } = fakeFetch(() => new Response("token abcDEFtoken_XYZ invalid", { status: 401 }));
    const err2 = await sendToChannel("hello", creds, fn).catch((e) => e as Error);
    expect(err2.message).not.toContain("abcDEFtoken_XYZ");
  });

  it("wraps a network failure in SendError", async () => {
    const fn = (async () => {
      throw new Error("getaddrinfo ENOTFOUND discord.com");
    }) as unknown as typeof fetch;
    await expect(sendToChannel("hello", creds, fn)).rejects.toThrow(/ENOTFOUND/);
  });

  it("splits content over the Discord limit into several posts, in order, and returns the last id", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => `TICKER${String(i).padStart(3, "0")}.DE - 123.45 EUR - 12.10.2026 14:5${i % 10}`);
    const text = ["ETF prices - Mon 12.10.2026 15:07 Bucharest", ...lines].join("\n");
    expect(text.length).toBeGreaterThan(DISCORD_MAX_CONTENT);
    const { fn, calls } = fakeFetch((_c, i) => json({ id: `msg${i}` }));
    const id = await sendToChannel(text, creds, fn);
    expect(calls.length).toBeGreaterThan(1);
    const sent = calls.map((c) => JSON.parse(c.init?.body as string).content as string);
    for (const chunk of sent) expect(chunk.length).toBeLessThanOrEqual(DISCORD_MAX_CONTENT);
    expect(sent.join("\n")).toBe(text);
    expect(id).toBe(`msg${calls.length - 1}`);
  });
});

describe("splitContent", () => {
  it("returns the text unchanged when it fits", () => {
    expect(splitContent("a\nb", 10)).toEqual(["a\nb"]);
  });

  it("splits at line boundaries without dropping or reordering lines", () => {
    expect(splitContent("aaaa\nbbbb\ncccc", 9)).toEqual(["aaaa\nbbbb", "cccc"]);
  });

  it("hard-splits a single line longer than the limit", () => {
    expect(splitContent("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});
