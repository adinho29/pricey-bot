import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Contracts between files that no unit can see on its own.
describe("project contracts", () => {
  it("the notify workflow is dispatch-only: no schedule trigger, so an external scheduler cannot be doubled by GitHub's cron", () => {
    const yml = readFileSync(".github/workflows/notify.yml", "utf8");
    expect(yml).toMatch(/^\s*workflow_dispatch:/m);
    expect(yml).not.toMatch(/^\s*schedule:/m);
    expect(yml).not.toMatch(/^\s*- cron:/m);
  });

  it("the Node engine floor covers --env-file-if-exists, which every npm script uses", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { engines: { node: string }; scripts: Record<string, string> };
    expect(Object.values(pkg.scripts).some((s) => s.includes("--env-file-if-exists"))).toBe(true);
    const floor = pkg.engines.node.match(/^>=\s*(\d+)\.(\d+)/);
    expect(floor, 'engines.node must look like ">=22.9"').not.toBeNull();
    const [major, minor] = [Number(floor![1]), Number(floor![2])];
    expect(major > 22 || (major === 22 && minor >= 9)).toBe(true);
  });
});
