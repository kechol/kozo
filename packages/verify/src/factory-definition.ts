import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type Factory, factorySchema, factoryTemplate, issueText } from "@kozo/core";
import {
  type AgentDefinition,
  parseAgentDefinition,
  parseSkill,
  type Skill,
} from "./agent-definition.ts";
import { defaultBranch, GitError, git, showFile } from "./git.ts";

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

export const definedAgents = ["triage", "plan", "implement", "review", "verify"] as const;
export type DefinedAgent = (typeof definedAgents)[number];

/** One version of the factory definition, applied only as a whole. */
export interface Definition {
  /** The commit it was read from, or null when the definition is not a git repository. */
  commit: string | null;
  factory: Factory;
  agents: Record<DefinedAgent, AgentDefinition>;
  verifyApp: Skill;
}

export type DefinitionResult =
  | { ok: true; definition: Definition }
  | { ok: false; commit: string | null; issues: string[] };

/** The model an agent runs on: the factory's setting for it, its definition's, or the default. */
export function modelFor(definition: Definition, agent: DefinedAgent): string {
  return (
    definition.factory.agents?.[agent]?.model ??
    definition.agents[agent].model ??
    definition.factory.agent_defaults.model
  );
}

/**
 * The commit the factory definition in `directory` is read from: the tip of its default branch,
 * or null when `directory` is not a git repository.
 */
export async function definitionTip(directory: string): Promise<string | null> {
  // Bun.file().exists() is false for a directory, which `.git` usually is.
  const repository = await stat(join(directory, ".git")).then(
    () => true,
    () => false,
  );
  if (!repository) return null;
  const branch = await defaultBranch(directory);
  return (await git(directory, ["rev-parse", `refs/heads/${branch}`])).trim();
}

/**
 * Reads and checks the whole definition at `commit`, or in the directory when `commit` is null.
 * A file the definition does not have is kozo's built-in template of the same path.
 */
export async function readDefinition(
  directory: string,
  commit: string | null,
): Promise<DefinitionResult> {
  const issues: string[] = [];
  const read = async (path: keyof typeof factoryTemplate): Promise<string> => {
    try {
      const text =
        commit === null
          ? await Bun.file(join(directory, path))
              .text()
              .catch(() => null)
          : await showFile(directory, commit, path);
      return text ?? factoryTemplate[path];
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      issues.push(`${path}: ${error.message}`);
      return factoryTemplate[path];
    }
  };
  const parsed = <T>(
    path: keyof typeof factoryTemplate,
    text: string,
    parse: (text: string) => T,
  ) => {
    try {
      return parse(text);
    } catch (error) {
      issues.push(`${path}: ${(error as Error).message}`);
      return null;
    }
  };

  const factory = parseFactoryConfig(await read("factory.yml"), issues);
  const agents: Partial<Record<DefinedAgent, AgentDefinition>> = {};
  for (const agent of definedAgents) {
    const path = `agents/${agent}/agent.md` as const;
    const definition = parsed(path, await read(path), parseAgentDefinition);
    if (definition) agents[agent] = definition;
  }
  const verifyApp = parsed(
    "skills/verify-app/SKILL.md",
    await read("skills/verify-app/SKILL.md"),
    parseSkill,
  );
  if (issues.length > 0 || !factory || !verifyApp) return { ok: false, commit, issues };
  return {
    ok: true,
    definition: {
      commit,
      factory,
      agents: agents as Record<DefinedAgent, AgentDefinition>,
      verifyApp,
    },
  };
}
