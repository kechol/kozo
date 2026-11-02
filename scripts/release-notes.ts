import { parseArgs } from "node:util";

// Usage: bun run scripts/release-notes.ts --version 1.2.3 packages/*/CHANGELOG.md > NOTES.md

const kinds = ["Major Changes", "Minor Changes", "Patch Changes"] as const;

interface Entry {
  text: string;
  packages: string[];
}

/** The entries of one version's section of a changesets changelog, by kind. */
function sectionOf(changelog: string, version: string): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  const start = changelog.indexOf(`\n## ${version}\n`);
  if (start < 0) return entries;
  const end = changelog.indexOf("\n## ", start + 1);
  let kind = "";
  for (const block of changelog.slice(start, end < 0 ? undefined : end).split(/\n(?=- |### )/)) {
    if (block.startsWith("### ")) kind = block.slice(4).split("\n")[0] ?? "";
    // The fixed group bumps every package together, which changesets lists as dependency updates.
    else if (block.startsWith("- ") && !block.startsWith("- Updated dependencies")) {
      entries.set(kind, [...(entries.get(kind) ?? []), block.trim()]);
    }
  }
  return entries;
}

/**
 * The GitHub Release notes of `version`: every entry of that version in the changelogs, once,
 * with the packages whose changelogs list it, under the largest kind any of them gives it.
 */
export function releaseNotes(
  version: string,
  changelogs: readonly { name: string; text: string }[],
): string {
  const entries = new Map<string, Entry & { kind: string }>();
  const rank = (kind: string) => {
    const index = kinds.indexOf(kind as (typeof kinds)[number]);
    return index < 0 ? kinds.length : index;
  };
  for (const { name, text } of changelogs) {
    for (const [kind, blocks] of sectionOf(text, version)) {
      for (const block of blocks) {
        const key = block.replace(/ Thanks \[@[^\]]+\]\([^)]*\)! - /, " ");
        const entry = entries.get(key) ?? { text: key, packages: [], kind };
        entry.packages.push(name);
        if (rank(kind) < rank(entry.kind)) entry.kind = kind;
        entries.set(key, entry);
      }
    }
  }
  if (entries.size === 0) throw new Error(`no changelog has a section for ${version}`);
  const order = [...new Set([...entries.values()].map((entry) => entry.kind))].sort(
    (a, b) => rank(a) - rank(b),
  );
  return [
    ...order.flatMap((kind) => [
      `## ${kind}`,
      "",
      ...[...entries.values()]
        .filter((entry) => entry.kind === kind)
        .map(
          ({ text, packages }) =>
            `${text} (${packages.map((name) => `\`${name.replace("@kozo/", "")}\``).join(", ")})`,
        ),
      "",
    ]),
    "Each package's `CHANGELOG.md` has its own entries.",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { version: { type: "string" } },
    allowPositionals: true,
  });
  if (!values.version || positionals.length === 0)
    throw new Error("release-notes needs --version and the changelogs");
  const changelogs = await Promise.all(
    positionals.map(async (path) => {
      const text = await Bun.file(path).text();
      return { name: text.split("\n")[0]?.replace(/^# /, "") ?? path, text };
    }),
  );
  process.stdout.write(releaseNotes(values.version, changelogs));
}
