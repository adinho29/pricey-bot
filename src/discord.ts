import type { Credentials } from "./config.js";

export class SendError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "SendError";
  }
}

/** Discord rejects message content longer than this many characters. */
export const DISCORD_MAX_CONTENT = 2000;

function hardSplit(line: string, limit: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < line.length; i += limit) pieces.push(line.slice(i, i + limit));
  return pieces;
}

/** Splits text into chunks of at most `limit` characters, cutting at line boundaries where possible. */
export function splitContent(text: string, limit = DISCORD_MAX_CONTENT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    for (const piece of line.length > limit ? hardSplit(line, limit) : [line]) {
      if (current === "") {
        current = piece;
      } else if (current.length + 1 + piece.length <= limit) {
        current += `\n${piece}`;
      } else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

/** The second path segment after /api/webhooks/ is the webhook's secret token. */
function webhookToken(webhookUrl: string): string {
  try {
    return new URL(webhookUrl).pathname.match(/^\/api\/webhooks\/[^/]+\/([^/]+)/)?.[1] ?? "";
  } catch {
    return "";
  }
}

function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join("[redacted]") : text;
}

async function bodyExcerpt(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

async function post(content: string, creds: Credentials, fetchFn: typeof fetch): Promise<string> {
  const secret = webhookToken(creds.webhookUrl);
  const url = new URL(creds.webhookUrl);
  url.searchParams.set("wait", "true"); // ask Discord to return the created message
  let res: Response;
  try {
    res = await fetchFn(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    // Node's fetch says only "fetch failed"; the real reason (ENOTFOUND, TLS, proxy) is in err.cause.
    const message = redact((err as Error).message, secret);
    const cause = (err as { cause?: { message?: unknown } }).cause?.message;
    const detail = typeof cause === "string" && cause !== "" ? ` (${redact(cause, secret)})` : "";
    throw new SendError(`Discord webhook request failed: ${message}${detail}`);
  }
  if (!res.ok) {
    const excerpt = redact(await bodyExcerpt(res), secret);
    throw new SendError(`Discord webhook responded ${res.status}: ${excerpt}`, res.status);
  }
  if (res.status === 204) return "";
  const body = (await res.json().catch(() => ({}))) as { id?: unknown };
  return typeof body.id === "string" ? body.id : "";
}

/**
 * Posts the text to the channel behind the webhook, in several messages if it exceeds
 * Discord's limit. Resolves with the id of the last message created.
 */
export async function sendToChannel(text: string, creds: Credentials, fetchFn: typeof fetch = fetch): Promise<string> {
  let lastId = "";
  for (const chunk of splitContent(text)) {
    lastId = await post(chunk, creds, fetchFn);
  }
  return lastId;
}
