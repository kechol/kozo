import type { AutonomyLevel, Charter, WorkClass } from "./charter.ts";
import type { Event, EventType, NoteKind } from "./event.ts";
import type { Plan } from "./plan.ts";
import type { ReviewVerdict } from "./verdict.ts";
import {
  type Approvals,
  type HoldKind,
  type RiskTier,
  type RunState,
  riskTierSchema,
  type Stage,
  stageSchema,
} from "./work-model.ts";

export interface Hold {
  kind: HoldKind;
  reason: string;
  since: string;
}

export interface Note {
  ts: string;
  /** The item or task reference the note is about. */
  target: string;
  kind: NoteKind;
  text: string;
}

export interface ItemState {
  ref: string;
  repository: string;
  title: string;
  source: "local" | "github" | "automation";
  /** The class the request asked for, or null. */
  requestedClass: WorkClass | null;
  approvals: Approvals;
  /** Who accepted the item's latest plan, or null before one is accepted. */
  acceptedBy: "human" | "kozod" | null;
  /**
   * The item's own stage: Intake to Planning before it has tasks, then `building` until it
   * reaches Complete or Cancelled. `itemStage` gives the stage to show.
   */
  stage: Stage;
  hold: Hold | null;
  draft: Plan | null;
  plan: Plan | null;
  /** The rejections of its plan since it last went to Triage or had a plan accepted. */
  rejections: number;
  tasks: string[];
  /** The notes about the item and its tasks, oldest first. */
  notes: Note[];
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  run: string;
  node: string;
  head: string | null;
  at: string;
}

export interface TaskState {
  ref: string;
  item: string;
  goal: string;
  done_when: string[];
  scope: string[];
  depends_on: string[];
  /** Whether the task only adds tests that pin behaviour its item keeps. */
  characterize: boolean;
  /** The command kozod runs in the worktree before the task's first implement session. */
  codemod: string | null;
  /** Whether a human gave the task back after taking it, until its next blueprint run starts. */
  returned: boolean;
  /** The work class of the plan that made the task. */
  class: WorkClass;
  /** Whether a human added commits to the task, by taking it or on its branch at Handoff. */
  humanCommits: boolean;
  /** Whether a human sent the task back from Handoff with a change request. */
  sentBack: boolean;
  /** When the task last reached Handoff, or null before it did. */
  handedOffAt: string | null;
  /** When a check after the task's merge failed, a post-merge defect, or null. */
  defectAt: string | null;
  /** The plan's tier, or the higher one kozod rated the task's diff at. */
  risk: RiskTier;
  stage: Stage;
  hold: Hold | null;
  /** How many times Reviewing sent the task back to Building. */
  revisions: number;
  /** How many times the final verification at Handoff sent the task back to Building. */
  handoffFixes: number;
  runs: string[];
  checkpoint: Checkpoint | null;
  /** The commit of the default branch that brought the task branch in, once kozod saw it. */
  merged: { commit: string | null; at: string } | null;
  /** When the plan that made the task was accepted. */
  createdAt: string;
  updatedAt: string;
}

export interface RunInfo {
  ref: string;
  item: string;
  task: string | null;
  parent: string | null;
  agent: string;
  model: string;
  state: RunState;
  startedAt: string;
  endedAt: string | null;
  /** Whether kozod sealed the run's log, after which no event of the run may follow. */
  sealed: boolean;
}

export interface Demotion {
  repository: string;
  class: WorkClass;
  from: AutonomyLevel;
  to: AutonomyLevel;
  charterSha: string;
  reason: string;
  at: string;
}

export const demotionKey = (repository: string, workClass: WorkClass) =>
  `${workClass}@${repository}`;

export interface FactoryState {
  /** The factory's ID from `factory.created`, null only before kozod first starts. */
  factoryId: string | null;
  paused: boolean;
  pausedReason: string | null;
  /**
   * The commit of the factory definition last applied, and of the last one refused since; both
   * null while the definition is not a git repository.
   */
  definition: { applied: string | null; refused: string | null };
  /** When kozod first ran a definition naming each GitHub repository, by `<owner>/<name>`. */
  repositories: Record<string, { path: string; registeredAt: string }>;
  items: Record<string, ItemState>;
  /** Every item's reference in the order kozod starts their work: arrival, then a human's moves. */
  order: string[];
  tasks: Record<string, TaskState>;
  runs: Record<string, RunInfo>;
  /** kozod's demotions of a class in a repository, by `demotionKey`. */
  demotions: Record<string, Demotion>;
  /** The `ts` of the last event applied; events must come in strictly increasing order. */
  lastTs: string | null;
}

/**
 * The event types that `applyEvent` only checks and orders: they leave the state as it is but
 * for `lastTs`, so kozod applies them without copying the state or touching the index rows.
 */
export const recordOnlyTypes: ReadonlySet<EventType> = new Set<EventType>([
  "session.started",
  "node.enter",
  "node.exit",
  "agent.message",
  "tool.call",
  "guard.denied",
  "tool.result",
  "instruction.delivered",
  "gates.result",
  "handoff.ready",
  "review.verdict",
  "external.write",
  "cost.tick",
  "factory.pruned",
]);

/** An event that the current state does not allow, which means a broken log or a kozod bug. */
export class StateError extends Error {}

export function emptyState(): FactoryState {
  return {
    factoryId: null,
    paused: false,
    pausedReason: null,
    definition: { applied: null, refused: null },
    repositories: {},
    items: {},
    order: [],
    tasks: {},
    runs: {},
    demotions: {},
    lastTs: null,
  };
}

const closed: readonly Stage[] = ["complete", "cancelled"];

export function isClosed(stage: Stage): boolean {
  return closed.includes(stage);
}

// Complete is reachable from every open stage because a human may close work that needed no
// change; kozod itself completes a task only from Handoff.
const itemEdges: Partial<Record<Stage, readonly Stage[]>> = {
  intake: ["triage", "complete"],
  triage: ["planning", "complete"],
  // `kozo retry` sends an item held in Planning back to Triage.
  planning: ["triage", "complete"],
  // A task that cannot be done within its scope sends its item back to be split again.
  building: ["planning", "complete"],
  // An item whose DONE_WHEN fails after the merge goes back to Triage.
  complete: ["triage"],
};

const taskEdges: Partial<Record<Stage, readonly Stage[]>> = {
  building: ["reviewing", "complete"],
  reviewing: ["building", "handoff", "complete"],
  // A human's commit on the task branch sends the task back to Reviewing.
  handoff: ["building", "reviewing", "complete"],
};

function allowed(edges: typeof itemEdges, from: Stage, to: Stage): boolean {
  if (to === "cancelled") return !isClosed(from);
  return edges[from]?.includes(to) ?? false;
}

/** The highest task number of an item, 0 before it has tasks. */
export function highestTask(item: ItemState): number {
  return Math.max(0, ...item.tasks.map((ref) => Number(ref.slice(ref.lastIndexOf("/t") + 2))));
}

/**
 * The plan with its task IDs numbered after an item's highest task number, as when an item
 * comes back from a post-merge defect with a new plan: t1 becomes t<highest + 1>, dependencies
 * too.
 */
export function numberAfter(plan: Plan, highest: number): Plan {
  if (highest === 0) return plan;
  const renamed = (id: string) => `t${Number(id.slice(1)) + highest}`;
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({
      ...task,
      id: renamed(task.id),
      depends_on: task.depends_on.map(renamed),
    })) as Plan["tasks"],
  };
}

/** The task references of a plan's tasks, in plan order. */
export function taskReferences(plan: Plan): string[] {
  return plan.tasks.map((task) => `${plan.item}/${task.id}`);
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new StateError(`${what} does not exist`);
  return value;
}

/**
 * Applies one event to the state in place. Records such as tool calls leave the state as it
 * is; an event that the state does not allow throws StateError.
 */
export function applyEvent(state: FactoryState, event: Event): void {
  if (state.lastTs !== null && event.ts <= state.lastTs) {
    throw new StateError(`event ${event.type} at ${event.ts} is not after ${state.lastTs}`);
  }
  if (event.run_id !== null && state.runs[event.run_id]?.sealed) {
    throw new StateError(`run ${event.run_id} is sealed`);
  }
  state.lastTs = event.ts;
  const item = event.item === null ? undefined : state.items[event.item];
  const task = event.task === null ? undefined : state.tasks[event.task];
  const subjectOf = (target: "item" | "task") =>
    target === "item" ? required(item, `item ${event.item}`) : required(task, `task ${event.task}`);
  switch (event.type) {
    case "factory.created":
      if (state.factoryId !== null)
        throw new StateError(`the factory is ${state.factoryId} already`);
      state.factoryId = event.data.factory_id;
      return;
    case "factory.changed":
      state.paused = event.data.paused;
      state.pausedReason = event.data.paused ? event.data.reason : null;
      return;
    case "factory.repository":
      if (state.repositories[event.data.github])
        throw new StateError(`${event.data.github} is registered already`);
      state.repositories[event.data.github] = { path: event.data.path, registeredAt: event.ts };
      return;
    case "factory.applied":
      state.definition = { applied: event.data.commit, refused: null };
      return;
    case "factory.refused":
      state.definition = { ...state.definition, refused: event.data.commit };
      return;
    case "factory.pruned":
      return;
    case "factory.demoted": {
      const { repository, from, to, charter_sha, reason } = event.data;
      state.demotions[demotionKey(repository, event.data.class)] = {
        repository,
        class: event.data.class,
        from,
        to,
        charterSha: charter_sha,
        reason,
        at: event.ts,
      };
      return;
    }
    case "item.created": {
      const ref = event.item ?? "";
      if (item) throw new StateError(`item ${ref} already exists`);
      state.items[ref] = {
        ref,
        repository: event.data.repository,
        title: event.data.title,
        source: event.data.source,
        requestedClass: event.data.class,
        approvals: event.data.approvals,
        acceptedBy: null,
        stage: "intake",
        hold: null,
        draft: null,
        plan: null,
        rejections: 0,
        tasks: [],
        notes: [],
        createdAt: event.ts,
        updatedAt: event.ts,
      };
      state.order.push(ref);
      return;
    }
    case "item.reordered": {
      const subject = required(item, `item ${event.item}`);
      const { before } = event.data;
      if (before === subject.ref) throw new StateError(`${subject.ref} cannot move before itself`);
      if (before !== null) required(state.items[before], `item ${before}`);
      state.order = state.order.filter((ref) => ref !== subject.ref);
      const at = before === null ? state.order.length : state.order.indexOf(before);
      state.order.splice(at, 0, subject.ref);
      subject.updatedAt = event.ts;
      return;
    }
    case "item.edited": {
      const subject = required(item, `item ${event.item}`);
      subject.title = event.data.title;
      subject.updatedAt = event.ts;
      return;
    }
    case "stage.changed": {
      const subject = subjectOf(event.data.target);
      if (subject.stage !== event.data.from) {
        throw new StateError(`${subject.ref} is in ${subject.stage}, not ${event.data.from}`);
      }
      const edges = event.data.target === "item" ? itemEdges : taskEdges;
      if (!allowed(edges, subject.stage, event.data.to)) {
        throw new StateError(`${subject.ref} cannot go from ${subject.stage} to ${event.data.to}`);
      }
      if (subject.hold && event.data.to !== "cancelled") {
        throw new StateError(`${subject.ref} is held by ${subject.hold.kind}`);
      }
      if (event.data.target === "task" && task) {
        if (task.stage === "reviewing" && event.data.to === "building") task.revisions += 1;
        // A human's change request sends a task back as well, but only kozod's sends are fix rounds.
        if (task.stage === "handoff" && event.data.to === "building" && event.data.by === "kozod")
          task.handoffFixes += 1;
        // Only a human's commit moves a task from Handoff to Reviewing.
        if (task.stage === "handoff" && event.data.to === "reviewing") task.humanCommits = true;
        if (task.stage === "handoff" && event.data.to === "building" && event.data.by === "human")
          task.sentBack = true;
        if (event.data.to === "handoff") task.handedOffAt = event.ts;
      }
      if (event.data.target === "item" && item && event.data.to === "triage") item.rejections = 0;
      subject.stage = event.data.to;
      subject.updatedAt = event.ts;
      return;
    }
    case "hold.set": {
      const subject = subjectOf(event.data.target);
      if (subject.hold) {
        throw new StateError(`${subject.ref} is already held by ${subject.hold.kind}`);
      }
      if (isClosed(subject.stage)) throw new StateError(`${subject.ref} is ${subject.stage}`);
      if (!holdTargets[event.data.hold].includes(event.data.target)) {
        throw new StateError(`a ${event.data.target} cannot be held by ${event.data.hold}`);
      }
      subject.hold = { kind: event.data.hold, reason: event.data.reason, since: event.ts };
      subject.updatedAt = event.ts;
      return;
    }
    case "hold.cleared": {
      const subject = subjectOf(event.data.target);
      if (subject.hold?.kind !== event.data.hold) {
        throw new StateError(`${subject.ref} is not held by ${event.data.hold}`);
      }
      subject.hold = null;
      subject.updatedAt = event.ts;
      return;
    }
    case "note.added": {
      const subject = required(item, `item ${event.item}`);
      if (event.task !== null) required(task, `task ${event.task}`);
      subject.notes.push({
        ts: event.ts,
        target: event.task ?? subject.ref,
        kind: event.data.kind,
        text: event.data.text,
      });
      if (event.data.kind === "rejection" && event.task === null) subject.rejections += 1;
      if (event.data.kind === "check" && task) task.defectAt = event.ts;
      return;
    }
    case "plan.proposed": {
      const subject = required(item, `item ${event.item}`);
      if (event.data.plan.item !== subject.ref) {
        throw new StateError(`the plan is for ${event.data.plan.item}, not ${subject.ref}`);
      }
      subject.draft = event.data.plan;
      subject.updatedAt = event.ts;
      return;
    }
    case "plan.accepted": {
      const subject = required(item, `item ${event.item}`);
      const plan = event.data.plan;
      if (plan.item !== subject.ref) {
        throw new StateError(`the plan is for ${plan.item}, not ${subject.ref}`);
      }
      if (subject.stage !== "triage" && subject.stage !== "planning") {
        throw new StateError(`${subject.ref} cannot accept a plan in ${subject.stage}`);
      }
      if (subject.hold) throw new StateError(`${subject.ref} is held by ${subject.hold.kind}`);
      const refs = taskReferences(plan);
      const reused = refs.find((ref) => state.tasks[ref]);
      if (reused) throw new StateError(`${reused} already exists; number the new tasks after it`);
      subject.plan = plan;
      subject.acceptedBy = event.data.by;
      subject.draft = null;
      subject.rejections = 0;
      subject.stage = "building";
      subject.tasks = [...subject.tasks, ...refs];
      plan.tasks.forEach((planned, index) => {
        const ref = refs[index] ?? "";
        state.tasks[ref] = {
          ref,
          item: subject.ref,
          goal: planned.goal,
          done_when: planned.done_when,
          scope: planned.scope,
          depends_on: planned.depends_on.map((id) => `${plan.item}/${id}`),
          characterize: planned.characterize ?? false,
          codemod: planned.codemod ?? null,
          returned: false,
          class: plan.class,
          humanCommits: false,
          sentBack: false,
          handedOffAt: null,
          defectAt: null,
          risk: plan.risk,
          stage: "building",
          hold: null,
          revisions: 0,
          handoffFixes: 0,
          runs: [],
          checkpoint: null,
          merged: null,
          createdAt: event.ts,
          updatedAt: event.ts,
        };
      });
      subject.updatedAt = event.ts;
      return;
    }
    case "run.started": {
      const ref = event.run_id ?? "";
      if (state.runs[ref]) throw new StateError(`run ${ref} already exists`);
      const owner = required(item, `item ${event.item}`);
      if (event.task !== null) {
        const subject = required(task, `task ${event.task}`);
        subject.runs.push(ref);
        if (event.data.agent === "implement") subject.returned = false;
      }
      state.runs[ref] = {
        ref,
        item: owner.ref,
        task: event.task,
        parent: event.parent_run,
        agent: event.data.agent,
        model: event.data.model,
        state: "running",
        startedAt: event.ts,
        endedAt: null,
        sealed: false,
      };
      return;
    }
    case "log.sealed": {
      const run = required(state.runs[event.data.run], `run ${event.data.run}`);
      if (!isRunOver(run.state)) throw new StateError(`${run.ref} is ${run.state}, not over`);
      if (run.sealed) throw new StateError(`${run.ref} is already sealed`);
      run.sealed = true;
      return;
    }
    case "run.changed": {
      const run = required(state.runs[event.run_id ?? ""], `run ${event.run_id}`);
      if (run.state !== event.data.from) {
        throw new StateError(`${run.ref} is ${run.state}, not ${event.data.from}`);
      }
      if (!runEdges[run.state]?.includes(event.data.to)) {
        throw new StateError(`${run.ref} cannot go from ${run.state} to ${event.data.to}`);
      }
      run.state = event.data.to;
      if (isRunOver(run.state)) run.endedAt = event.ts;
      return;
    }
    case "branch.merged": {
      const subject = required(task, `task ${event.task}`);
      if (subject.merged) throw new StateError(`${subject.ref} is already merged`);
      subject.merged = { commit: event.data.commit, at: event.ts };
      return;
    }
    case "risk.raised": {
      const subject = required(task, `task ${event.task}`);
      if (subject.risk !== event.data.from) {
        throw new StateError(`${subject.ref} is rated ${subject.risk}, not ${event.data.from}`);
      }
      const tiers = riskTierSchema.options;
      if (tiers.indexOf(event.data.to) <= tiers.indexOf(event.data.from)) {
        throw new StateError(
          `a risk tier only goes up, not from ${event.data.from} to ${event.data.to}`,
        );
      }
      subject.risk = event.data.to;
      subject.updatedAt = event.ts;
      return;
    }
    case "task.returned": {
      const subject = required(task, `task ${event.task}`);
      subject.returned = true;
      subject.humanCommits = true;
      subject.updatedAt = event.ts;
      return;
    }
    case "checkpoint": {
      const subject = required(task, `task ${event.task}`);
      subject.checkpoint = {
        run: event.run_id ?? "",
        node: event.node ?? "",
        head: event.data.head,
        at: event.ts,
      };
      return;
    }
    default:
      return;
  }
}

// Attention is a task's hold, and also what an item's approval turns into once it expires.
const holdTargets: Record<HoldKind, readonly ("item" | "task")[]> = {
  approval: ["item"],
  question: ["item", "task"],
  attention: ["item", "task"],
  dependency: ["item", "task"],
  capacity: ["task"],
  paused: ["item", "task"],
  taken: ["task"],
};

const runEdges: Partial<Record<RunState, readonly RunState[]>> = {
  running: ["paused", "succeeded", "failed", "stopped", "lost"],
  paused: ["running", "stopped"],
};

export function isRunOver(state: RunState): boolean {
  return state === "succeeded" || state === "failed" || state === "stopped" || state === "lost";
}

/** The stage to show for an item: its earliest open task once it has tasks, else its own. */
export function itemStage(state: FactoryState, item: ItemState): Stage {
  if (item.tasks.length === 0 || isClosed(item.stage)) return item.stage;
  const open = item.tasks
    .map((ref) => state.tasks[ref]?.stage)
    .filter((stage): stage is Stage => stage !== undefined && !isClosed(stage));
  if (open.length === 0) return item.stage;
  return open.reduce((earliest, stage) =>
    stageSchema.options.indexOf(stage) < stageSchema.options.indexOf(earliest) ? stage : earliest,
  );
}

export function autonomyLevel(charter: Charter, workClass: WorkClass | null): AutonomyLevel {
  return (workClass && charter.levels[workClass]) || charter.levels.default;
}

/**
 * The level an item runs at: its requested class's, and once triage drafts a class, the lower
 * of the two, since that class comes from a session that read the request and may lower the
 * level but never raise it.
 */
export function itemLevel(
  charter: Charter,
  requested: WorkClass | null,
  drafted: WorkClass | null,
): AutonomyLevel {
  const levels = [autonomyLevel(charter, requested)];
  if (drafted !== null) levels.push(autonomyLevel(charter, drafted));
  return levels.sort()[0] ?? charter.levels.default;
}

/** Start approval needed?: whether a new item waits for a human before it goes to Triage. */
export function startNeeded(approvals: Approvals, level: AutonomyLevel): boolean {
  return approvals === "always" || level === "L1";
}

/**
 * Plan needed?: whether an item goes from Triage to Planning for a plan approval or has its
 * draft accepted as it is. L3 skips Planning only for a single task below the high risk tier
 * without a codemod, a command that a human reads before kozod runs it.
 */
export function planNeeded(approvals: Approvals, level: AutonomyLevel, plan: Plan): boolean {
  if (approvals === "always" || level !== "L3") return true;
  if (plan.tasks.some((task) => task.codemod !== undefined)) return true;
  return plan.risk === "high" || plan.tasks.length > 1;
}

export type ReviewOutcome =
  | { stage: "handoff" }
  | { stage: "building" }
  | { hold: "attention" | "question"; reason: string };

/**
 * Revision needed?: where a task goes after review. A revise verdict goes back to Building
 * at most `innerRetries` times; escalate always asks the human.
 */
export function afterReview(
  verdict: ReviewVerdict,
  revisions: number,
  innerRetries: number,
): ReviewOutcome {
  if (verdict === "accept") return { stage: "handoff" };
  if (verdict === "escalate") return { hold: "question", reason: "review escalated" };
  if (revisions < innerRetries) return { stage: "building" };
  return { hold: "attention", reason: `review asked for a revision after ${revisions} retries` };
}

/** Replays events in order into a new state. */
export function replay(events: Iterable<Event>): FactoryState {
  const state = emptyState();
  for (const event of events) applyEvent(state, event);
  return state;
}

export const approvalExpiryDays = 7;

/** The items whose approval hold has waited `approvalExpiryDays` or longer at `now`. */
export function expiredApprovals(state: FactoryState, now: Date): ItemState[] {
  const limit = now.getTime() - approvalExpiryDays * 24 * 60 * 60 * 1000;
  return Object.values(state.items).filter(
    (item) => item.hold?.kind === "approval" && Date.parse(item.hold.since) <= limit,
  );
}

/** The items in the order kozod starts their work, and their tasks in that order, by plan. */
export function inOrder(state: FactoryState): { items: ItemState[]; tasks: TaskState[] } {
  const items = state.order.flatMap((ref) => state.items[ref] ?? []);
  const tasks = items.flatMap((item) => item.tasks.flatMap((ref) => state.tasks[ref] ?? []));
  return { items, tasks };
}

/** Why a task may not start a run now, or null when it may. */
export function startBlocker(state: FactoryState, task: TaskState): string | null {
  if (state.paused) return `the factory is paused: ${state.pausedReason}`;
  const item = state.items[task.item];
  if (item?.hold) return `${item.ref} is held by ${item.hold.kind}`;
  if (task.hold) return `${task.ref} is held by ${task.hold.kind}`;
  if (isClosed(task.stage)) return `${task.ref} is ${task.stage}`;
  const open = task.depends_on.filter((ref) => state.tasks[ref]?.stage !== "complete");
  if (open.length > 0) return `${task.ref} waits for ${open.join(", ")}`;
  return null;
}
