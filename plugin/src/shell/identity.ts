/** Non-secret attach identity: a redacted command label and a deterministic
 *  harness fingerprint (command + cwd). Never contains credentials. */

/** Avoid storing a secret a user may have embedded in the command line. */
export function redactLabel(command: string): string {
  return command.replace(/((?:token|key|secret|password|api[_-]?key)\s*[=:]\s*)\S+/gi, "$1***");
}

/** Quote-aware command split: no shell interpolation in the argv path. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const ch of command.trim()) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Lexical cwd normalization for identity comparisons (not the path policy). */
export function normalizeCwd(cwd: string): string {
  const slashed = cwd.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (slashed === "/") return "/";
  return slashed.replace(/\/+$/, "");
}

/** FNV-1a 64-bit (as two 32-bit halves) over normalized argv + cwd —
 *  deterministic and stable across extra whitespace. */
export function fingerprint(command: string, cwd: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  const input = `${splitCommand(command).join(" ")}\0${normalizeCwd(cwd)}`;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
}
