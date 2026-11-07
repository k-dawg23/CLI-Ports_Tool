import assert from "node:assert/strict";
import { test } from "node:test";
import { captureCli } from "./helpers/cli-capture.js";

test("piped test capture uses the exact child environment without restoring parent color flags", async () => {
  const keys = ["FORCE_COLOR", "PORTS_CAPTURE_PARENT_ONLY", "PORTS_TEST_CAPTURE"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.FORCE_COLOR = "1";
    process.env.PORTS_CAPTURE_PARENT_ONLY = "parent";
    process.env.PORTS_TEST_CAPTURE = "pipe";
    // Synchronous fixture output isolates environment forwarding from the
    // separately verified asynchronous Node stream capability.
    const result = await captureCli(process.execPath, ["-e", "require('node:fs').writeSync(1, JSON.stringify({force:process.env.FORCE_COLOR??null,parent:process.env.PORTS_CAPTURE_PARENT_ONLY??null,child:process.env.PORTS_CAPTURE_CHILD_ONLY}));"], {
      env: { NO_COLOR: "1", PORTS_CAPTURE_CHILD_ONLY: "child" }, reject: false
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { force: null, parent: null, child: "child" });
    assert.equal(process.env.FORCE_COLOR, "1");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});
