import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  Blueprint,
  BlueprintNode,
  Charter,
  Constraints,
  GateLevel,
  ItemState,
  KozoHome,
  Plan,
  runFiles,
  Stage,
  TaskState,
} from "@kozo/core";
import { type Base, type Confined, type Definition, type GatesResult, git } from "@kozo/verify";
import type { WorkerSpec } from "@kozo/worker";
import type { EventStore } from "./event-store.ts";
import { taskOwnerNotes } from "./instructions.ts";
import { atLeast, layersFor } from "./risk.ts";
import type { RunnerDeps } from "./runner.ts";
import type { Envelope, SessionResult } from "./session-pump.ts";

export type Node = BlueprintNode;

/** How a run of a task's blueprint ended: done, or retried in a new run until `rounds` runs. */
export type RunEnd = { kind: "done" } | { kind: "retry"; failure: string; rounds: number };

export interface Repository extends Base {
  path: string;
  tip: string;
  charter: Charter;
  constraints: Constraints;
}

type RunState = "succeeded" | "failed" | "stopped" | "lost";
type Layers = (typeof layersFor)[keyof typeof layersFor];

/** What the blueprint's nodes use of the runner that runs them. */
export interface RunnerOps {
  readonly home: KozoHome;
  readonly store: EventStore;
  readonly deps: RunnerDeps;
  readonly commandEnv: Record<string, string>;
  readonly stopping: boolean;
  confined(worktree: string, prepare?: boolean): Confined;
  session(spec: WorkerSpec, envelope: Envelope, maxMinutes: number): Promise<SessionResult>;
  startRun(
    envelope: Omit<Envelope, "run_id">,
    agent: "triage" | "plan" | "implement" | "review" | "verify",
    charterCommit: string,
    definition: Definition,
  ): Promise<string>;
  endRun(run: string, to: RunState, reason?: string, costUsd?: number): Promise<void>;
  hold(
    item: string,
    task: string | null,
    hold: "approval" | "question" | "attention",
    reason: string,
    run?: string,
  ): Promise<void>;
  moveTask(task: TaskState, to: Stage, run: string | null, reason: string): Promise<void>;
  recordedGates(
    where: { run_id?: string; item: string; task: string | null; node: string },
    level: GateLevel,
    cwd: string,
    base: string,
    outputPath: string,
  ): Promise<{ result: GatesResult; output: string }>;
  lastBrief(task: TaskState, run: string): Promise<string>;
  refs(repository: string, branch: string): Promise<Map<string, string>>;
  refsChanged(repository: string, branch: string, before: Map<string, string>): Promise<string[]>;
  writeHandoffReport(
    itemRef: string,
    task: TaskState,
    base: string,
    worktree: string,
    reproduce: boolean,
  ): Promise<void>;
}

/** How a node ends the run with the task held for a human. */
interface Halt {
  hold: "attention" | "question";
  reason: string;
  summary: string;
  end: "succeeded" | "failed" | "lost";
  why?: string;
  ok?: boolean;
}

/**
 * One run of a task's blueprint from a node on, as its nodes share it: the task, its repository
 * and worktree, the run's records, the brief once written, and the verification layers, which
 * a re-rated risk tier raises.
 */
export class BlueprintRun {
  /** The brief, written at the brief node or read back for a run that resumes at implement. */
  prompt = "";
  layers: Layers;
  level: GateLevel;
  readonly envelope: Envelope;

  constructor(
    readonly runner: RunnerOps,
    readonly task: TaskState,
    readonly item: ItemState,
    readonly plan: Plan,
    readonly repository: Repository,
    readonly worktree: string,
    readonly branch: string,
    readonly definition: Definition,
    readonly blueprint: Blueprint,
    readonly run: string,
    readonly files: ReturnType<typeof runFiles>,
    /** The files at the base tip; the guard and the sandbox protect the existing tests among them. */
    readonly listed: string[],
    readonly existingTests: string[],
    /** Why the run before this one did not pass, which the brief carries. */
    readonly failure: string | null,
  ) {
    this.envelope = { run_id: run, item: item.ref, task: task.ref };
    this.layers = layersFor[task.risk];
    this.level = atLeast(this.layers.gates, blueprint.gates);
  }

  get charter(): Charter {
    return this.repository.charter;
  }

  get constraints(): Constraints {
    return this.repository.constraints;
  }

  /** Takes the verification layers of a raised risk tier, and its gates with them. */
  raise(layers: Layers) {
    this.layers = layers;
    this.level = atLeast(layers.gates, this.blueprint.gates);
  }

  async log(text: string) {
    await mkdir(this.files.dir, { recursive: true });
    await appendFile(join(this.files.dir, "kozod.log"), text);
  }

  ownerWords() {
    return taskOwnerNotes(this.runner.store.state, this.task.ref);
  }

  async checkpoint(node: Node) {
    const head = await git(this.worktree, ["rev-parse", "HEAD"]).then(
      (sha) => sha.trim(),
      () => null,
    );
    await this.runner.store.append({ ...this.envelope, node, type: "checkpoint", data: { head } });
  }

  async enter(node: Node, kind: "D" | "A") {
    await this.checkpoint(node);
    await this.runner.store.append({ ...this.envelope, node, type: "node.enter", data: { kind } });
  }

  async exit(node: Node, ok: boolean, summary?: string) {
    await this.runner.store.append({
      ...this.envelope,
      node,
      type: "node.exit",
      data: { ok, ...(summary ? { summary: summary.slice(0, 2000) } : {}) },
    });
  }

  async stopHere(state: RunState, reason?: string): Promise<RunEnd> {
    await this.runner.endRun(this.run, state, reason);
    return { kind: "done" };
  }

  /** Ends the run at `node` with the task held for a human. */
  async halt(node: Node, held: Halt): Promise<RunEnd> {
    await this.exit(node, held.ok ?? false, held.summary);
    await this.runner.hold(this.item.ref, this.task.ref, held.hold, held.reason, this.run);
    return await this.stopHere(held.end, held.why);
  }

  async retry(node: Node, why: string): Promise<RunEnd> {
    await this.exit(node, false, why);
    await this.runner.endRun(this.run, "failed", why.slice(0, 500));
    return { kind: "retry", failure: why, rounds: this.charter.limits.no_progress_rounds };
  }

  /** Sends the task back to Building; the next run starts from `failure`. */
  async sendBack(failure: string, reason = failure): Promise<RunEnd> {
    await this.runner.moveTask(this.task, "building", this.run, reason);
    await this.runner.endRun(this.run, "succeeded");
    return { kind: "retry", failure, rounds: this.charter.limits.no_progress_rounds };
  }

  /** A failed final verification goes back to Building until the fix rounds run out. */
  async backToBuilding(node: Node, why: string): Promise<RunEnd> {
    await this.exit(node, false, why);
    const fixes = this.runner.store.state.tasks[this.task.ref]?.handoffFixes ?? 0;
    if (fixes < this.charter.limits.ci_fix_rounds) return await this.sendBack(why);
    await this.runner.hold(
      this.item.ref,
      this.task.ref,
      "attention",
      `the final verification failed after ${fixes} fixes: ${why}`,
      this.run,
    );
    return await this.stopHere("failed", "final verification failed");
  }
}

export function describe(result: SessionResult): string {
  switch (result.status) {
    case "lost":
      return "lost its worker";
    case "timed-out":
      return "ran out of time";
    case "stopped":
      return "was stopped";
    case "failed":
      return `failed: ${result.outcome.status === "failed" ? result.outcome.reason : "unknown"}`;
    case "answered":
      return "answered";
  }
}

export const tail = (text: string, lines = 40) =>
  text.trimEnd().split("\n").slice(-lines).join("\n");
