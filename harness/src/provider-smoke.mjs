#!/usr/bin/env node
// G7 spike: prove streaming chat-completions work from the harness machine
// through each provider we care about. Usage:
//   node provider-smoke.mjs               # test all configured providers
//   node provider-smoke.mjs openrouter    # test one
// Keys are read at runtime from local stores / env — never hardcoded here.
import { readFileSync } from "node:fs";
import os from "node:os";

function openrouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const a = JSON.parse(readFileSync(os.homedir() + "/.local/share/opencode/account.json", "utf8"));
  const id = a.active && a.active.openrouter;
  return id && a.accounts[id] && a.accounts[id].credential.key;
}
function ollamaKey() {
  return process.env.OLLAMA_API_KEY || "ollama"; // local ollama accepts any/none
}

const PROVIDERS = {
  openrouter: {
    label: "OpenRouter (deepseek/deepseek-chat)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: openrouterKey,
    model: "deepseek/deepseek-chat",
  },
  ollama: {
    label: "Ollama local (qwen3.5:4b-mlx)",
    url: "http://127.0.0.1:11434/v1/chat/completions",
    key: ollamaKey,
    model: "qwen3.5:4b-mlx",
  },
};

async function smoke(name) {
  const p = PROVIDERS[name];
  if (!p) { console.error("unknown provider:", name); process.exit(1); }
  const key = p.key();
  if (!key) { console.log(`${name}: NO KEY AVAILABLE — skip`); return false; }
  const t0 = Date.now();
  let firstTokenMs = null, tokens = 0, text = "", reason = 0, finish = null;
  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: "user", content: "Reply with exactly: G7 OK" }],
        stream: true,
        max_tokens: 20,
      }),
    });
    if (!res.ok) {
      console.log(`${name} [${p.label}]: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) > -1) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const d = j.choices?.[0]?.delta || {};
          const dt = d.content ?? j.content ?? "";
          if (d.reasoning) { if (firstTokenMs === null) firstTokenMs = Date.now() - t0; reason++; }
          if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
          if (dt) { if (firstTokenMs === null) firstTokenMs = Date.now() - t0; tokens++; text += dt; }
        } catch {}
      }
    }
    const streamed = tokens + reason > 0;
    console.log(`${name} [${p.label}]: ${streamed ? "OK" : "EMPTY"} — ttft=${firstTokenMs}ms content=${tokens} reasoning=${reason} finish=${finish} text="${text.trim()}" total=${Date.now() - t0}ms`);
    return streamed;
  } catch (e) {
    console.log(`${name}: ERROR ${e.message}`);
    return false;
  }
}

const which = process.argv.slice(2);
const targets = which.length ? which : Object.keys(PROVIDERS);
let pass = 0;
for (const t of targets) if (await smoke(t)) pass++;
console.log(`\n${pass}/${targets.length} providers streamed OK`);
process.exit(pass === targets.length ? 0 : 2);
