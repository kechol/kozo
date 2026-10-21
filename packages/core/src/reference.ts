import { z } from "zod";

/** An item: `K-<n>` in local mode, where `repo` is null, or `<repo>#<n>` in GitHub mode. */
export interface ItemReference {
  repo: string | null;
  number: number;
}

export type Reference =
  | { kind: "item"; item: ItemReference }
  | { kind: "task"; item: ItemReference; task: number }
  | { kind: "run"; run: number };

const referencePattern =
  /^(?:(?:K-(?<local>\d+)|(?<repo>[A-Za-z0-9][A-Za-z0-9._-]*)#(?<github>\d+))(?:\/t(?<task>\d+))?|r-(?<run>\d{4,}))$/;

export function parseReference(text: string): Reference | null {
  const groups = referencePattern.exec(text)?.groups;
  if (!groups) return null;
  const { local, repo, github, task, run } = groups;
  const numbers = [local, github, task, run].filter((digits) => digits !== undefined).map(Number);
  if (!numbers.every((value) => Number.isSafeInteger(value) && value > 0)) return null;
  let reference: Reference;
  if (run !== undefined) {
    reference = { kind: "run", run: Number(run) };
  } else {
    const item: ItemReference =
      repo === undefined ? { repo: null, number: Number(local) } : { repo, number: Number(github) };
    reference =
      task === undefined ? { kind: "item", item } : { kind: "task", item, task: Number(task) };
  }
  // Leading zeros beyond a run's padding fail here, so each reference has exactly one spelling.
  return formatReference(reference) === text ? reference : null;
}

export function formatItemReference(item: ItemReference): string {
  return item.repo === null ? `K-${item.number}` : `${item.repo}#${item.number}`;
}

export function formatReference(reference: Reference): string {
  switch (reference.kind) {
    case "item":
      return formatItemReference(reference.item);
    case "task":
      return `${formatItemReference(reference.item)}/t${reference.task}`;
    case "run":
      return `r-${String(reference.run).padStart(4, "0")}`;
  }
}

const spellings = { item: "K-<n> or <repo>#<n>", task: "<item>/t<n>", run: "r-<nnnn>" };

const referenceOf = (kind: Reference["kind"]) =>
  z.string().refine((text) => parseReference(text)?.kind === kind, `Use ${spellings[kind]}`);

export const itemReferenceSchema = referenceOf("item");
export const taskReferenceSchema = referenceOf("task");
export const runReferenceSchema = referenceOf("run");
