import test from "node:test";
import assert from "node:assert/strict";
import { encodeWav, insertTranscript, multipartBody, transcriptionEndpoint, transcriptText } from "./stt.ts";

test("endpoint: base URL gets the /v1/audio/transcriptions path; explicit endpoints are kept", () => {
  assert.equal(transcriptionEndpoint("https://stt.example"), "https://stt.example/v1/audio/transcriptions");
  assert.equal(transcriptionEndpoint("https://w.example/stt/"), "https://w.example/stt/v1/audio/transcriptions");
  assert.equal(transcriptionEndpoint("http://h:8080/inference"), "http://h:8080/inference");
  assert.equal(transcriptionEndpoint(""), null);
  assert.equal(transcriptionEndpoint("ftp://x"), null);
  assert.equal(transcriptionEndpoint("not a url"), null);
});

test("WAV encoding writes a 16-bit mono PCM header and clamps samples", () => {
  const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), 16000));
  const tag = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(o + i)));
  assert.equal(tag(0), "RIFF");
  assert.equal(tag(8), "WAVE");
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(wav.getUint32(40, true), 8);
  assert.equal(wav.getInt16(46, true), 0x7fff);
  assert.equal(wav.getInt16(48, true), -0x8000);
  assert.equal(wav.getInt16(50, true), 0x7fff, "out-of-range samples are clamped");
});

test("multipart body carries fields and the file between boundaries", () => {
  const { body, contentType } = multipartBody({ name: "a.wav", type: "audio/wav", data: new Uint8Array([1, 2, 3]).buffer }, { response_format: "json" }, "B");
  assert.equal(contentType, "multipart/form-data; boundary=B");
  const text = new TextDecoder().decode(body);
  assert.match(text, /--B\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n/);
  assert.match(text, /name="file"; filename="a.wav"\r\nContent-Type: audio\/wav\r\n\r\n\u0001\u0002\u0003\r\n--B--\r\n$/);
});

test("transcript text is trimmed and inserted at the caret with spacing", () => {
  assert.equal(transcriptText({ text: " Summarize my week.\n" }), "Summarize my week.");
  assert.equal(transcriptText(null), "");
  assert.deepEqual(insertTranscript("", 0, "hi"), { value: "hi", caret: 2 });
  assert.deepEqual(insertTranscript("ask:", 4, "hi"), { value: "ask: hi", caret: 7 });
  assert.deepEqual(insertTranscript("a b", 1, "x"), { value: "a x b", caret: 3 });
});

test("voice provider: automatic prefers the system recognizer, then whisper; explicit choices are honoured", async () => {
  const { parseVoiceProvider, resolveVoiceProvider } = await import("./stt.ts");
  const both = { systemAvailable: true, whisperUrl: "https://w" };
  const desktop = { systemAvailable: false, whisperUrl: "https://w" };
  const none = { systemAvailable: false, whisperUrl: "" };
  assert.equal(resolveVoiceProvider("auto", both), "system");
  assert.equal(resolveVoiceProvider("auto", desktop), "whisper");
  assert.equal(resolveVoiceProvider("auto", none), null);
  assert.equal(resolveVoiceProvider("whisper", both), "whisper");
  assert.equal(resolveVoiceProvider("system", desktop), null);
  assert.equal(resolveVoiceProvider("off", both), null);
  assert.equal(parseVoiceProvider("bogus"), "auto");
  assert.equal(parseVoiceProvider("system"), "system");
});
