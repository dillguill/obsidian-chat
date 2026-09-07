#!/usr/bin/env node
/**
 * Phase 1 relay worker — PLAN §2.4 "thin gateway v1: auth + relay + ephemeral
 * worker". This worker does NO vault work; it forwards a grounded completion
 * to an OpenAI-compatible provider using keys that live on this machine
 * (env: PROVIDER_BASE_URL, PROVIDER_API_KEY). The plugin grounds locally and
 * sends `{type:"completion", messages, model}`; we stream tokens back over
 * newline-delimited JSON the gateway re-emits as SSE.
 *
 *   in:  {"type":"completion","messages":[...],"model":"m"}
 *   out: {"event":"token","data":{"text":"..."}}
 *        {"event":"reasoning","data":{"text":"..."}}
 *        {"event":"done","data":{}}
 * Legacy: {"type":"user_message","text":"..."} still echoes (G3-compat).
 */
import { createInterface } from "node:readline";

const BASE_URL = (process.env.PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "");
const API_KEY = process.env.PROVIDER_API_KEY ?? "";

function emit(event, data) {
  process.stdout.write(JSON.stringify({ event, data }) + "\n");
}

async function streamCompletion(messages, model) {
  const url = `${BASE_URL}/chat/completions`;
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: model || "deepseek-chat", messages, stream: true }),
    });
  } catch (err) {
    emit("error", { text: `provider fetch failed: ${err.message}` });
    return;
  }
  if (!resp.ok || !resp.body) {
    const d = await resp.text().catch(() => "");
    emit("error", { text: `provider HTTP ${resp.status}: ${d.slice(0, 200)}` });
    return;
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) > -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        parseBlock(block);
      }
    }
  } catch (err) {
    emit("error", { text: `stream error: ${err.message}` });
  }
  emit("done", {});
}

function parseBlock(block) {
  let data = "";
  for (const line of block.split("\n")) if (line.startsWith("data:")) data += line.slice(5).trim();
  if (!data || data === "[DONE]") return;
  let j;
  try {
    j = JSON.parse(data);
  } catch {
    return;
  }
  const delta = j?.choices?.[0]?.delta;
  if (!delta) return;
  if (typeof delta.reasoning === "string" && delta.reasoning) emit("reasoning", { text: delta.reasoning });
  if (typeof delta.content === "string" && delta.content) emit("token", { text: delta.content });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return emit("log", { text: `bad input: ${line.slice(0, 80)}` });
  }
  if (msg.type === "completion") {
    streamCompletion(msg.messages ?? [], msg.model ?? "").catch((e) => emit("error", { text: String(e) }));
  } else if (msg.type === "user_message") {
    // G3-compat echo.
    const reply = `echo: ${msg.text ?? ""}`;
    let i = 0;
    const t = setInterval(() => {
      const chunk = reply.slice(i, i + 6);
      i += 6;
      if (i > reply.length) {
        clearInterval(t);
        emit("done", {});
        return;
      }
      emit("token", { text: chunk });
    }, 40);
  } else {
    emit("log", { text: `ignored type: ${msg.type}` });
  }
});

process.on("SIGTERM", () => process.exit(0));
