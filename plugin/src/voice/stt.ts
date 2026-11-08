/** Speech-to-text helpers (pure; no Obsidian import): 16 kHz mono WAV
 *  encoding, the multipart upload body, and endpoint resolution for a
 *  whisper.cpp-style /v1/audio/transcriptions server. */

export const STT_SAMPLE_RATE = 16_000;

/** Base URL → transcription endpoint (/v1/audio/transcriptions). A URL that already names an endpoint
 *  (…/transcriptions or …/inference) is used as-is. */
export function transcriptionEndpoint(base: string): string | null {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (/\/(transcriptions|inference)$/.test(url.pathname)) return url.toString();
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/audio/transcriptions`;
  return url.toString();
}

/** Mono float samples (-1…1) → 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = STT_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** multipart/form-data body with the audio file and plain fields. */
export function multipartBody(
  file: { name: string; type: string; data: ArrayBuffer },
  fields: Record<string, string>,
  boundary = `----oc${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
): { body: ArrayBuffer; contentType: string } {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),
    new Uint8Array(file.data),
    encoder.encode(`\r\n--${boundary}--\r\n`),
  );
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return { body: out.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** `{ text }` (whisper.cpp json) → trimmed transcript. */
export function transcriptText(response: unknown): string {
  const text = (response as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

/** Inserts a transcript at the caret with sensible spacing. */
export function insertTranscript(value: string, caret: number, transcript: string): { value: string; caret: number } {
  const before = value.slice(0, caret);
  const after = value.slice(caret);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const next = `${before}${lead}${transcript}${trail}${after}`;
  return { value: next, caret: before.length + lead.length + transcript.length };
}

/** Per-device voice input choice. */
export type VoiceProvider = "auto" | "system" | "whisper" | "off";

export function parseVoiceProvider(raw: unknown): VoiceProvider {
  return raw === "system" || raw === "whisper" || raw === "off" ? raw : "auto";
}

/** Which engine the mic uses on this device, or null for no mic.
 *  Automatic prefers the system recognizer where it works (mobile), then a
 *  configured whisper server. */
export function resolveVoiceProvider(
  choice: VoiceProvider,
  env: { systemAvailable: boolean; whisperUrl: string },
): "system" | "whisper" | null {
  const whisper = env.whisperUrl.trim() ? "whisper" : null;
  switch (choice) {
    case "off":
      return null;
    case "system":
      return env.systemAvailable ? "system" : null;
    case "whisper":
      return whisper;
    default:
      return env.systemAvailable ? "system" : whisper;
  }
}
