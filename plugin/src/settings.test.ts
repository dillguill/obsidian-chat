/** T104: settings upgrade fixtures — host user, gateway user, fresh desktop,
 *  fresh mobile — with legacy blocks folded in and then dropped. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings-model.ts";

test("a host-mode user keeps command/port/devices and becomes a local shell", () => {
  const { settings, changed, notes } = migrateSettings(
    {
      host: { enabled: true, command: "my-harness acp", port: 9123, devices: { phone: "tok_phone" } },
      blacklistFolders: ["Private/"],
      injectVaultRules: false,
      chatFolder: "chat/",
    },
    { isMobile: false },
  );
  assert.equal(changed, true);
  assert.equal(settings.shell.mode, "local");
  assert.equal(settings.shell.command, "my-harness acp");
  assert.equal(settings.shell.port, 9123);
  assert.deepEqual(settings.pairedDevices, { phone: "tok_phone" });
  assert.deepEqual(settings.blacklistFolders, ["Private/"]);
  assert.equal(settings.injectVaultRules, false);
  assert.equal(settings.sessionStoreFolder, ".chat/sessions", "no folder setting is ever read");
  assert.ok(!("gateway" in (settings as unknown as Record<string, unknown>)));
  assert.ok(!("host" in (settings as unknown as Record<string, unknown>)));
  assert.ok(notes.length > 0);
});

test("a gateway user becomes a remote shell with the same address and code", () => {
  const { settings, changed } = migrateSettings(
    { gateway: { baseUrl: "http://100.64.0.2:8765", token: "device-code" } },
    { isMobile: false },
  );
  assert.equal(changed, true);
  assert.equal(settings.shell.mode, "remote");
  assert.equal(settings.shell.remoteUrl, "http://100.64.0.2:8765");
  assert.equal(settings.shell.remoteToken, "device-code");
  assert.ok(!("gateway" in (settings as unknown as Record<string, unknown>)));
});

test("a fresh desktop install gets the local defaults", () => {
  const { settings } = migrateSettings({}, { isMobile: false });
  assert.equal(settings.shell.mode, "local");
  assert.equal(settings.shell.command, DEFAULT_SETTINGS.shell.command);
  assert.equal(settings.shell.port, 8765);
});

test("a fresh mobile install defaults to remote (mobile never hosts)", () => {
  const { settings } = migrateSettings({}, { isMobile: true });
  assert.equal(settings.shell.mode, "remote");
});

test("an explicit shell configuration wins over legacy blocks", () => {
  const explicit = {
    shell: { mode: "remote", remoteUrl: "wss://host/acp", remoteToken: "tok", command: "other acp" },
    host: { enabled: true, command: "legacy acp", port: 9000, devices: {} },
    gateway: { baseUrl: "http://old", token: "old" },
  };
  const { settings } = migrateSettings(explicit, { isMobile: false });
  assert.equal(settings.shell.mode, "remote");
  assert.equal(settings.shell.remoteUrl, "wss://host/acp");
  assert.equal(settings.shell.remoteToken, "tok");
  assert.equal(settings.shell.command, "other acp");
});

test("migration is idempotent and drops removed keys", () => {
  const first = migrateSettings({ host: { enabled: true, devices: { a: "b" } } }, { isMobile: false });
  const second = migrateSettings(first.settings, { isMobile: false });
  assert.equal(second.changed, false);
  assert.deepEqual(second.settings, first.settings);
});
