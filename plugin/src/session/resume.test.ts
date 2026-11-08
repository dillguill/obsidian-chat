/** T088/T096: continuity ladder, identity refusal, and the persisted registry. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SessionStore } from "./store.ts";
import { MemoryAdapter } from "./test-adapter.ts";
import {
  decideContinuity,
  ResumeRegistry,
  type CurrentHarness,
  type RecordContinuity,
  type StoredContinuity,
} from "./resume.ts";
import { fingerprint } from "../shell/identity.ts";

const stored: StoredContinuity = {
  harnessSessionId: "h_1",
  cwd: "/vault",
  commandFingerprint: fingerprint("harness acp", "/vault"),
  protocolVersion: 1,
  agentName: "harness",
  agentVersion: "1.0.0",
};
const current: CurrentHarness = {
  command: "harness acp",
  cwd: "/vault",
  protocolVersion: 1,
  agentName: "harness",
  agentVersion: "1.0.0",
  resume: true,
  loadSession: true,
};
const record: RecordContinuity = { readable: true, hasContent: true, imported: false };

test("resume is used when the harness advertises it and identity matches", () => {
  const decision = decideContinuity(stored, current, record);
  assert.equal(decision.state, "resume-capable");
  assert.equal(decision.action, "resume");
});

test("load is used when only loadSession is advertised", () => {
  const decision = decideContinuity(stored, { ...current, resume: false }, record);
  assert.equal(decision.state, "load-only");
  assert.equal(decision.action, "load");
});

test("neither capability offers an explicit digest", () => {
  const decision = decideContinuity(stored, { ...current, resume: false, loadSession: false }, record);
  assert.equal(decision.state, "digest-only");
  assert.equal(decision.action, "digest");
  assert.equal(decision.reason, "no_capability");
  assert.equal(decision.digestAvailable, true);
});

test("a changed command refuses resume and names the mismatch", () => {
  const decision = decideContinuity(stored, { ...current, command: "other-harness acp" }, record);
  assert.equal(decision.state, "digest-only");
  assert.equal(decision.reason, "fingerprint_mismatch");
});

test("a changed working directory refuses resume", () => {
  const decision = decideContinuity(stored, { ...current, cwd: "/other-vault" }, record);
  assert.equal(decision.reason, "cwd_mismatch");
  assert.equal(decision.state, "digest-only");
});

test("a changed protocol version refuses resume", () => {
  const decision = decideContinuity(stored, { ...current, protocolVersion: 2 }, record);
  assert.equal(decision.reason, "protocol_mismatch");
});

test("whitespace-only command differences do not refuse resume", () => {
  const decision = decideContinuity({ ...stored, commandFingerprint: fingerprint("harness   acp", "/vault") }, current, record);
  assert.equal(decision.state, "resume-capable");
});

test("an agent version change is a warning, not a refusal", () => {
  const decision = decideContinuity(stored, { ...current, agentVersion: "1.1.0" }, record);
  assert.equal(decision.state, "resume-capable");
  assert.equal(decision.warning, "harness_updated");
});

test("an imported record has no harness identity and is digest-only", () => {
  const decision = decideContinuity(stored, current, { ...record, imported: true });
  assert.equal(decision.state, "digest-only");
  assert.equal(decision.reason, "no_harness_session");
});

test("an unreachable harness degrades to digest, never a silent new session", () => {
  const decision = decideContinuity(stored, null, record);
  assert.equal(decision.state, "digest-only");
  assert.equal(decision.reason, "harness_unreachable");
});

test("no usable record material is fresh-only", () => {
  assert.equal(decideContinuity(stored, current, { ...record, hasContent: false }).state, "fresh-only");
  assert.equal(decideContinuity(stored, current, { ...record, readable: false }).state, "fresh-only");
});

test("registry saves, reconciles (drop/adopt), and flushes deterministically", async () => {
  const adapter = new MemoryAdapter();
  const store = new SessionStore(adapter, ".chat/sessions");
  const keep = await store.createSession({
    sessionId: "s_keep",
    deviceId: "phone",
    commandLabel: "harness",
    commandFingerprint: "fp",
    cwd: "/vault",
    protocolVersion: 1,
    capabilities: { loadSession: true, resume: true, mcpHttp: false },
    harnessSessionId: "h_keep",
    now: 10,
  });
  const registry = new ResumeRegistry(adapter, ".chat/sessions", () => 100);
  await registry.load();
  registry.upsert({
    sessionId: keep,
    harnessSessionId: "h_keep",
    deviceId: "phone",
    cwd: "/vault",
    commandFingerprint: "fp",
    protocolVersion: 1,
    lastSeq: 3,
    state: "live",
    lastSeen: 100,
  });
  registry.upsert({
    sessionId: "s_gone",
    harnessSessionId: "h_gone",
    deviceId: "phone",
    cwd: "/vault",
    commandFingerprint: "fp",
    protocolVersion: 1,
    lastSeq: 0,
    state: "dead",
    lastSeen: 1,
  });
  await registry.flush();
  const raw = JSON.parse(adapter.files.get(".chat/sessions/registry.json")!) as { sessions: Record<string, unknown> };
  assert.deepEqual(Object.keys(raw.sessions).sort(), [keep, "s_gone"].sort());

  const adopted = await store.createSession({
    sessionId: "s_adopt",
    deviceId: "phone",
    commandLabel: "harness",
    commandFingerprint: "fp",
    cwd: "/vault",
    protocolVersion: 1,
    capabilities: { loadSession: false, resume: false, mcpHttp: false },
    harnessSessionId: null,
    now: 20,
  });
  const reconciled = registry.reconcile(await store.list());
  assert.deepEqual(reconciled.dropped, ["s_gone"]);
  assert.deepEqual(reconciled.adopted, [adopted]);
  assert.equal(registry.get(adopted)?.state, "dead");
  registry.mark(keep, "detached");
  await registry.flush();
  const reloaded = new ResumeRegistry(adapter, ".chat/sessions");
  await reloaded.load();
  assert.equal(reloaded.get(keep)?.state, "detached");
});
