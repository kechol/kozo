import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  afterReview,
  type Brief,
  type Message,
  message,
  proseLanguage,
  render,
  renderBrief,
  repositoryLocale,
  runFiles,
  runReportJsonSchema,
  runReportSchema,
  type TaskState,
  wrapRequest,
} from "@kozo/core";
import {
  diffGuardLine,
  git,
  globMatcher,
  modelFor,
  proveLine,
  runCommand,
  runDiffGuard,
  runningProcesses,
  runProve,
  runReview,
  runVerify,
  stopProcessesIn,
  verifyInstructions,
  writeReviewVerdict,
  writeVerifyVerdict,
} from "@kozo/verify";
import { commitIdentity, taskSandbox } from "@kozo/worker";
import { checkNotes } from "./instructions.ts";
import { handoffReportPath, readItemFile, requestText } from "./item-file.ts";
import { firstCodeChange, firstNonTestChange, layersFor, onlyDependencyFiles } from "./risk.ts";
import { type BlueprintRun, describe, type Node, type RunEnd, tail } from "./task-run.ts";
import { externalWrite } from "./transitions.ts";
import { takePorts } from "./worktree-ports.ts";
import { claimTask, servicesCheckout } from "./worktrees.ts";

/** What the run's agents are told about the language of their prose, in its repository's locale. */
const languageOf = (run: BlueprintRun) =>
  proseLanguage(repositoryLocale(run.definition.factory, run.repository.path));

/** Why a judge session failed, its own message when it has one. */
const errorOf = (result: { message: string; reason?: Message }) =>
  result.reason ?? message("text", { text: result.message });

/**
 * One node of a blueprint run: it ends the run with how it ended, or returns nothing for the
 * run to go on to the next node. `current` is the task as the node starts.
 */
type NodeStep = (run: BlueprintRun, current: TaskState) => Promise<RunEnd | undefined>;

const claim: NodeStep = async (run, current) => {
  const { runner } = run;
  await run.enter("claim", "D");
  const claimed = await claimTask(runner.home, run.repository.path, run.task.ref, {
    base: run.repository.tip,
    factory: runner.store.factoryId,
    // An explorer's run of the task is no attempt at it.
    resume:
      current.runs.filter((ref) => runner.store.state.runs[ref]?.agent === "implement").length > 1,
  });
  if (!claimed.claimed) {
    return await run.halt("claim", {
      hold: "attention",
      reason: claimed.reason,
      end: "failed",
      why: claimed.reason,
    });
  }
  if (claimed.created) {
    await externalWrite(
      runner.store,
      { item: run.item.ref, task: run.task.ref },
      "local",
      "branch",
      run.branch,
      run.run,
    );
  }
  await run.exit("claim", true);
};

/**
 * Runs the services of a worktree. They run outside the command sandbox, so never on the
 * worktree, which may hold the task's changes to the files they read, but in a checkout of the
 * trusted base kept beside it, with the worktree's environment, so that every run addresses the
 * same containers, ports and directory. Services commands start what is not running and leave
 * running services alone.
 */
export async function startServices(run: BlueprintRun): Promise<RunEnd | undefined> {
  const { runner, worktree, constraints, repository } = run;
  if (constraints.services.length === 0) return;
  const checkout = await servicesCheckout(
    runner.home,
    repository.path,
    worktree,
    runner.deps.trustedBase ?? repository.tip,
  );
  const env = await run.env();
  const log = (text: string) => void run.log(text);
  for (const command of constraints.services) {
    const code = await runCommand(command, checkout, log, env, undefined, run.limit);
    if (code !== 0) {
      return await run.halt("prepare", {
        hold: "attention",
        reason: message("hold.prepare-failed", { command, code }),
        summary: message("node.exited", { command, code }),
        end: "failed",
        why: message("run.prepare-failed"),
      });
    }
  }
}

const prepare: NodeStep = async (run) => {
  const { runner, worktree, constraints } = run;
  await run.enter("prepare", "D");
  // A worktree is prepared once; the marker sits beside it, not in it, to keep it clean.
  const marker = `${worktree}.prepared`;
  if (await Bun.file(marker).exists()) {
    // The services may have stopped since, with the machine or by hand, so they start again.
    const stopped = await startServices(run);
    if (stopped) return stopped;
    await run.exit("prepare", true, message("node.prepared"));
    return;
  }
  if (constraints.ports > 0) await takePorts(worktree, constraints.ports);
  const stopped = await startServices(run);
  if (stopped) return stopped;
  const env = await run.env();
  const log = (text: string) => void run.log(text);
  for (const command of constraints.prepare) {
    const code = await runner.prepare(command, worktree, log, env, run.limit);
    if (code !== 0) {
      return await run.halt("prepare", {
        hold: "attention",
        reason: message("hold.prepare-failed", { command, code }),
        summary: message("node.exited", { command, code }),
        end: "failed",
        why: message("run.prepare-failed"),
      });
    }
  }
  await Bun.write(marker, `${new Date().toISOString()}\n`);
  await run.exit("prepare", true);
};

const brief: NodeStep = async (run, current) => {
  const { runner, item, charter, blueprint } = run;
  await run.enter("brief", "D");
  const inScope = run.listed.filter(globMatcher(current.scope)).slice(0, 40);
  const file = await readItemFile(runner.home, item.ref);
  const decisions = current.runs
    .map((ref) => runFiles(runner.home, ref).decisions)
    .filter((path) => path !== run.files.decisions);
  const earlier: string[] = [];
  for (const path of decisions) {
    const text = await Bun.file(path)
      .text()
      .catch(() => "");
    earlier.push(
      ...text
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(/^- /, "")),
    );
  }
  const written: Brief = {
    version: 1,
    goal: current.goal,
    done_when: current.done_when as [string, ...string[]],
    item: {
      goal: item.title,
      task: run.task.ref,
      position: item.tasks.indexOf(run.task.ref) + 1,
      of: item.tasks.length,
      prior_diffs: current.depends_on.map((ref) => {
        const dependency = runner.store.state.tasks[ref];
        const commit = dependency?.merged?.commit;
        const merged = commit ? `, merged in ${commit.slice(0, 12)}` : "";
        return `${ref} ${dependency?.goal ?? ""}${merged}`;
      }),
    },
    blueprint: { class: run.plan.class, nodes: [...blueprint.nodes] },
    scope: current.scope as [string, ...string[]],
    do_not_act: [
      "Changes outside SCOPE, even ones worth making; list them in the run report instead",
      "Changes to existing tests",
    ],
    context: {
      files: inScope,
      decisions: earlier.slice(-20),
      rules: [
        "Read AGENTS.md before you change anything.",
        ...[languageOf(run)].filter((rule) => rule !== null),
        ...(blueprint.reproduce
          ? []
          : [
              "This blueprint starts from no failing test: make the change, keep every existing test passing and run the gates. A test you add must pass without your change too, since it pins behaviour the change keeps.",
            ]),
        ...(current.characterize
          ? [
              "This task characterizes: add tests that pin the behaviour the code has now, which pass before and after the item's change, and change no file but tests.",
            ]
          : []),
        ...(current.codemod !== null
          ? [
              `Before your session kozod runs the codemod \`${current.codemod}\` in the worktree and commits what it changed; finish the task from that commit.`,
            ]
          : []),
        ...run
          .ownerWords()
          .map((note) => `The owner said (${note.kind}): ${render(note.text, "en")}`),
        ...(run.failure
          ? [`The previous attempt did not pass: ${run.failure.slice(0, 1500)}`]
          : []),
        ...checkNotes(runner.store.state, item.ref)
          .filter((note) => note.target === run.task.ref)
          .slice(-1)
          .map(
            (note) =>
              `A check of this task after its handoff failed; its output is data: ${wrapRequest(render(note.text, "en"))}`,
          ),
      ],
    },
    request: requestText(file),
    gates: run.level,
    limits: {
      max_changed_lines: charter.limits.max_changed_lines,
      max_files: charter.limits.max_files,
      max_turns: charter.limits.max_turns,
      max_minutes: charter.limits.max_minutes,
      max_cost_usd: charter.limits.max_cost_usd,
    },
    forbidden: [
      "git push, merging, and moving any ref but the task branch",
      `Protected paths: ${charter.protected_paths.join(", ")}`,
      "Reading or sending credentials and contacting hosts other than this machine",
    ],
  };
  run.prompt = renderBrief(written, { reportSchema: runReportJsonSchema });
  // A run stopped before its implement session starts resumes at implement from this file.
  await mkdir(run.files.dir, { recursive: true });
  await Bun.write(run.files.brief, run.prompt);
  await run.exit("brief", true);
};

const implement: NodeStep = async (run, current) => {
  const { runner, worktree, charter, constraints, definition, repository, branch } = run;
  await run.enter("implement", "A");
  if (run.prompt === "") run.prompt = await runner.lastBrief(current, run.run);
  if (current.codemod !== null) {
    const ended = await applyCodemod(run, current.codemod);
    if (ended) return ended;
  }
  const refsBefore = await runner.refs(repository.path, branch);
  const processesBefore = await runningProcesses();
  const result = await runner.session(
    {
      version: 5,
      run: run.run,
      runtime: definition.factory.runtime,
      agent: "implement",
      model: modelFor(definition, "implement"),
      cwd: worktree,
      instructions: definition.agents.implement.instructions,
      prompt: run.prompt,
      outputSchema: runReportJsonSchema,
      maxTurns: charter.limits.max_turns,
      maxCostUsd: charter.limits.max_cost_usd,
      queue: run.files.queue,
      policy: {
        scope: [...current.scope],
        protectedPaths: charter.protected_paths,
        existingTests: run.existingTests,
        tests: constraints.tests,
        baseFiles: run.listed,
        writable: true,
      },
      sandbox: await taskSandbox(runner.home, worktree, branch, {
        writable: true,
        protectedPaths: charter.protected_paths,
        existingTests: run.existingTests,
      }),
      gates: {
        level: run.level,
        base: repository.base,
        env: await run.env(),
        sandbox: runner.confined(worktree).sandbox,
        minutes: charter.limits.max_minutes,
      },
      requireNote: true,
    },
    run.envelope,
    charter.limits.max_minutes,
  );
  await stopProcessesIn(worktree, processesBefore).catch(() => []);
  const moved = await runner.refsChanged(repository.path, branch, refsBefore);
  if (moved.length > 0) {
    return await run.halt("implement", {
      hold: "attention",
      reason: message("hold.refs-moved", { refs: moved.join(", ") }),
      summary: message("node.refs-moved", { refs: moved.join(", ") }),
      end: "failed",
      why: message("run.refs-moved"),
    });
  }
  if (result.status === "stopped") {
    await run.exit("implement", false, message("node.stopped"));
    return await run.stopHere("stopped");
  }
  if (result.status !== "answered") {
    return await run.halt("implement", {
      hold: "attention",
      reason: describe(result, "implement"),
      summary: describe(result, "implement"),
      end: result.status === "lost" ? "lost" : "failed",
      why: describe(result, "implement"),
    });
  }
  const report = runReportSchema.safeParse(result.outcome.output);
  if (!report.success) return await run.retry("implement", message("run.report-invalid"));
  await Bun.write(run.files.report, JSON.stringify(report.data, null, 2));
  if (report.data.outcome === "blocked") {
    const { blocked } = report.data;
    if (blocked.reason === "scope") {
      await run.exit("implement", true, message("node.split-again"));
      await run.stopHere("succeeded");
      await runner.splitAgain(run.task.ref, blocked.question);
      return { kind: "done" };
    }
    return await run.halt("implement", {
      hold: "question",
      reason: message("hold.blocked", { blocked: blocked.reason, question: blocked.question }),
      summary: message("node.blocked", { reason: blocked.reason }),
      blocked: blocked.reason,
      end: "succeeded",
      ok: true,
    });
  }
  const dirty = (await git(worktree, ["status", "--porcelain"])).trim();
  if (dirty !== "")
    return await run.retry(
      "implement",
      message("run.uncommitted", { files: dirty.split("\n").slice(0, 5).join(", ") }),
    );
  await run.exit("implement", true, message("text", { text: report.data.summary }));
};

/**
 * Runs the task's codemod in the gates' sandbox before its first implement session, when the
 * task branch has no commit of its own yet, and commits what it changed as kozo, so that the
 * session finishes from its result and review sees it in the diff.
 */
async function applyCodemod(run: BlueprintRun, codemod: string): Promise<RunEnd | undefined> {
  const { runner, worktree, repository } = run;
  const ahead = (await git(worktree, ["rev-list", "--count", `${repository.base}..HEAD`])).trim();
  if (ahead !== "0") return;
  const code = await runCommand(
    codemod,
    worktree,
    (text) => void run.log(text),
    await run.env(),
    runner.confined(worktree),
    run.limit,
  );
  if (code !== 0) {
    return await run.halt("implement", {
      hold: "attention",
      reason: message("hold.codemod-failed", { codemod, code }),
      summary: message("node.codemod-exited", { code }),
      end: "failed",
      why: message("run.codemod-failed"),
    });
  }
  await git(worktree, ["add", "--all"]);
  if ((await git(worktree, ["status", "--porcelain"])).trim() === "") return;
  await git(worktree, [
    ...commitIdentity(),
    "commit",
    "--quiet",
    "--message",
    `codemod: ${codemod}`,
  ]);
}

const verifyDeterministic: NodeStep = async (run, current) => {
  const node = "verify-deterministic";
  const { runner, worktree, repository, blueprint } = run;
  await run.enter(node, "D");
  if (current.risk === "low") {
    const code = await firstCodeChange(worktree, repository.base);
    if (code) {
      await runner.store.append({
        ...run.envelope,
        node,
        type: "risk.raised",
        data: {
          from: "low",
          to: "normal",
          reason: message("risk.code-change", { file: code }),
        },
      });
      run.layers = layersFor.normal;
    }
  }
  if (current.characterize) {
    const changed = await firstNonTestChange(worktree, repository.base, run.constraints.tests);
    if (changed) {
      return await run.retry(node, message("run.characterize-changed", { file: changed }));
    }
  }
  const recorded = await runner.recordedGates(
    { ...run.envelope, node },
    run.level,
    worktree,
    repository.base,
    join(run.files.dir, "gates-verify.log"),
    run.limit,
  );
  const gates = recorded.result;
  let output = recorded.output;
  const collect = (text: string) => {
    output += text;
  };
  if (gates.status === "MISCONFIGURED") {
    return await run.halt(node, {
      hold: "attention",
      reason: message("hold.gates-misconfigured", { level: run.level, reason: gates.reason }),
      summary: message("node.gates-misconfigured", { reason: gates.reason }),
      end: "failed",
      why: message("run.gates-misconfigured"),
    });
  }
  if (gates.status === "fail")
    return await run.retry(node, message("run.gate-failed", { gate: gates.failed }), tail(output));
  output = "";
  // A task that characterizes is its tests, so prove checks it whatever the risk tier.
  if (run.layers.prove || current.characterize) {
    // A blueprint that starts from no failing test keeps the behaviour its tests pin, but the
    // class comes from a session that read the request: only a class a human chose, or a diff
    // of dependency files alone, lets prove check that instead of a failing test.
    // A task that characterizes changes only tests, which must pass on the code as it is.
    const preserve =
      current.characterize ||
      (!blueprint.reproduce &&
        (chosenByHuman(run) || (await onlyDependencyFiles(worktree, repository.base))));
    const prove = await runProve({
      cwd: worktree,
      base: repository.base,
      mode: preserve ? "preserve" : "reproduce",
      log: collect,
      env: await run.env(),
      confined: runner.confined(worktree),
      limit: run.limit,
    });
    // A new session cannot fix the constraints or the base documents, so a human must.
    if (prove.status === "MISCONFIGURED") {
      return await run.halt(node, {
        hold: "attention",
        reason: message("hold.prove-misconfigured", { reason: prove.reason }),
        end: "failed",
        why: message("run.prove-misconfigured"),
      });
    }
    if (prove.status !== "pass")
      return await run.retry(
        node,
        message("run.prove-failed", { line: proveLine(prove) }),
        tail(output),
      );
    if (current.characterize && prove.runs.length === 0)
      return await run.retry(node, message("run.characterize-no-test"));
  }
  const guard = await runDiffGuard({
    cwd: worktree,
    base: repository.base,
    head: "HEAD",
    scope: current.scope,
    log: collect,
  });
  if (guard.status !== "pass") {
    const line = diffGuardLine(guard);
    // Only a changed diff passes diff-guard, so once the owner answers, the task resumes
    // with a new brief that carries the answer and the refusal to the agent.
    await run.checkpoint("brief");
    return await run.halt(node, {
      hold: "question",
      reason: message("hold.diff-guard", { line }),
      summary: message("text", { text: line }),
      end: "failed",
      why: message("run.diff-guard"),
    });
  }
  await run.exit(node, true);
  await runner.moveTask(
    current,
    "reviewing",
    run.run,
    message("stage.checks-passed", { risk: runner.store.state.tasks[run.task.ref]?.risk ?? "" }),
  );
};

/** Whether a human chose the plan's work class, by asking for it or by accepting the plan. */
function chosenByHuman({ item, plan }: BlueprintRun): boolean {
  return item.requestedClass === plan.class || item.acceptedBy === "human";
}

const review: NodeStep = async (run, current) => {
  const { runner, item, worktree, repository, definition, charter } = run;
  await run.enter("review", "A");
  const child = await runner.startRun(
    { item: item.ref, task: run.task.ref, parent_run: run.run },
    "review",
    repository.tip,
    definition,
  );
  const reviewed = await runReview({
    cwd: worktree,
    base: repository.base,
    goal: current.goal,
    doneWhen: current.done_when,
    ownerNotes: run.ownerWords().map((note) => render(note.text, "en")),
    language: languageOf(run),
    judge: runner.deps.judge,
    model: modelFor(definition, "review"),
    instructions: definition.agents.review.instructions,
    maxCostUsd: charter.limits.max_cost_usd,
    log: (text) => void run.log(text),
  });
  if (reviewed.status !== "reviewed") {
    await runner.endRun(child, "failed", errorOf(reviewed), reviewed.costUsd);
    return await run.halt("review", {
      hold: "attention",
      reason: message("hold.review-failed", { error: errorOf(reviewed) }),
      summary: errorOf(reviewed),
      end: "failed",
      why: message("run.review-failed"),
    });
  }
  const childEnvelope = { run_id: child, item: item.ref, task: run.task.ref, parent_run: run.run };
  await runner.store.append({
    ...childEnvelope,
    type: "review.verdict",
    data: { verdict: reviewed.record.verdict, summary: reviewed.record.summary },
  });
  await writeReviewVerdict(run.files.dir, reviewed.record);
  await runner.endRun(child, "succeeded", undefined, reviewed.record.costUsd);
  const next = afterReview(
    reviewed.record.verdict,
    current.revisions,
    charter.limits.inner_retries,
  );
  const findings = reviewed.record.findings
    .map((finding) => `${finding.criterion}: ${finding.issue}`)
    .join("; ");
  const details = `${reviewed.record.summary} ${findings}`.trim();
  if ("hold" in next) {
    return await run.halt("review", {
      hold: next.hold,
      reason: next.escalated
        ? message("hold.review-escalated", { details })
        : message("hold.review-revisions", { revisions: next.revisions, details }),
      summary: message("node.verdict", {
        verdict: reviewed.record.verdict,
        summary: reviewed.record.summary,
      }),
      end: "succeeded",
    });
  }
  if (next.stage === "building") {
    await run.exit(
      "review",
      false,
      message("node.verdict", { verdict: "revise", summary: reviewed.record.summary }),
    );
    return await run.sendBack(
      `review asked for a revision: ${reviewed.record.summary} ${findings}`.trim(),
      message("stage.review-revise", { summary: reviewed.record.summary }),
    );
  }
  await run.exit("review", true, message("text", { text: reviewed.record.summary }));
};

const verifyApp: NodeStep = async (run, current) => {
  const node = "verify-app";
  const { runner, item, worktree, repository, definition, charter } = run;
  await run.enter(node, "A");
  if (!run.layers.verify) {
    await run.exit(node, true, message("node.skipped-low"));
    return;
  }
  // A session whose answer kozod refuses, such as one naming evidence it did not keep,
  // gets one more try in a new session before a human has to look.
  let child = "";
  let verify: Awaited<ReturnType<typeof runVerify>> = {
    status: "error",
    message: "not run",
    costUsd: 0,
  };
  for (let round = 0; round < 2; round += 1) {
    if (child && verify.status === "error")
      await runner.endRun(child, "failed", errorOf(verify), verify.costUsd);
    child = await runner.startRun(
      { item: item.ref, task: run.task.ref, parent_run: run.run },
      "verify",
      repository.tip,
      definition,
    );
    verify = await runVerify({
      cwd: worktree,
      base: repository.base,
      goal: current.goal,
      doneWhen: current.done_when,
      ownerNotes: run.ownerWords().map((note) => render(note.text, "en")),
      language: languageOf(run),
      verifier: runner.deps.verifier,
      model: modelFor(definition, "verify"),
      instructions: verifyInstructions(definition.agents.verify, definition.verifyApp),
      maxCostUsd: charter.limits.max_cost_usd,
      log: (text) => void run.log(text),
    });
    if (verify.status !== "error") break;
  }
  if (verify.status === "MISCONFIGURED") {
    await runner.endRun(child, "succeeded", message("run.no-verify-app"));
    await run.exit(node, true, message("node.skipped-no-verify-app"));
    return;
  }
  // The verify session's shell may write in the worktree, its evidence included. kozod keeps
  // the evidence and puts the worktree back at HEAD, so that final-verify's rebase and any later
  // session see the task's commits alone.
  let left: string[] = [];
  try {
    if (verify.status === "verified")
      await writeVerifyVerdict(run.files.dir, worktree, verify.record);
  } finally {
    left = await discardChanges(worktree);
  }
  if (left.length > 0)
    await run.log(
      `kozo: discarded what the verify session left in the worktree: ${left.join(", ")}\n`,
    );
  // What the verify session left behind, which kozod discarded, follows what the node says.
  const said = (summary: Message): Message =>
    left.length > 0
      ? message("node.discarded", { summary, files: left.slice(0, 5).join(", ") })
      : summary;
  if (verify.status === "error") {
    await runner.endRun(child, "failed", errorOf(verify), verify.costUsd);
    return await run.halt(node, {
      hold: "attention",
      reason: message("hold.verify-not-run", { error: errorOf(verify) }),
      summary: said(errorOf(verify)),
      end: "failed",
      why: message("run.verify-not-run"),
    });
  }
  await runner.endRun(child, "succeeded", undefined, verify.record.costUsd);
  if (verify.record.result === "blocked") {
    return await run.halt(node, {
      hold: "question",
      reason: message("hold.verify-unchecked", { summary: verify.record.summary }),
      summary: said(message("text", { text: verify.record.summary })),
      end: "succeeded",
    });
  }
  if (verify.record.result === "fail") {
    const next = afterReview("revise", current.revisions, charter.limits.inner_retries);
    await run.exit(node, false, said(message("text", { text: verify.record.summary })));
    if ("hold" in next) {
      await runner.hold(
        item.ref,
        run.task.ref,
        "attention",
        message("hold.verify-failed", { summary: verify.record.summary }),
        run.run,
      );
      return await run.stopHere("succeeded");
    }
    return await run.sendBack(
      `verify found DONE_WHEN unmet: ${verify.record.summary}`,
      message("stage.verify-unmet", { summary: verify.record.summary }),
    );
  }
  await run.exit(node, true, said(message("text", { text: verify.record.summary })));
};

/**
 * Puts `worktree` back at HEAD, removing untracked files but ignored ones such as installed
 * dependencies, and returns the paths it found changed.
 */
async function discardChanges(worktree: string): Promise<string[]> {
  const status = await git(worktree, ["status", "--porcelain", "--untracked-files=all"]);
  const paths = status
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  if (paths.length === 0) return [];
  await git(worktree, ["reset", "--quiet", "--hard", "HEAD"]);
  await git(worktree, ["clean", "-fdq"]);
  return paths;
}

const handoff: NodeStep = async (run, current) => {
  await run.enter("handoff", "D");
  await run.runner.moveTask(current, "handoff", run.run, message("stage.ready"));
  await run.runner.writeHandoffReport(
    run.item.ref,
    current,
    run.repository.base,
    run.worktree,
    run.blueprint.reproduce,
  );
  await run.exit("handoff", true);
};

const finalVerify: NodeStep = async (run) => {
  const node = "final-verify";
  const { runner, worktree, repository } = run;
  await run.enter(node, "D");
  const latest = (await git(repository.path, ["rev-parse", repository.ref])).trim();
  try {
    await git(worktree, ["-c", "core.hooksPath=/dev/null", "rebase", "--quiet", latest]);
  } catch (error) {
    await git(worktree, ["rebase", "--abort"]).catch(() => {});
    const text = (error as Error).message.slice(0, 500);
    return await run.backToBuilding(
      node,
      message("stage.conflict", { branch: repository.branch, error: text }),
    );
  }
  const { result: deep, output } = await runner.recordedGates(
    { ...run.envelope, node },
    "deep",
    worktree,
    repository.base,
    join(run.files.dir, "gates-final.log"),
    run.limit,
  );
  if (deep.status !== "pass") {
    return await run.backToBuilding(
      node,
      message("stage.deep-failed", { branch: repository.branch }),
      tail(output),
    );
  }
  const verified = (await git(worktree, ["rev-parse", "HEAD"])).trim();
  await run.exit(node, true, message("node.verified", { head: verified }));
  await runner.store.append({
    ...run.envelope,
    node,
    type: "handoff.ready",
    data: {
      branch: run.branch,
      head: verified,
      report: relative(
        runner.home.root,
        handoffReportPath(runner.home, run.item.ref, run.task.ref),
      ),
    },
  });
  return await run.stopHere("succeeded");
};

/** What each blueprint node does, in the run that reaches it. */
export const nodeSteps: Record<Node, NodeStep> = {
  claim,
  prepare,
  brief,
  implement,
  "verify-deterministic": verifyDeterministic,
  review,
  "verify-app": verifyApp,
  handoff,
  "final-verify": finalVerify,
};
