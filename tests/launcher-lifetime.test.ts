import assert from "node:assert/strict";
import { test } from "node:test";
import { UnixPortBackend } from "../src/backends/unix.js";

test("a configured foreground editor stub survives the former 15-second deadline", { timeout: 25_000 }, async () => {
  const previous = process.env.PORTS_EDITOR;
  // This creates only a Node fixture, never a real browser or editor.
  process.env.PORTS_EDITOR = `"${process.execPath}" -e "setTimeout(() => {}, 16_000)"`;
  try {
    const result = await new UnixPortBackend().openInEditor("/a project with spaces");
    assert.equal(result.success, true, result.message);
  } finally {
    if (previous === undefined) delete process.env.PORTS_EDITOR;
    else process.env.PORTS_EDITOR = previous;
  }
});
