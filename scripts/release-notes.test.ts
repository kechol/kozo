import { describe, expect, test } from "bun:test";
import { releaseNotes } from "./release-notes.ts";

const thanks = "Thanks [@someone](https://github.com/someone)! - ";
const link = (hash: string) => `[\`${hash}\`](https://github.com/example/kozo/commit/${hash})`;

const cli = `# @kozo/cli

## 1.2.0

### Minor Changes

- ${link("aaaaaaa")} ${thanks}Add \`kozo thing\`.

### Patch Changes

- ${link("bbbbbbb")} ${thanks}Fix both.
  It spans two lines.
- Updated dependencies [${link("aaaaaaa")}]
  - @kozo/core@1.2.0

## 1.1.0

### Minor Changes

- ${link("ccccccc")} ${thanks}An older change.
`;

const core = `# @kozo/core

## 1.2.0

### Patch Changes

- ${link("aaaaaaa")} ${thanks}Add \`kozo thing\`.
- ${link("bbbbbbb")} ${thanks}Fix both.
  It spans two lines.
`;

describe("releaseNotes", () => {
  const notes = releaseNotes("1.2.0", [
    { name: "@kozo/cli", text: cli },
    { name: "@kozo/core", text: core },
  ]);

  test("lists each entry of the version once, with every package that lists it", () => {
    expect(notes).toContain(`- ${link("aaaaaaa")} Add \`kozo thing\`. (\`cli\`, \`core\`)`);
    expect(notes).toContain(
      `- ${link("bbbbbbb")} Fix both.\n  It spans two lines. (\`cli\`, \`core\`)`,
    );
    expect(notes.split("aaaaaaa")).toHaveLength(3);
    expect(notes).not.toContain("Thanks");
  });

  test("puts an entry under the largest kind a package gives it, and leaves out the rest", () => {
    expect(notes.indexOf("## Minor Changes")).toBeLessThan(notes.indexOf("Add `kozo thing`"));
    expect(notes.indexOf("## Patch Changes")).toBeLessThan(notes.indexOf("Fix both"));
    expect(notes).not.toContain("Updated dependencies");
    expect(notes).not.toContain("An older change");
  });

  test("refuses a version no changelog has", () => {
    expect(() => releaseNotes("9.9.9", [{ name: "@kozo/cli", text: cli }])).toThrow(
      "no changelog has a section for 9.9.9",
    );
  });
});
