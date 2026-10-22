import { type GateLevel, gateLevelSchema, type RiskTier } from "@kozo/core";
import { git } from "@kozo/verify";

/** What each risk tier verifies beyond diff-guard and review, which every tier runs. */
export const layersFor: Record<RiskTier, { gates: GateLevel; prove: boolean; verify: boolean }> = {
  low: { gates: "fast", prove: false, verify: false },
  normal: { gates: "full", prove: true, verify: true },
  high: { gates: "deep", prove: true, verify: true },
};

/** The deeper of a tier's gate level and the one a blueprint asks for. */
export function atLeast(level: GateLevel, floor: GateLevel | undefined): GateLevel {
  const order = gateLevelSchema.options;
  return floor && order.indexOf(floor) > order.indexOf(level) ? floor : level;
}

// `.txt` and `.mdx` are left out: requirements.txt pins dependencies, and MDX runs components.
const documentation = /\.(md|markdown|rst|adoc)$/i;

/**
 * The first file that the diff from `base` to HEAD adds, changes or removes and that is not
 * documentation, or null when the diff is documentation only.
 */
export async function firstCodeChange(cwd: string, base: string): Promise<string | null> {
  // A rename lists only its new path, which would hide code moved into a .md file.
  const changed = await git(cwd, ["diff", "--no-renames", "--name-only", "-z", `${base}...HEAD`]);
  return changed.split("\0").find((path) => path && !documentation.test(path)) ?? null;
}
