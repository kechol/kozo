import { describe, expect, test } from "bun:test";
import { formula } from "./formula.ts";

const sum = (n: number) => String(n).repeat(64).slice(0, 64);
const sums = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
  .map((target, index) => `${sum(index + 1)}  kozo-1.2.3-${target}.tar.gz`)
  .join("\n");

describe("formula", () => {
  test("names each platform's archive of the release with its checksum", () => {
    const text = formula("1.2.3", `${sums}\n`);
    expect(text).toContain('  version "1.2.3"');
    expect(text).toContain(
      [
        "  on_macos do",
        "    on_arm do",
        '      url "https://github.com/kechol/kozo/releases/download/v1.2.3/kozo-1.2.3-darwin-arm64.tar.gz"',
        `      sha256 "${sum(1)}"`,
        "    end",
        "    on_intel do",
      ].join("\n"),
    );
    expect(text).toContain(`kozo-1.2.3-linux-x64.tar.gz"\n      sha256 "${sum(4)}"`);
    expect(text).toContain('bin.install "kozo", "kozod"');
  });

  test("refuses a prerelease and a release missing a platform's checksum", () => {
    expect(() => formula("1.2.3-rc.1", sums)).toThrow("not a stable version");
    expect(() => formula("1.2.3", sums.split("\n").slice(1).join("\n"))).toThrow(
      "no checksum of kozo-1.2.3-darwin-arm64.tar.gz",
    );
  });
});
