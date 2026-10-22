import { stat } from "node:fs/promises";
import { join } from "node:path";
import { type Factory, factoryTemplate, type KozoHome } from "@kozo/core";
import {
  type AgentDefinition,
  GitError,
  git,
  parseAgentDefinition,
  parseSkill,
  type Skill,
  showFile,
} from "@kozo/verify";
import type { EventStore } from "./event-store.ts";
import { parseFactoryConfig } from "./factory-config.ts";
import { defaultBranch } from "./repository.ts";

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

/** The definition in use; kozod replaces `current` only with a definition that validated. */
export interface DefinitionInUse {
  current: Definition;
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
 * The commit kozod reads the definition from: the tip of the default branch of the git
 * repository at `factory/`, or null when `factory/` is not a git repository.
 */
export async function definitionTip(home: KozoHome): Promise<string | null> {
  // Bun.file().exists() is false for a directory, which `.git` usually is.
  const repository = await stat(join(home.factory, ".git")).then(
    () => true,
    () => false,
  );
  if (!repository) return null;
  const branch = await defaultBranch(home.factory);
  return (await git(home.factory, ["rev-parse", `refs/heads/${branch}`])).trim();
}

/**
 * Reads and checks the whole definition at `commit`, or in the directory when `commit` is null.
 * A file the definition does not have is kozo's built-in template of the same path.
 */
export async function readDefinition(
  home: KozoHome,
  commit: string | null,
): Promise<DefinitionResult> {
  const issues: string[] = [];
  const read = async (path: keyof typeof factoryTemplate): Promise<string> => {
    try {
      const text =
        commit === null
          ? await Bun.file(join(home.factory, path))
              .text()
              .catch(() => null)
          : await showFile(home.factory, commit, path);
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

/** Thrown at start when neither the definition's tip nor its last applied commit validates. */
export class DefinitionError extends Error {}

/**
 * The definition kozod starts with: the tip when it validates, else the last applied commit.
 * Records the tip as applied or refused unless the log already says so.
 */
export async function startingDefinition(home: KozoHome, store: EventStore): Promise<Definition> {
  const tip = await definitionTip(home).catch((error: unknown) => {
    if (error instanceof GitError) throw new DefinitionError(`factory/: ${error.message}`);
    throw error;
  });
  const result = await readDefinition(home, tip);
  if (result.ok) {
    await recordApplied(store, result.definition);
    return result.definition;
  }
  await recordRefused(store, result);
  const last = store.state.definition.applied;
  const fallback = last && last !== tip ? await readDefinition(home, last) : null;
  if (fallback?.ok) return fallback.definition;
  throw new DefinitionError(`the factory definition is invalid: ${result.issues.join("; ")}`);
}

/**
 * Applies the definition's tip when it moved and validates; a tip that does not validate is
 * recorded once, reported, and the definition in use stays.
 */
export async function refreshDefinition(
  home: KozoHome,
  store: EventStore,
  inUse: DefinitionInUse,
  report: (message: string) => void,
): Promise<void> {
  let tip: string | null;
  try {
    tip = await definitionTip(home);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    report(`kozod: the factory definition cannot be read: ${error.message}`);
    return;
  }
  if (tip === null || tip === inUse.current.commit || tip === store.state.definition.refused)
    return;
  const result = await readDefinition(home, tip);
  if (!result.ok) {
    await recordRefused(store, result);
    report(
      `kozod: refused the factory definition at ${tip.slice(0, 12)}; still running ${inUse.current.commit?.slice(0, 12)}: ${result.issues.join("; ")}`,
    );
    return;
  }
  await recordApplied(store, result.definition);
  inUse.current = result.definition;
}

async function recordApplied(store: EventStore, definition: Definition) {
  if (definition.commit === null || store.state.definition.applied === definition.commit) return;
  await store.append({ type: "factory.applied", data: { commit: definition.commit } });
}

async function recordRefused(store: EventStore, result: Extract<DefinitionResult, { ok: false }>) {
  const [first, ...rest] = result.issues;
  if (result.commit === null || first === undefined) return;
  if (store.state.definition.refused === result.commit) return;
  await store.append({
    type: "factory.refused",
    data: { commit: result.commit, issues: [first, ...rest] },
  });
}
