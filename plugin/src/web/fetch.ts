/** `web_fetch` transport (desktop host only; redesign §6).
 *
 *  A plain Node request: no cookies, no Obsidian or Web viewer session, a
 *  fixed user agent. Every hop (the URL and each redirect) passes `urlRefusal`
 *  and every resolved address must be public; the address check runs inside
 *  the socket's DNS lookup, so what was checked is what gets connected to.
 *  Size, time and redirect counts are capped. */
import { loadNodeModule } from "../shell/node.ts";
import { isPublicAddress, urlRefusal } from "./policy.ts";

type Http = typeof import("node:http");
type Dns = typeof import("node:dns");

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
const USER_AGENT = "Mozilla/5.0 (compatible; obsidian-chat web_fetch)";

export async function safeFetch(raw: string): Promise<FetchResult> {
  const http = await loadNodeModule<Http>("node:http");
  const https = await loadNodeModule<Http>("node:https");
  const dns = await loadNodeModule<Dns>("node:dns");
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refusal = urlRefusal(current);
    if (refusal) throw new Error(`refused: ${refusal}`);
    const url = new URL(current);
    const response = await requestOnce(url, url.protocol === "https:" ? https : http, dns);
    if (response.redirect) {
      current = new URL(response.redirect, url).toString();
      continue;
    }
    return { ...response.result!, url: url.toString() };
  }
  throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
}

function requestOnce(
  url: URL,
  transport: Http,
  dns: Dns,
): Promise<{ redirect?: string; result?: Omit<FetchResult, "url"> }> {
  return new Promise((resolve, reject) => {
    // Resolve, then refuse any non-public address before the socket connects.
    const lookup = (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err);
        const list = addresses as Array<{ address: string; family: number }>;
        const bad = list.find((entry) => !isPublicAddress(entry.address));
        if (!list.length || bad) return callback(new Error(`refused: ${hostname} resolves to a non-public address`));
        const wantAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
        if (wantAll) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
      });
    };
    const request = transport.request(
      url,
      {
        method: "GET",
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
        lookup: lookup as never,
        timeout: TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ redirect: response.headers.location });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        response.on("data", (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > MAX_BYTES) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - MAX_BYTES)));
            response.destroy();
            finish();
            return;
          }
          chunks.push(chunk);
        });
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({
            result: {
              status,
              contentType: String(response.headers["content-type"] ?? ""),
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
            },
          });
        };
        response.on("end", finish);
        response.on("error", (err) => (truncated ? finish() : reject(err)));
      },
    );
    request.on("timeout", () => request.destroy(new Error(`timed out after ${TIMEOUT_MS / 1000} s`)));
    request.on("error", reject);
    request.end();
  });
}
