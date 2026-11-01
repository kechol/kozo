import { type KozoHome, type Message, message } from "@kozo/core";
import {
  type Definition,
  type DefinitionResult,
  definitionTip,
  GitError,
  readDefinition,
} from "@kozo/verify";
import type { EventStore } from "./event-store.ts";

/** The definition in use; kozod replaces `current` only with a definition that validated. */
export interface DefinitionInUse {
  current: Definition;
}

/** Thrown at start when neither the definition's tip nor its last applied commit validates. */
export class DefinitionError extends Error {}

/** A tip that kozod refused at start while it went on with the last applied commit. */
export interface StartRefusal {
  commit: string;
  running: string;
  issues: string[];
  /** Whether this start recorded the refusal, rather than an earlier run of kozod. */
  recorded: boolean;
}

/**
 * The definition kozod starts with: the tip when it validates, else the last applied commit.
 * Records the tip as applied or refused unless the log already says so, and hands a refused
 * tip to `refused`, since nothing that reports it is running yet.
 */
export async function startingDefinition(
  home: KozoHome,
  store: EventStore,
  refused: (refusal: StartRefusal) => void = () => {},
): Promise<Definition> {
  const tip = await definitionTip(home.factory).catch((error: unknown) => {
    if (error instanceof GitError) throw new DefinitionError(`factory/: ${error.message}`);
    throw error;
  });
  const result = await readDefinition(home.factory, tip);
  if (result.ok) {
    await recordApplied(store, result.definition);
    return result.definition;
  }
  const recorded = await recordRefused(store, result);
  const last = store.state.definition.applied;
  const fallback = last && last !== tip ? await readDefinition(home.factory, last) : null;
  if (fallback?.ok) {
    if (tip !== null)
      refused({ commit: tip, running: last ?? "", issues: result.issues, recorded });
    return fallback.definition;
  }
  throw new DefinitionError(`the factory definition is invalid: ${result.issues.join("; ")}`);
}

/**
 * Applies the definition's tip when it moved and validates; a tip that does not validate is
 * recorded once, reported, and the definition in use stays. So is a tip that changes the mode,
 * which parts of kozod fix when it starts, such as the local API and work already under way
 * against one base; it applies at the next start.
 */
export async function refreshDefinition(
  home: KozoHome,
  store: EventStore,
  inUse: DefinitionInUse,
  report: (message: string) => void,
): Promise<void> {
  let tip: string | null;
  try {
    tip = await definitionTip(home.factory);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    report(`kozod: the factory definition cannot be read: ${error.message}`);
    return;
  }
  if (tip === null || tip === inUse.current.commit || tip === store.state.definition.refused)
    return;
  const read = await readDefinition(home.factory, tip);
  const mode = inUse.current.factory.mode;
  const result: DefinitionResult =
    read.ok && read.definition.factory.mode !== mode
      ? {
          ok: false,
          commit: tip,
          issues: [
            `factory.yml: mode changes from ${mode} to ${read.definition.factory.mode} only when kozod starts again`,
          ],
        }
      : read;
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

/** Records a refused tip once; whether this call recorded it. */
async function recordRefused(
  store: EventStore,
  result: Extract<DefinitionResult, { ok: false }>,
): Promise<boolean> {
  const [first, ...rest] = result.issues;
  if (result.commit === null || first === undefined) return false;
  if (store.state.definition.refused === result.commit) return false;
  await store.append({
    type: "factory.refused",
    data: {
      commit: result.commit,
      issues: [first, ...rest].map((issue) => message("text", { text: issue })) as [
        Message,
        ...Message[],
      ],
    },
  });
  return true;
}
