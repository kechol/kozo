import { join } from "node:path";
import {
  autonomyLevel,
  type GitHub,
  type GitHubIssue,
  type GitHubPermission,
  type HoldKind,
  itemStage,
  type KozoHome,
  parseReference,
  type Repository,
  stageSchema,
} from "@kozo/core";
import { defaultBranch } from "@kozo/verify";
import type { ControlPlane } from "./control-plane.ts";
import type { DefinitionInUse } from "./definition.ts";
import type { EventStore } from "./event-store.ts";
import { pushConfirmed, upsertComment } from "./github.ts";
import { quiet, statusBody } from "./github-report.ts";
import { readCharter } from "./repository.ts";

/** The label a human adds to an Issue to approve its start. */
export const acceptLabel = "kozo:accept";

const stageLabels = stageSchema.options.map((stage) => `kozo:${stage}`);
const needsLabels: Partial<Record<HoldKind, string>> = {
  approval: "kozo:needs-approval",
  question: "kozo:needs-question",
  attention: "kozo:needs-attention",
};
// The labels kozod sets and clears; any other label, kozo:accept included, is the humans'.
const managed = new Set([...stageLabels, ...Object.values(needsLabels)]);

const labelSpecs = [
  ...stageLabels.map((name) => ({ name, color: "c5def5", description: "The stage kozo shows" })),
  ...Object.values(needsLabels).map((name) => ({
    name,
    color: "fbca04",
    description: "kozo waits for a human",
  })),
  { name: acceptLabel, color: "0e8a16", description: "Approve kozo's start on this Issue" },
];

const writers: readonly GitHubPermission[] = ["admin", "maintain", "write"];

// GitHub ends the login of every app's bot with [bot]; a bot's Issue never starts work.
const isBot = (login: string) => login.endsWith("[bot]");

/**
 * GitHub mode's intake and mirror: takes new Issues as items, approves the starts that a human
 * labelled `kozo:accept`, and keeps each Issue's kozo labels in step with its item.
 */
export class GitHubSync {
  /** The repositories whose labels exist, created once per start. */
  private readonly labelled = new Set<string>();
  /** The status comment last written for each item, so that an unchanged one is not read again. */
  private readonly statuses = new Map<string, string>();
  /** The login gh acts as, which kozod's own comments carry. */
  private self: string | null = null;

  constructor(
    private readonly home: KozoHome,
    private readonly store: EventStore,
    private readonly definition: DefinitionInUse,
    private readonly control: ControlPlane,
    private readonly github: GitHub,
    private readonly report: (line: string) => void = () => {},
  ) {}

  private repositories(): (Repository & { github: string })[] {
    return this.definition.current.factory.repositories.filter(
      (repository): repository is Repository & { github: string } =>
        repository.github !== undefined,
    );
  }

  /** Records each GitHub repository the first time a definition in use names it. */
  async register(): Promise<void> {
    for (const { path, github } of this.repositories()) {
      if (this.store.state.repositories[github]) continue;
      await this.store.append({ type: "factory.repository", data: { path, github } });
    }
  }

  /** One pass over every GitHub repository; a repository that fails is reported and skipped. */
  async poll(): Promise<void> {
    await this.register();
    for (const repository of this.repositories()) {
      try {
        await this.pollRepository(repository);
      } catch (error) {
        this.report(`kozod: reading ${repository.github} failed: ${(error as Error).message}`);
      }
    }
  }

  private async pollRepository({ path, github }: Repository & { github: string }) {
    await this.github.fetch(path);
    const name = github.slice(github.indexOf("/") + 1);
    const issues = await this.github.issues(github);
    for (const issue of issues) {
      const ref = `${name}#${issue.number}`;
      const item = this.store.state.items[ref];
      if (!item) {
        if (!isBot(issue.author)) await this.take(path, github, ref, issue);
      } else if (
        item.hold?.kind === "approval" &&
        item.hold.reason === "start approval" &&
        issue.labels.includes(acceptLabel) &&
        (await this.byWriter(github, issue.number))
      ) {
        const reference = parseReference(ref);
        if (reference) await this.control.act(ref, reference, "approve", {});
      }
    }
    await this.createLabels(github);
    for (const issue of issues) {
      const ref = `${name}#${issue.number}`;
      await this.mirror(github, ref, issue);
      await this.publish(path, github, ref, issue.number);
    }
  }

  /**
   * Brings what an item shows on GitHub up to date: its status comment, a comment for each
   * question, and for each task handed off, its branch, its pull request and a handoff comment.
   */
  private async publish(path: string, github: string, ref: string, issue: number) {
    const item = this.store.state.items[ref];
    if (!item) return;
    this.self ??= await this.github.login();
    const self = this.self;
    const status = statusBody(this.store.state, item, this.pulls(ref), this.costOf(ref));
    if (this.statuses.get(ref) !== status) {
      await upsertComment(this.github, self, github, issue, `kozo:status:${ref}`, status);
      this.statuses.set(ref, status);
    }
    for (const subject of [item, ...item.tasks.map((task) => this.store.state.tasks[task])]) {
      if (subject?.hold?.kind !== "question") continue;
      const marker = `kozo:question:${subject.ref}:${subject.hold.since}`;
      if (this.written(ref, null, "comment").includes(marker)) continue;
      await upsertComment(
        this.github,
        self,
        github,
        issue,
        marker,
        `**Question about ${subject.ref}:** ${quiet(subject.hold.reason)}

Answer here or with \`kozo say ${subject.ref} <answer>\`.`,
      );
      await this.wrote(ref, null, "comment", marker);
    }
    for (const task of item.tasks) await this.handOff(path, github, issue, ref, task);
  }

  /**
   * Publishes a task's last verified head once: pushes its branch, opens its pull request or
   * rewrites the open one's body with the handoff report, and says so on the Issue.
   */
  private async handOff(path: string, github: string, issue: number, item: string, task: string) {
    if (this.store.state.tasks[task]?.stage !== "handoff") return;
    const ready = this.store.db
      .query<{ line: string }, [string]>(
        "select line from events where task = ? and type = 'handoff.ready' order by id desc limit 1",
      )
      .get(task);
    if (!ready) return;
    const { branch, head, report } = (
      JSON.parse(ready.line) as { data: { branch: string; head: string; report: string } }
    ).data;
    if (this.written(item, task, "handoff").includes(head)) return;
    await pushConfirmed(this.github, path, branch, head);
    await this.wrote(item, task, "push", `${branch} ${head}`);
    const text = await Bun.file(join(this.home.root, report))
      .text()
      .catch(() => "");
    const body = `${quiet(text)}

Part of #${issue}`;
    const open = (await this.github.pullsFor(github, branch)).find((pull) => pull.state === "open");
    const goal = this.store.state.tasks[task]?.goal ?? task;
    const pull =
      open ??
      (await this.github.createPull(github, {
        head: branch,
        base: await defaultBranch(path),
        title: quiet(goal).slice(0, 200),
        body,
      }));
    if (open) await this.github.updatePull(github, open.number, body);
    await this.wrote(item, task, "pull", pull.url);
    await upsertComment(
      this.github,
      this.self ?? (await this.github.login()),
      github,
      issue,
      `kozo:handoff:${task}:${head.slice(0, 12)}`,
      `${task} is ready for you to review and merge: ${pull.url}`,
    );
    await this.wrote(item, task, "handoff", head);
  }

  /** The subjects of kozod's GitHub writes of `action` for an item or one of its tasks. */
  private written(item: string, task: string | null, action: string): string[] {
    return this.store.db
      .query<{ subject: string }, [string, string | null, string | null, string]>(
        "select json_extract(line, '$.data.subject') as subject from events where type = 'external.write' and item = ? and (task = ? or ? is null) and json_extract(line, '$.data.action') = ?",
      )
      .all(item, task, task, action)
      .map((row) => row.subject);
  }

  private async wrote(item: string, task: string | null, action: string, subject: string) {
    await this.store.append({
      type: "external.write",
      item,
      task,
      data: { target: "github", action, subject },
    });
  }

  /** Each task's pull request, as the last one kozod opened or updated for it. */
  private pulls(item: string): Map<string, string> {
    const rows = this.store.db
      .query<{ task: string; subject: string }, [string]>(
        "select task, json_extract(line, '$.data.subject') as subject from events where type = 'external.write' and item = ? and json_extract(line, '$.data.action') = 'pull' order by id",
      )
      .all(item);
    return new Map(rows.map((row) => [row.task, row.subject]));
  }

  private costOf(item: string): number {
    return (
      this.store.db
        .query<{ usd: number }, [string]>(
          "select coalesce(sum(json_extract(line, '$.cost.usd')), 0) as usd from events where item = ?",
        )
        .get(item)?.usd ?? 0
    );
  }

  /** Whether whoever added `kozo:accept` last may write: triage permission can add labels too. */
  private async byWriter(github: string, issue: number): Promise<boolean> {
    const login = await this.github.labelledBy(github, issue, acceptLabel);
    return login !== null && writers.includes(await this.github.permission(github, login));
  }

  /**
   * Takes an Issue as an item. Only a writer's Issue opened after the repository was registered
   * is trusted; any other waits for a start approval whatever the autonomy level.
   */
  private async take(path: string, github: string, ref: string, issue: GitHubIssue) {
    const charter = await readCharter(path, "github");
    if (!charter.ok) {
      this.report(`kozod: ${ref} is not taken: ${charter.reason}`);
      return;
    }
    const registered = this.store.state.repositories[github]?.registeredAt ?? "";
    const permission = await this.github.permission(github, issue.author);
    const trusted = writers.includes(permission) && issue.createdAt >= registered;
    await this.control.admit(
      ref,
      { repository: path, class: null, title: issue.title.trim(), body: issue.body },
      "github",
      !trusted || autonomyLevel(charter.charter, null) === "L1",
    );
  }

  private async createLabels(github: string) {
    if (this.labelled.has(github)) return;
    for (const label of labelSpecs) await this.github.createLabel(github, label);
    this.labelled.add(github);
  }

  /** Sets the Issue's kozo labels to its item's stage and the holds that wait on a human. */
  private async mirror(github: string, ref: string, issue: GitHubIssue) {
    const state = this.store.state;
    const item = state.items[ref];
    if (!item) return;
    const holds = [item.hold, ...item.tasks.map((task) => state.tasks[task]?.hold)];
    const wanted = new Set([`kozo:${itemStage(state, item)}`]);
    for (const hold of holds) {
      const label = hold ? needsLabels[hold.kind] : undefined;
      if (label) wanted.add(label);
    }
    const present = issue.labels.filter((label) => managed.has(label));
    const add = [...wanted].filter((label) => !present.includes(label));
    const remove = present.filter((label) => !wanted.has(label));
    if (add.length > 0 || remove.length > 0)
      await this.github.label(github, issue.number, { add, remove });
  }
}
