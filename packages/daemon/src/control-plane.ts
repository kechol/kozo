import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type AddItem,
  autonomyLevel,
  type Factory,
  isClosed,
  type KozoHome,
  type NoteKind,
  type Reference,
  runFiles,
  type Stage,
  type Verb,
  type verbBodySchemas,
} from "@kozo/core";
import type { z } from "zod";
import { CommandError, type VerbResult } from "./api.ts";
import type { EventStore } from "./event-store.ts";
import { enqueue } from "./instructions.ts";
import { itemPath, writeItemFile } from "./item-file.ts";
import { readCharter } from "./repository.ts";
import type { Runner } from "./runner.ts";

type Body<V extends Verb> = z.infer<(typeof verbBodySchemas)[V]>;

const normalTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The control plane: every decision about items, tasks and runs that can be made without a
 * model, each recorded as events through the store.
 */
export class ControlPlane {
  constructor(
    readonly home: KozoHome,
    readonly store: EventStore,
    readonly factory: Factory,
    readonly runner: Runner | null = null,
  ) {}

  private repositoryFor(requested: string | undefined): string {
    const registered = this.factory.repositories.map((repository) => repository.path);
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
    const charter = await readCharter(repository);
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
    await writeItemFile(this.home, ref, {
      repository,
      class: body.class ?? null,
      title: body.title.trim(),
      body: body.body ?? "",
    });
    try {
      await this.store.append({
        type: "item.created",
        item: ref,
        data: { repository, title: body.title.trim(), source: "local" },
      });
    } catch (error) {
      await rm(itemPath(this.home, ref), { force: true });
      throw error;
    }
    if (autonomyLevel(charter.charter, body.class ?? null) === "L1") {
      await this.store.append({
        type: "hold.set",
        item: ref,
        data: { target: "item", hold: "approval", by: "kozod", reason: "start approval" },
      });
      return {
        ref,
        message: `added ${ref}; it waits for your start approval`,
        awaitingHuman: true,
      };
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
    return { ref, message: `added ${ref}; it goes to Triage` };
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
      case "return":
        throw new CommandError(501, `${verb} arrives with T-057`);
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
    const start = subject.hold.reason === "start approval";
    await this.clearHold("item", ref, body.text);
    if (body.text) await this.note(ref, ref, "approval", body.text);
    if (start) {
      await this.move("item", ref, "triage", "kozo approve");
      return { message: `approved the start of ${ref}; it goes to Triage` };
    }
    if (!item.draft) throw new CommandError(409, `${ref} has no plan to approve`);
    await this.store.append({
      type: "plan.accepted",
      item: ref,
      data: { plan: item.draft, by: "human" },
    });
    return {
      message: `approved the plan of ${ref}; ${item.draft.tasks.length} task(s) go to Building`,
    };
  }

  private async reject(ref: string, body: Body<"reject">): Promise<VerbResult> {
    const { subject } = this.subject(ref, "item");
    if (subject.hold?.kind !== "approval" || subject.hold.reason !== "plan approval") {
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
    const { subject, item } = this.subject(ref, kind);
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

  private async close(
    ref: string,
    kind: "item" | "task",
    body: Body<"close">,
  ): Promise<VerbResult> {
    const { subject, item } = this.subject(ref, kind);
    if (isClosed(subject.stage)) return { message: `${ref} is already ${subject.stage}` };
    const done = "done" in body;
    const [to, reason] = done
      ? (["complete", "kozo close --done"] as const)
      : (["cancelled", `kozo close --cancel: ${body.cancel}`] as const);
    const tasks = kind === "item" ? (this.store.state.items[ref]?.tasks ?? []) : [ref];
    for (const task of tasks) {
      const state = this.store.state.tasks[task];
      if (!state || isClosed(state.stage)) continue;
      const running = this.runner?.sessionFor(task);
      if (running) this.runner?.stopSession(running);
      await this.clearHold("task", task);
      await this.move("task", task, to, reason);
      if (!done) await this.runner?.release(task, true);
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
    return {
      message: "done" in body ? `closed ${ref} as done` : `cancelled ${ref}: ${body.cancel}`,
    };
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
