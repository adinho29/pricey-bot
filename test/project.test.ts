import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Contracts between files that no unit can see on its own.
describe("project contracts", () => {
  it("the notify cron runs every day so that config.json weekdaysOnly is the only weekend switch", () => {
    const yml = readFileSync(".github/workflows/notify.yml", "utf8");
    const match = yml.match(/cron:\s*"([^"]+)"/);
    expect(match, "notify.yml must declare a quoted cron expression").not.toBeNull();
    const fields = match![1].trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    expect(fields[4], "day-of-week field must be * (the script skips weekends itself)").toBe("*");
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
