/** T117: record entries never store secret-bearing binary or auth values. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sanitizeForRecord } from "./record.ts";

test("image/audio bytes are removed but type/name metadata remains", () => {
  const image = sanitizeForRecord({ type: "image", mimeType: "image/jpeg", data: "AAAA", name: "p.jpg" }) as Record<string, unknown>;
  assert.equal(image.data, "");
  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(image.name, "p.jpg");
  const audio = sanitizeForRecord({ type: "audio", mimeType: "audio/wav", data: "BBBB" }) as Record<string, unknown>;
  assert.equal(audio.data, "");
});

test("nested content and authorization headers are sanitized", () => {
  const sanitized = sanitizeForRecord({
    update: {
      content: [{ type: "image", mimeType: "image/png", data: "SECRET" }],
      headers: [{ name: "Authorization", value: "Bearer token" }],
    },
  }) as { update: { content: Array<{ data: string }>; headers: Array<{ value: string }> } };
  assert.equal(sanitized.update.content[0].data, "");
  assert.equal(sanitized.update.headers[0].value, "***");
});
