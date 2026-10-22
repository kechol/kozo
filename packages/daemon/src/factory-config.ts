import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type Factory, factorySchema, issueText } from "@kozo/core";

/** The factory settings kozod runs without a `factory.yml`: local mode and no repositories yet. */
export const builtInFactory: Factory = {
  version: 1,
  mode: "local",
  runtime: "sdk",
  repositories: [],
  agent_defaults: { model: "claude-sonnet-5-5" },
  concurrency: 1,
  budget: { daily_usd: 15 },
};

function expandHome(path: string): string {
  return resolve(
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path,
  );
}

/**
 * The text of a `factory.yml` merged over the built-in settings key by key and checked, with `~`
 * expanded in repository paths, or null with the problems added to `issues`.
 */
export function parseFactoryConfig(text: string, issues: string[]): Factory | null {
  let overrides: unknown;
  try {
    overrides = Bun.YAML.parse(text) ?? {};
  } catch (error) {
    issues.push(`factory.yml: ${(error as Error).message}`);
    return null;
  }
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    issues.push("factory.yml: expected a mapping");
    return null;
  }
  const result = factorySchema.safeParse({ ...builtInFactory, ...overrides });
  if (!result.success) {
    issues.push(...result.error.issues.map((issue) => `factory.yml: ${issueText(issue)}`));
    return null;
  }
  const factory = result.data;
  if (factory.mode !== "local") issues.push("factory.yml: only mode: local runs in this version");
  if (factory.runtime !== "sdk") issues.push("factory.yml: only runtime: sdk runs in this version");
  return {
    ...factory,
    repositories: factory.repositories.map((repository) => ({
      ...repository,
      path: expandHome(repository.path),
    })),
  };
}
