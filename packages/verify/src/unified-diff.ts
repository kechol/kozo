export interface ChangedLines {
  /** Added lines with their line numbers in the new file. */
  added: { line: number; text: string }[];
  removed: string[];
}

/** Collects the added and removed lines of a one-file `git diff -U0`. */
export function parseChangedLines(diff: string): ChangedLines {
  const changed: ChangedLines = { added: [], removed: [] };
  let inHunk = false;
  let nextLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@ ")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      nextLine = Number(match?.[1] ?? 0);
      inHunk = true;
    } else if (!inHunk) {
      // The file header, whose "--- a/" and "+++ b/" lines are not content.
    } else if (line.startsWith("+")) {
      changed.added.push({ line: nextLine, text: line.slice(1) });
      nextLine += 1;
    } else if (line.startsWith("-")) {
      changed.removed.push(line.slice(1));
    }
  }
  return changed;
}
