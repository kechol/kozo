import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type AgentName, isRunOver, type KozoHome, runFiles, sha256 } from "@kozo/core";
import { type Definition, modelFor } from "@kozo/verify";
import type { WorkerSpec } from "@kozo/worker";
import pkg from "../package.json" with { type: "json" };
import type { EventStore } from "./event-store.ts";
import { readItemFile, requestText } from "./item-file.ts";
import type { LaunchedSession, Launcher } from "./launcher.ts";
import { type Envelope, pumpSession, type SessionResult } from "./session-pump.ts";

/**
 * The runs kozod starts and ends, the sessions and blueprint work running now, which a human may
 * stop at once, and what that work holds back from the daily budget.
 */
export class RunRecords {
  /** The sessions running now, by run, so that a human can stop one at once. */
  private readonly sessions = new Map<string, LaunchedSession>();
  /** The blueprint work running now, by task, so that a human can stop its commands too. */
  private readonly building = new Map<string, { stop: AbortController; ended: Promise<void> }>();
  private apiFailures = 0;
  // What the work running now may still spend, one session's limit each; see reserve.
  private readonly reservations = new Set<{ usd: number }>();
  /** Set once kozod shuts down: no session keeps running, and attempts stop at their next node. */
  private shutDown = false;

  constructor(
    private readonly home: KozoHome,
    private readonly store: EventStore,
    private readonly launcher: Launcher,
  ) {}

  /** Whether kozod is shutting down. */
  get stopping(): boolean {
    return this.shutDown;
  }

  /**
   * Runs `work` as the blueprint work of `taskRef`, whose `signal` aborts when a human stops the
   * task's work, and which stopWork waits for.
   */
  async track(taskRef: string, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const stop = new AbortController();
    const { promise: ended, resolve } = Promise.withResolvers<void>();
    this.building.set(taskRef, { stop, ended });
    try {
      await work(stop.signal);
    } finally {
      this.building.delete(taskRef);
      resolve();
    }
  }

  /** The amount the work running now holds back from the daily budget. */
  get reservedUsd(): number {
    let total = 0;
    for (const { usd } of this.reservations) total += usd;
    return total;
  }

  /**
   * Holds back `usd` of the daily budget, one session's limit, for work that runs its sessions
   * one at a time, until the returned function lets it go.
   */
  reserve(usd: number): () => void {
    const reservation = { usd };
    this.reservations.add(reservation);
    return () => this.reservations.delete(reservation);
  }

  /**
   * Three sessions in a row that fail on the API, rather than on a limit, without an answer or
   * by crashing, pause the factory: retrying into an outage only spends the budget.
   */
  private async countApiFailure(result: SessionResult) {
    const reason = result.status === "failed" ? result.outcome.reason : "";
    const api = result.status === "failed" && result.outcome.kind === "api";
    if (api) this.apiFailures += 1;
    else if (result.status === "answered") this.apiFailures = 0;
    if (this.apiFailures >= 3 && !this.store.state.paused) {
      await this.store.append({
        type: "factory.changed",
        data: {
          paused: true,
          reason: `three sessions in a row failed on the API; the last: ${reason}`.slice(0, 500),
        },
      });
      this.apiFailures = 0;
    }
  }

  /** Stops every session for shutting down; each attempt stops where it can resume. */
  stop() {
    this.shutDown = true;
    for (const session of this.sessions.values()) session.stop();
  }

  /** Stops a run's session now; the run ends as stopped. Returns whether one was running. */
  private stopSession(run: string): boolean {
    const session = this.sessions.get(run);
    session?.stop();
    return session !== undefined;
  }

  /**
   * Stops the work running for a task or an item now: its session, and the command a blueprint
   * run of the task is running, after which the run ends as stopped at its node. Resolves once
   * that run has ended, with the run stopped, if any.
   */
  async stopWork(ref: string): Promise<string | null> {
    const session = this.sessionFor(ref);
    if (session) this.stopSession(session);
    const work = this.building.get(ref);
    if (!work) return session;
    const run = Object.values(this.store.state.runs).find(
      (info) => info.task === ref && !isRunOver(info.state),
    );
    work.stop.abort();
    await work.ended;
    return session ?? run?.ref ?? null;
  }

  /** The run whose session is running for a task or an item, if any. */
  sessionFor(ref: string): string | null {
    for (const run of this.sessions.keys()) {
      const info = this.store.state.runs[run];
      if (info && (info.task === ref || (info.task === null && info.item === ref))) return run;
    }
    return null;
  }

  async startRun(
    envelope: Omit<Envelope, "run_id">,
    agent: AgentName,
    charterCommit: string,
    definition: Definition,
  ) {
    const run = this.store.nextRun();
    const request = requestText(await readItemFile(this.home, envelope.item));
    await this.store.append({
      type: "run.started",
      run_id: run,
      item: envelope.item,
      task: envelope.task,
      parent_run: envelope.parent_run ?? null,
      data: {
        agent,
        model: modelFor(definition, agent),
        mode: definition.factory.mode,
        charter_commit: charterCommit,
        factory_commit: definition.commit,
        kozo_version: pkg.version,
        runtime: definition.factory.runtime,
        request_sha: sha256(request),
      },
    });
    return run;
  }

  /** Ends a run; `costUsd` is what a judge session spent in it, the run's own cost event. */
  async endRun(
    run: string,
    to: "succeeded" | "failed" | "stopped" | "lost",
    reason?: string,
    costUsd = 0,
  ) {
    const current = this.store.state.runs[run];
    if (!current || current.state === to) return;
    await this.store.append({
      type: "run.changed",
      run_id: run,
      item: current.item,
      task: current.task,
      parent_run: current.parent,
      data: { from: current.state, to, ...(reason ? { reason } : {}) },
      ...(costUsd > 0 ? { cost: { usd: costUsd, in: 0, out: 0, cache_read: 0 } } : {}),
    });
  }

  /**
   * Ends as failed the runs of a task, or of an item's triage, that a throw left open, so that
   * the scheduler starts the work again once its hold clears.
   */
  async failOpenRuns(ref: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    for (const run of Object.values(this.store.state.runs)) {
      if (run.task !== ref && !(run.task === null && run.item === ref)) continue;
      if (!isRunOver(run.state))
        await this.endRun(run.ref, "failed", `kozod could not finish it: ${message}`.slice(0, 500));
    }
  }

  private async writeSpec(spec: WorkerSpec): Promise<string> {
    const files = runFiles(this.home, spec.run);
    await mkdir(files.dir, { recursive: true });
    await Bun.write(files.brief, spec.prompt);
    const path = join(files.dir, "worker.json");
    await Bun.write(path, JSON.stringify(spec, null, 2));
    return path;
  }

  async session(spec: WorkerSpec, envelope: Envelope, maxMinutes: number): Promise<SessionResult> {
    const specPath = await this.writeSpec(spec);
    const session = this.launcher.launch(spec, specPath);
    this.sessions.set(spec.run, session);
    if (this.shutDown) session.stop();
    let result: SessionResult;
    try {
      result = await pumpSession(this.store, session, envelope, maxMinutes);
    } finally {
      this.sessions.delete(spec.run);
    }
    await this.countApiFailure(result);
    return result;
  }
}
