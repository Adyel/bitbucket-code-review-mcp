/**
 * Unit tests for the comment location routing helper.
 */

import { describe, it, expect } from "vitest";
import { buildInlinePosition } from "../src/tools/comments.js";

describe("buildInlinePosition", () => {
  it("returns undefined for a general comment (no file_path)", () => {
    expect(buildInlinePosition(undefined, 10)).toBeUndefined();
  });

  it("returns a file-level position when only file_path is given", () => {
    expect(buildInlinePosition("src/a.ts")).toEqual({ path: "src/a.ts" });
  });

  it("returns a single-line inline position", () => {
    expect(buildInlinePosition("src/a.ts", 12)).toEqual({
      path: "src/a.ts",
      to: 12,
    });
  });

  it("returns a multi-line inline position (from..to)", () => {
    expect(buildInlinePosition("src/a.ts", 12, 15)).toEqual({
      path: "src/a.ts",
      from: 12,
      to: 15,
    });
  });
});
