/** T066: the permission card is exactly the harness's offer — one action per
 *  offered option, verbatim title/content/locations, no invented choice. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { PendingPermission } from "../acp/types.ts";
import { permissionCardModel } from "./approval.ts";

function permission(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    requestId: "perm_1",
    sessionId: "session_1",
    toolCall: {
      toolCallId: "tc_1",
      title: "Write note",
      name: "write_note",
      kind: "edit",
      status: "pending",
      content: [
        { type: "text", text: "Create Inbox/new.md" },
        { type: "diff", path: "Inbox/new.md", newText: "+hello\n" },
        {
          type: "resource_link",
          uri: "file:///vault/Inbox/new.md",
          name: "Inbox/new.md",
          mimeType: "text/markdown",
        },
      ],
      locations: [{ path: "/vault/Inbox/new.md", line: 3 }],
      rawInput: { path: "Inbox/new.md", content: "hello" },
    },
    options: [
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
      { optionId: "reject_once", name: "Reject", kind: "reject_once" },
    ],
    ...overrides,
  };
}

test("the card model uses the harness's title verbatim and keeps every variant", () => {
  const model = permissionCardModel(permission());
  assert.equal(model.title, "Write note");
  assert.equal(model.meta, "edit · pending");
  assert.deepEqual(model.locations, [{ path: "/vault/Inbox/new.md", line: 3 }]);
  assert.equal(model.content.length, 3);
  assert.deepEqual(
    model.content.map((content) => content.type),
    ["text", "diff", "resource_link"],
  );
  assert.deepEqual(model.rawInput, { path: "Inbox/new.md", content: "hello" });
});

test("one action per offered option, in the harness's order, ids unchanged", () => {
  const offered = permission();
  const model = permissionCardModel(offered);
  assert.equal(model.options.length, offered.options.length, "exactly one action per offered option");
  assert.deepEqual(
    model.options.map((option) => option.optionId),
    ["allow_once", "allow_always", "reject_once"],
    "no invented, filtered, or reordered options",
  );
  assert.deepEqual(
    model.options.map((option) => option.name),
    ["Allow once", "Always allow", "Reject"],
  );
});

test("an empty option list produces no actions instead of a fake Approve/Reject", () => {
  const model = permissionCardModel(permission({ options: [] }));
  assert.deepEqual(model.options, []);
});

test("a missing title falls back to the programmatic name, then a neutral label", () => {
  const withoutTitle = permission();
  delete withoutTitle.toolCall.title;
  assert.equal(permissionCardModel(withoutTitle).title, "write_note");
  const bare = permission();
  delete bare.toolCall.title;
  delete bare.toolCall.name;
  assert.equal(permissionCardModel(bare).title, "Permission requested");
});
