import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { currentTaskFile, rawLogFile, resolveDataDir, taskEventsFile, taskFile } from "./paths.ts";

describe("paths", () => {
  it("resolveDataDir prefers DEVGUIDE_DIR", () => {
    assert.equal(resolveDataDir({ DEVGUIDE_DIR: "/tmp/dg" }, "/repo"), "/tmp/dg");
  });

  it("resolveDataDir defaults to .devguide under the working directory", () => {
    assert.equal(resolveDataDir({}, "/repo"), join("/repo", ".devguide"));
    assert.equal(resolveDataDir({ DEVGUIDE_DIR: "" }, "/repo"), join("/repo", ".devguide"));
  });

  it("derives the raw log and task files from the data directory", () => {
    assert.equal(rawLogFile("/d"), join("/d", "events.jsonl"));
    assert.equal(currentTaskFile("/d"), join("/d", "current-task"));
    assert.equal(taskFile("/d", "t1"), join("/d", "tasks", "t1", "task.json"));
    assert.equal(taskEventsFile("/d", "t1"), join("/d", "tasks", "t1", "events.jsonl"));
  });
});
