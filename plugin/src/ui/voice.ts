/** Voice input: record from the microphone, convert to 16 kHz mono WAV, and
 *  transcribe on the user's own speech-to-text server. Audio is held in
 *  memory only and sent to that server alone; nothing is stored. */
import { requestUrl } from "obsidian";
import { encodeWav, multipartBody, STT_SAMPLE_RATE, transcriptionEndpoint, transcriptText } from "../voice/stt.ts";

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopped: Promise<Blob> | null = null;

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("this device does not allow microphone access here");
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    const recorder = new MediaRecorder(this.stream);
    this.recorder = recorder;
    this.stopped = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) this.chunks.push(event.data);
      };
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
      recorder.onerror = () => reject(new Error("recording failed"));
    });
    recorder.start();
  }

  /** Stops and returns the recording as 16 kHz mono WAV. */
  async stop(): Promise<ArrayBuffer> {
    if (!this.recorder || !this.stopped) throw new Error("not recording");
    this.recorder.stop();
    const blob = await this.stopped;
    this.release();
    return toWav(await blob.arrayBuffer());
  }

  cancel(): void {
    try {
      if (this.recorder?.state === "recording") this.recorder.stop();
    } catch {
      // already stopped
    }
    this.release();
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;
    this.stopped = null;
  }
}

/** Decodes any recorder format the platform produced and resamples it. */
async function toWav(encoded: ArrayBuffer): Promise<ArrayBuffer> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Ctx();
  try {
    const decoded = await context.decodeAudioData(encoded.slice(0));
    const frames = Math.max(1, Math.ceil(decoded.duration * STT_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, STT_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0), STT_SAMPLE_RATE);
  } finally {
    void context.close();
  }
}

/** Sends WAV audio to the configured server and returns the transcript. */
export async function transcribe(serverUrl: string, wav: ArrayBuffer): Promise<string> {
  const endpoint = transcriptionEndpoint(serverUrl);
  if (!endpoint) throw new Error("set a valid speech-to-text server URL in settings");
  const { body, contentType } = multipartBody({ name: "speech.wav", type: "audio/wav", data: wav }, { response_format: "json", temperature: "0" });
  const response = await requestUrl({ url: endpoint, method: "POST", body, contentType, throw: false });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`speech-to-text server answered ${response.status}`);
  }
  let json: unknown;
  try {
    json = response.json;
  } catch {
    json = { text: response.text };
  }
  return transcriptText(json);
}

/** A short silent clip for the settings connection test. */
export function silentWav(seconds = 0.5): ArrayBuffer {
  return encodeWav(new Float32Array(Math.round(STT_SAMPLE_RATE * seconds)), STT_SAMPLE_RATE);
}

type RecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The platform's own speech recognizer (live, on-device or system service).
 *  Desktop Electron exposes the API without a working service, so it only
 *  counts as available on mobile. */
export function systemDictationAvailable(isDesktopApp: boolean): boolean {
  return !isDesktopApp && recognitionCtor() !== null;
}

export class SystemDictation {
  private recognition: InstanceType<RecognitionCtor> | null = null;

  /** Streams the running transcript to `onText` until stopped. */
  start(onText: (text: string) => void, onEnd: (error?: string) => void): void {
    const Ctor = recognitionCtor();
    if (!Ctor) throw new Error("speech recognition is not available on this device");
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    let failure: string | undefined;
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0]?.transcript ?? "";
      onText(text.replace(/\s+/g, " ").trim());
    };
    recognition.onerror = (event) => {
      if (event.error && event.error !== "no-speech" && event.error !== "aborted") failure = event.error;
    };
    recognition.onend = () => {
      this.recognition = null;
      onEnd(failure);
    };
    this.recognition = recognition;
    recognition.start();
  }

  stop(): void {
    this.recognition?.stop();
  }

  cancel(): void {
    this.recognition?.abort();
    this.recognition = null;
  }
}
