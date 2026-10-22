import {
  autonomyLevel,
  type GitHub,
  type GitHubIssue,
  type HoldKind,
  itemStage,
  parseReference,
  type Repository,
  stageSchema,
} from "@kozo/core";
import type { ControlPlane } from "./control-plane.ts";
import type { DefinitionInUse } from "./definition.ts";
import type { EventStore } from "./event-store.ts";
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

// GitHub ends the login of every app's bot with [bot]; a bot's Issue never starts work.
const isBot = (login: string) => login.endsWith("[bot]");

/**
 * GitHub mode's intake and mirror: takes new Issues as items, approves the starts that a human
 * labelled `kozo:accept`, and keeps each Issue's kozo labels in step with its item.
 */
export class GitHubSync {
  /** The repositories whose labels exist, created once per start. */
  private readonly labelled = new Set<string>();

  constructor(
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
        issue.labels.includes(acceptLabel)
      ) {
        const reference = parseReference(ref);
        if (reference) await this.control.act(ref, reference, "approve", {});
      }
    }
    await this.createLabels(github);
    for (const issue of issues) await this.mirror(github, `${name}#${issue.number}`, issue);
  }

  /**
   * Takes an Issue as an item. Only a writer's Issue opened after the repository was registered
   * is trusted; any other waits for a start approval whatever the autonomy level.
   */
  private async take(path: string, github: string, ref: string, issue: GitHubIssue) {
    const charter = await readCharter(path);
    if (!charter.ok) {
      this.report(`kozod: ${ref} is not taken: ${charter.reason}`);
      return;
    }
    const registered = this.store.state.repositories[github]?.registeredAt ?? "";
    const permission = await this.github.permission(github, issue.author);
    const trusted =
      ["admin", "maintain", "write"].includes(permission) && issue.createdAt >= registered;
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
