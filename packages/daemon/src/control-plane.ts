import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AddItem,
  type Automation,
  autonomyLevel,
  isClosed,
  type KozoHome,
  type NoteKind,
  planApprovalReason,
  type Reference,
  runFiles,
  type Stage,
  startApprovalReason,
  type Verb,
  type verbBodySchemas,
} from "@kozo/core";
import { git } from "@kozo/verify";
import type { z } from "zod";
import { CommandError, type VerbResult } from "./api.ts";
import type { DefinitionInUse } from "./definition.ts";
import type { EventStore } from "./event-store.ts";
import { enqueue } from "./instructions.ts";
import { type ItemFile, itemPath, writeItemFile } from "./item-file.ts";
import { costSince } from "./queries.ts";
import { readCharter } from "./repository.ts";
import type { Runner } from "./runner.ts";
import { taskBranch, worktreePath } from "./worktrees.ts";

type Body<V extends Verb> = z.infer<(typeof verbBodySchemas)[V]>;

/** The reason of the paused hold that `kozo take` sets, which `kozo return` alone clears. */
export const takenReason = "the human took it; kozo return gives it back";

const normalTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The control plane: every decision about items, tasks and runs that can be made without a
 * model, each recorded as events through the store.
 */
export class ControlPlane {
  constructor(
    readonly home: KozoHome,
    readonly store: EventStore,
    readonly definition: DefinitionInUse,
    readonly runner: Runner | null = null,
  ) {}

  private repositoryFor(requested: string | undefined): string {
    const registered = this.definition.current.factory.repositories.map(
      (repository) => repository.path,
    );
    if (registered.length === 0) {
      throw new CommandError(422, "no repository is registered; add one to factory/factory.yml");
    }
    if (requested === undefined) {
      if (registered.length > 1) {
        throw new CommandError(400, `name the repository: ${registered.join(", ")}`);
      }
      return registered[0] ?? "";
    }
    const path = resolve(requested);
    const match = registered.find((repository) => repository === path);
    if (!match) throw new CommandError(422, `${requested} is not a registered repository`);
    return match;
  }

  /**
   * Intake: registers a local item after the Charter and duplicate checks. An item at L1 waits
   * for a start approval; any other goes on to Triage.
   */
  async addItem(body: AddItem): Promise<{ ref: string } & VerbResult> {
    const repository = this.repositoryFor(body.repository);
    const charter = await readCharter(repository, this.definition.current.factory.mode);
    if (!charter.ok) throw new CommandError(422, `not accepted: ${charter.reason}`);
    const title = normalTitle(body.title);
    const duplicate = Object.values(this.store.state.items).find(
      (item) =>
        !isClosed(item.stage) &&
        item.repository === repository &&
        normalTitle(item.title) === title,
    );
    if (duplicate) throw new CommandError(409, `${duplicate.ref} already asks for this`);

    const ref = this.store.nextLocalItem();
    const started = await this.admit(
      ref,
      { repository, class: body.class ?? null, title: body.title.trim(), body: body.body ?? "" },
      "local",
      autonomyLevel(charter.charter, body.class ?? null) === "L1",
    );
    return started
      ? { ref, message: `added ${ref}; it goes to Triage` }
      : { ref, message: `added ${ref}; it waits for your start approval`, awaitingHuman: true };
  }

  /**
   * Adds an automation's request as an item that waits for a start approval, unless the
   * repository has an open item of the same title. Returns the new item's reference, or why
   * there is none.
   */
  async addAutomated(automation: Automation): Promise<{ ref: string } | { skipped: string }> {
    const repository = this.repositoryFor(automation.repository ?? undefined);
    const charter = await readCharter(repository, this.definition.current.factory.mode);
    if (!charter.ok) return { skipped: `not accepted: ${charter.reason}` };
    const title = normalTitle(automation.title);
    const open = Object.values(this.store.state.items).find(
      (item) =>
        !isClosed(item.stage) &&
        item.repository === repository &&
        normalTitle(item.title) === title,
    );
    if (open) return { skipped: `${open.ref} still asks for it` };
    const ref = this.store.nextLocalItem();
    await this.admit(
      ref,
      { repository, class: automation.class, title: automation.title, body: automation.body },
      "automation",
      true,
    );
    return { ref };
  }

  /**
   * Writes an item's file and records it, then holds it for a start approval or sends it to
   * Triage. Returns whether it went to Triage.
   */
  async admit(
    ref: string,
    file: ItemFile,
    source: "local" | "github" | "automation",
    startApproval: boolean,
  ): Promise<boolean> {
    const { repository, title } = file;
    await writeItemFile(this.home, ref, file);
    try {
      await this.store.append({
        type: "item.created",
        item: ref,
        data: { repository, title, source },
      });
    } catch (error) {
      await rm(itemPath(this.home, ref), { force: true });
      throw error;
    }
    if (startApproval) {
      await this.store.append({
        type: "hold.set",
        item: ref,
        data: { target: "item", hold: "approval", by: "kozod", reason: startApprovalReason },
      });
      return false;
    }
    await this.store.append({
      type: "stage.changed",
      item: ref,
      data: {
        target: "item",
        from: "intake",
        to: "triage",
        by: "kozod",
        reason: "its autonomy level needs no start approval",
      },
    });
    return true;
  }

  // --- Judgment and control verbs ---------------------------------------------------------------

  /** Performs one verb on a reference; repeating a verb changes nothing a second time. */
  async act(ref: string, reference: Reference, verb: Verb, body: unknown): Promise<VerbResult> {
    if (reference.kind === "run") return await this.actOnRun(ref, verb, body);
    switch (verb) {
      case "approve":
        return await this.approve(ref, body as Body<"approve">);
      case "reject":
        return await this.reject(ref, body as Body<"reject">);
      case "say":
        return await this.say(ref, reference.kind, body as Body<"say">);
      case "pause":
        return await this.pause(ref, reference.kind, body as Body<"pause">);
      case "resume":
        return await this.resume(ref, reference.kind);
      case "retry":
        return await this.retry(ref, reference.kind, body as Body<"retry">);
      case "close":
        return await this.close(ref, reference.kind, body as Body<"close">);
      case "take":
        return await this.take(ref);
      case "return":
        return await this.giveBack(ref, body as Body<"return">);
    }
  }

  private subject(ref: string, kind: "item" | "task") {
    const subject = kind === "item" ? this.store.state.items[ref] : this.store.state.tasks[ref];
    if (!subject) throw new CommandError(404, `${ref} does not exist`);
    const item = kind === "item" ? ref : (this.store.state.tasks[ref]?.item ?? "");
    return { subject, item, task: kind === "task" ? ref : null };
  }

  private async clearHold(kind: "item" | "task", ref: string, reason?: string) {
    const { subject, item, task } = this.subject(ref, kind);
    if (!subject.hold) return;
    await this.store.append({
      type: "hold.cleared",
      item,
      task,
      data: { target: kind, hold: subject.hold.kind, by: "human", ...(reason ? { reason } : {}) },
    });
  }

  private async setHold(kind: "item" | "task", ref: string, hold: "paused", reason: string) {
    const { item, task } = this.subject(ref, kind);
    await this.store.append({
      type: "hold.set",
      item,
      task,
      data: { target: kind, hold, by: "human", reason },
    });
  }

  /** Keeps what a human said about an item or a task for the runs that follow. */
  private async note(item: string, target: string, kind: NoteKind, text: string) {
    await this.store.append({
      type: "note.added",
      item,
      task: target === item ? null : target,
      data: { kind, text },
    });
  }

  /** Moves an item or a task as a human asked, with the command that asked as the reason. */
  private async move(kind: "item" | "task", ref: string, to: Stage, reason: string) {
    const { subject, item, task } = this.subject(ref, kind);
    if (subject.stage === to) return;
    await this.store.append({
      type: "stage.changed",
      item,
      task,
      data: { target: kind, from: subject.stage, to, by: "human", reason },
    });
  }

  private async approve(ref: string, body: Body<"approve">): Promise<VerbResult> {
    const { subject } = this.subject(ref, "item");
    const item = this.store.state.items[ref];
    if (subject.hold?.kind !== "approval" || !item)
      return { message: `${ref} is not waiting for an approval` };
    const start = subject.hold.reason === startApprovalReason;
    await this.clearHold("item", ref, body.text);
    if (start) {
      if (body.text) await this.note(ref, ref, "approval", body.text);
      await this.move("item", ref, "triage", "kozo approve");
      return { message: `approved the start of ${ref}; it goes to Triage` };
    }
    if (!item.draft) throw new CommandError(409, `${ref} has no plan to approve`);
    await this.store.append({
      type: "plan.accepted",
      item: ref,
      data: { plan: item.draft, by: "human" },
    });
    // After the acceptance, so that the tasks' runs take it as said about their plan.
    if (body.text) await this.note(ref, ref, "approval", body.text);
    return {
      message: `approved the plan of ${ref}; ${item.draft.tasks.length} task(s) go to Building`,
    };
  }

  private async reject(ref: string, body: Body<"reject">): Promise<VerbResult> {
    const { subject } = this.subject(ref, "item");
    if (subject.hold?.kind !== "approval" || subject.hold.reason !== planApprovalReason) {
      return { message: `${ref} is not waiting for a plan approval` };
    }
    await this.clearHold("item", ref, body.reason);
    await this.note(ref, ref, "rejection", body.reason);
    if ((this.store.state.items[ref]?.rejections ?? 0) >= 2) {
      await this.store.append({
        type: "hold.set",
        item: ref,
        data: {
          target: "item",
          hold: "attention",
          by: "kozod",
          reason: "the plan was rejected twice; kozo retry drafts it again from Triage",
        },
      });
      return { message: `rejected the plan of ${ref} a second time; it waits for your attention` };
    }
    return {
      message: `rejected the plan of ${ref}; the plan agent drafts it again with your reason`,
    };
  }

  private async say(ref: string, kind: "item" | "task", body: Body<"say">): Promise<VerbResult> {
    const { subject, item, task } = this.subject(ref, kind);
    if (body.ask) {
      if (!this.runner) throw new CommandError(409, "kozod answers questions only while it runs");
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const budget = this.definition.current.factory.budget.daily_usd;
      if (costSince(this.store.db, midnight) >= budget)
        throw new CommandError(409, `the daily budget of ${budget} USD is spent; ask tomorrow`);
      return { message: await this.runner.ask(item, task, body.text) };
    }
    if (subject.hold?.kind === "question") {
      await this.note(item, ref, "answer", body.text);
      await this.clearHold(kind, ref, body.text);
      return { message: `answered ${ref}; work resumes` };
    }
    // An instruction also belongs to the runs after the current one, should it stop first.
    await this.note(item, ref, "instruction", body.text);
    const running = this.runner?.sessionFor(ref) ?? null;
    if (running) {
      await enqueue(runFiles(this.home, running).queue, body.text);
      return { message: `sent to ${running}, which reads it at its next turn` };
    }
    return { message: `noted for the next run of ${ref}` };
  }

  private async actOnRun(ref: string, verb: Verb, body: unknown): Promise<VerbResult> {
    const run = this.store.state.runs[ref];
    if (!run) throw new CommandError(404, `${ref} does not exist`);
    const owner = run.task ?? run.item;
    const kind = run.task ? "task" : "item";
    // Text for a run belongs to its task or item, and reaches the run while it is running.
    if (verb === "say") return await this.say(owner, kind, body as Body<"say">);
    if (verb === "pause") return await this.pause(owner, kind, body as Body<"pause">);
    return await this.resume(owner, kind);
  }

  private async pause(
    ref: string,
    kind: "item" | "task",
    body: Body<"pause">,
  ): Promise<VerbResult> {
    const { subject } = this.subject(ref, kind);
    if (subject.hold?.kind === "paused") return { message: `${ref} is already paused` };
    if (isClosed(subject.stage)) return { message: `${ref} is ${subject.stage}` };
    if (subject.hold)
      throw new CommandError(
        409,
        `${ref} is held by ${subject.hold.kind}; it does not move until that clears`,
      );
    await this.setHold(kind, ref, "paused", "kozo pause");
    const running = this.runner?.sessionFor(ref) ?? null;
    if (body.now && running) this.runner?.stopSession(running);
    return {
      message:
        body.now && running
          ? `paused ${ref} and stopped ${running}`
          : `paused ${ref}; it stops at the next node`,
    };
  }

  private async resume(ref: string, kind: "item" | "task"): Promise<VerbResult> {
    const { subject } = this.subject(ref, kind);
    if (subject.hold?.kind !== "paused") return { message: `${ref} is not paused` };
    await this.clearHold(kind, ref);
    return { message: `resumed ${ref}` };
  }

  private async retry(
    ref: string,
    kind: "item" | "task",
    body: Body<"retry">,
  ): Promise<VerbResult> {
    const { subject, item } = this.subject(ref, kind);
    if (isClosed(subject.stage)) throw new CommandError(409, `${ref} is ${subject.stage}`);
    if (body.text) await this.note(item, ref, "instruction", body.text);
    if (subject.hold && subject.hold.kind !== "attention" && subject.hold.kind !== "question") {
      throw new CommandError(409, `${ref} is held by ${subject.hold.kind}`);
    }
    await this.clearHold(kind, ref, body.text);
    if (kind === "item" && subject.stage === "planning")
      await this.move("item", ref, "triage", "kozo retry");
    return {
      message:
        kind === "task"
          ? `retrying ${ref} from its last checkpoint`
          : `retrying ${ref} from its plan`,
    };
  }

  /**
   * Hands a task to the human: stops its session and holds it for the take, in place of a
   * question or attention the human takes it to settle. Its worktree must exist, since that is
   * where the human works.
   */
  private async take(ref: string): Promise<VerbResult> {
    const { subject } = this.subject(ref, "task");
    const task = this.store.state.tasks[ref];
    const item = task ? this.store.state.items[task.item] : undefined;
    if (!task || !item) throw new CommandError(404, `${ref} does not exist`);
    if (isClosed(subject.stage)) throw new CommandError(409, `${ref} is ${subject.stage}`);
    if (subject.hold?.kind === "paused" && subject.hold.reason === takenReason)
      return { message: `${ref} is already yours` };
    if (subject.hold && subject.hold.kind !== "attention" && subject.hold.kind !== "question")
      throw new CommandError(409, `${ref} is held by ${subject.hold.kind}`);
    const worktree = worktreePath(this.home, item.repository, ref);
    if (
      !(await stat(worktree).then(
        (entry) => entry.isDirectory(),
        () => false,
      ))
    )
      throw new CommandError(409, `${ref} has no worktree yet; its first run makes one`);
    const running = this.runner?.sessionFor(ref);
    if (running) this.runner?.stopSession(running);
    await this.clearHold("task", ref, "kozo take");
    await this.setHold("task", ref, "paused", takenReason);
    const branch = taskBranch(this.store.factoryId, ref);
    return {
      message: `${ref} is yours: commit in ${worktree} on ${branch}, then run kozo return ${ref} <what you changed and checked>`,
    };
  }

  /**
   * Gives a taken task back once the human's work is committed: the task goes to Building, and
   * its next run starts at verify-deterministic, so every check after implement sees the commits.
   */
  private async giveBack(ref: string, body: Body<"return">): Promise<VerbResult> {
    const { subject, item } = this.subject(ref, "task");
    if (subject.hold?.kind !== "paused" || subject.hold.reason !== takenReason)
      throw new CommandError(409, `${ref} is not taken; kozo take hands it to you`);
    const repository = this.store.state.items[item]?.repository ?? "";
    const worktree = worktreePath(this.home, repository, ref);
    const dirty = (await git(worktree, ["status", "--porcelain"])).trim();
    if (dirty !== "")
      throw new CommandError(409, `${worktree} has uncommitted changes; commit them first`);
    await this.note(item, ref, "instruction", body.text);
    await this.store.append({ type: "task.returned", item, task: ref, data: {} });
    await this.clearHold("task", ref, body.text);
    await this.move("task", ref, "building", "kozo return");
    return { message: `gave ${ref} back; its checks run on your commits` };
  }

  private async close(
    ref: string,
    kind: "item" | "task",
    body: Body<"close">,
  ): Promise<VerbResult> {
    const { subject } = this.subject(ref, kind);
    if (isClosed(subject.stage)) return { message: `${ref} is already ${subject.stage}` };
    const done = "done" in body;
    await this.closeWork(
      ref,
      kind,
      done ? "complete" : "cancelled",
      done ? "kozo close --done" : `kozo close --cancel: ${body.cancel}`,
    );
    return {
      message: "done" in body ? `closed ${ref} as done` : `cancelled ${ref}: ${body.cancel}`,
    };
  }

  /**
   * Moves an item and its open tasks, or one task, to Complete or Cancelled for a human: stops
   * their sessions, clears their holds and removes a cancelled task's branch. The item follows a
   * task once every task of it is closed.
   */
  async closeWork(
    ref: string,
    kind: "item" | "task",
    to: "complete" | "cancelled",
    reason: string,
  ): Promise<void> {
    const { item } = this.subject(ref, kind);
    const tasks = kind === "item" ? (this.store.state.items[ref]?.tasks ?? []) : [ref];
    for (const task of tasks) {
      const state = this.store.state.tasks[task];
      if (!state || isClosed(state.stage)) continue;
      const running = this.runner?.sessionFor(task);
      if (running) this.runner?.stopSession(running);
      await this.clearHold("task", task);
      await this.move("task", task, to, reason);
      if (to === "cancelled") await this.runner?.release(task, true);
    }
    if (
      kind === "item" ||
      tasks.every((task) => isClosed(this.store.state.tasks[task]?.stage ?? "cancelled"))
    ) {
      const owner = this.store.state.items[item];
      if (owner && !isClosed(owner.stage)) {
        await this.clearHold("item", item);
        await this.move("item", item, to, reason);
      }
    }
  }

  async pauseFactory(): Promise<VerbResult> {
    if (this.store.state.paused) return { message: "the factory is already paused" };
    await this.store.append({
      type: "factory.changed",
      data: { paused: true, reason: "kozo pause" },
    });
    return { message: "paused the factory; nothing new starts" };
  }

  async resumeFactory(): Promise<VerbResult> {
    if (!this.store.state.paused) return { message: "the factory is not paused" };
    await this.store.append({
      type: "factory.changed",
      data: { paused: false, reason: "kozo resume" },
    });
    return { message: "resumed the factory" };
  }
}
