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

/**
 * The level the implement agent runs in its sandbox: deep gates such as end-to-end tests serve
 * the app through more than the sandbox allows, so the agent stops at full and kozod's own gates
 * after the session run the deep ones.
 */
export function agentLevel(level: GateLevel): GateLevel {
  return level === "deep" ? "full" : level;
}

// `.txt` and `.mdx` are left out: requirements.txt pins dependencies, and MDX runs components.
const documentation = /\.(md|markdown|rst|adoc)$/i;

// The manifests and lockfiles of the common package managers, all a dependency update changes.
const dependencyFiles =
  /(^|\/)(package\.json|bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile|Pipfile\.lock|Gemfile|Gemfile\.lock|composer\.json|composer\.lock)$/;

/** Every path the diff from `base` to HEAD adds, changes or removes. */
async function changedPaths(cwd: string, base: string): Promise<string[]> {
  // A rename lists only its new path, which would hide code moved into a .md file.
  const changed = await git(cwd, ["diff", "--no-renames", "--name-only", "-z", `${base}...HEAD`]);
  return changed.split("\0").filter(Boolean);
}

/**
 * The first file that the diff from `base` to HEAD adds, changes or removes and that is not
 * documentation, or null when the diff is documentation only.
 */
export async function firstCodeChange(cwd: string, base: string): Promise<string | null> {
  return (await changedPaths(cwd, base)).find((path) => !documentation.test(path)) ?? null;
}

/** Whether the diff from `base` to HEAD changes dependency manifests and lockfiles and nothing else. */
export async function onlyDependencyFiles(cwd: string, base: string): Promise<boolean> {
  const changed = await changedPaths(cwd, base);
  return changed.length > 0 && changed.every((path) => dependencyFiles.test(path));
}
