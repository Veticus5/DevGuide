import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_KINDS, ALL_KINDS, isAgentKind, newEventId, validateDraft } from "./events.ts";

/** A complete draft for every kind. */
const COMPLETE: Record<string, Record<string, unknown>> = {
  task_started: { description: "fix the export" },
  user_prompt: { text: "yes" },
  session_resumed: { source: "resume" },
  observation: { text: "only the first page is fetched", materials: [{ label: "sample", content: "100 rows" }] },
  hypothesis: { text: "the page parameter is ignored" },
  hypothesis_resolved: { hypothesis_id: "abcd1234", outcome: "rejected", text: "the parameter is passed" },
  proposal: { text: "loop over pages" },
  change_prepared: { text: "add a loop", patch: null },
  file_changed: { path: "src/export.ts", tool: "Edit" },
  command_run: { command: "npm test" },
  tool_failed: { tool: "Bash" },
  decision: { question: "apply?", quote: "yes", reading: "apply the fix" },
  check: { what: "all rows exported", expected: "250", command: "npm test", claimed: "passed" },
  agent_message: { text: "done" },
};

describe("validateDraft", () => {
  it("accepts a complete draft of every kind", () => {
    for (const kind of ALL_KINDS) {
      assert.deepEqual(validateDraft(kind, COMPLETE[kind]!), [], kind);
    }
  });

  it("names the missing field", () => {
    assert.deepEqual(validateDraft("hypothesis", {}), ['missing required field "text"']);
    assert.deepEqual(validateDraft("hypothesis", { text: "   " }), ['missing required field "text"']);
    const problems = validateDraft("decision", { question: "q" });
    assert.ok(problems.includes('missing required field "quote"'));
    assert.ok(problems.includes('missing required field "reading"'));
  });

  it("rejects a claim outside the allowed set", () => {
    const problems = validateDraft("check", { ...COMPLETE["check"], claimed: "ok" });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /"claimed" must be one of passed, failed, inconclusive/);
  });

  it("rejects an outcome outside the allowed set", () => {
    const problems = validateDraft("hypothesis_resolved", { ...COMPLETE["hypothesis_resolved"], outcome: "maybe" });
    assert.match(problems[0]!, /"outcome" must be one of confirmed, rejected/);
  });

  it("rejects an unknown kind", () => {
    assert.deepEqual(validateDraft("guess", {}), ['unknown event kind "guess"']);
  });

  it("rejects malformed files and materials", () => {
    assert.match(validateDraft("observation", { text: "x", files: "a.ts" })[0]!, /"files"/);
    assert.match(validateDraft("observation", { text: "x", materials: ["nope"] })[0]!, /"materials"/);
  });
});

describe("event helpers", () => {
  it("newEventId returns eight hex characters, different each time", () => {
    const a = newEventId();
    const b = newEventId();
    assert.match(a, /^[0-9a-f]{8}$/);
    assert.notEqual(a, b);
  });

  it("isAgentKind covers exactly the kinds the CLI records", () => {
    for (const kind of AGENT_KINDS) assert.equal(isAgentKind(kind), true);
    assert.equal(isAgentKind("file_changed"), false);
    assert.equal(isAgentKind("task_started"), false);
  });
});
