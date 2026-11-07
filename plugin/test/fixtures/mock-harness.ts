/** Stand-alone mock ACP harness child (T007).
 *
 *  Run with `node --experimental-strip-types plugin/test/fixtures/mock-harness.ts`
 *  (Node ≥ 22 strips types by default; the flag is harmless). It serves the
 *  in-process mock agent over newline-delimited JSON on stdio.
 *
 *  Optional env flags: MOCK_LOAD_SESSION=1, MOCK_RESUME=1, MOCK_MCP_HTTP=1,
 *  MOCK_CRASH_AFTER_MS=250 (kill the process mid-turn).
 */
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createMockAgent } from "./mock-agent.ts";

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
const app = createMockAgent({
  capabilities: {
    loadSession: process.env.MOCK_LOAD_SESSION === "1",
    resume: process.env.MOCK_RESUME === "1",
    mcpHttp: process.env.MOCK_MCP_HTTP === "1",
  },
});
app.connect(stream);
const crashMs = Number(process.env.MOCK_CRASH_AFTER_MS ?? 0);
if (crashMs > 0) setTimeout(() => process.exit(1), crashMs);
