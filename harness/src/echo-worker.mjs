#!/usr/bin/env node
/**
 * G3 echo worker — stands in for the future ACP/opencode/Pi worker.
 * Lifecycle contract (PLAN.md §2.4): gateway spawns per session, kills on
 * DELETE/idle/TTL. Speaks newline-delimited JSON on stdin/stdout:
 *   in:  {"type":"user_message","text":"..."}
 *   out: {"event":"token","data":{"text":"..."}}  | {"event":"turn_end",...}
 */
import { createInterface } from "node:readline";

const sessionId = process.argv.includes("--session")
  ? process.argv[process.argv.indexOf("--session") + 1]
  : "unknown";

function emit(event, data) {
  process.stdout.write(JSON.stringify({ event, data }) + "\n");
}

emit("log", { text: `echo worker up (pid=${process.pid}, session=${sessionId})` });

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return emit("log", { text: `bad input line: ${line.slice(0, 80)}` });
  }
  if (msg.type === "user_message") {
    // Simulate a streamed answer so the SSE path is exercised end to end.
    const reply = `echo(${sessionId.slice(0, 8)}): ${msg.text ?? ""}`;
    let i = 0;
    const t = setInterval(() => {
      const chunk = reply.slice(i, i + 6);
      i += 6;
      if (i > reply.length) {
        clearInterval(t);
        emit("turn_end", { ok: true });
        return;
      }
      emit("token", { text: chunk });
    }, 50);
  } else {
    emit("log", { text: `ignored message type: ${msg.type}` });
  }
});

process.on("SIGTERM", () => {
  emit("log", { text: "SIGTERM, exiting" });
  process.exit(0);
});
