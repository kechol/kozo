/**
 * The English sentence of every message, which also sets the codes: a `{name}` is a value the
 * message carries.
 */
export const en = {
  text: "{text}",
  "hold.start-approval": "start approval",
  "hold.plan-approval": "plan approval",
  "hold.pause": "kozo pause",
  "hold.take": "kozo take",
  "hold.rejected-twice": "the plan was rejected twice; kozo retry drafts it again from Triage",
  "hold.could-not-run": "kozod could not run it: {error}",
  "hold.capacity.charter": "the Charter keeps the repository from running: {reason}",
  "hold.capacity.budget-spent": "the daily budget of {budget} USD is spent",
  "hold.capacity.budget-held":
    "the daily budget of {budget} USD is spent or held back by the work running now",
  "hold.capacity.awaiting-merge": "{count} tasks await a merge, the Charter's limit",
  "hold.capacity.held":
    "{count} items and tasks wait on questions or attention, the Charter's limit",
  "hold.dependency": "waits for {open} to complete",
  "hold.dependency-cancelled":
    "{cancelled} was cancelled, so {task} cannot start; close it or plan it again",
  "hold.branch-exists": "{branch} already exists in {repository}",
  "hold.branch-deleted": "{branch} was deleted without a merge",
  "hold.issue-gone":
    "GitHub no longer has the Issue {issue}: it was deleted or moved to another repository; close the item or follow it where it went",
  "hold.no-progress": "no progress after {attempts} attempts: {failure}",
  "hold.prepare-failed": "prepare failed: {command} exited with {code}",
  "hold.refs-moved": "the run changed refs outside its branch: {refs}",
  "hold.blocked": "{blocked}: {question}",
  "hold.codemod-failed": "the codemod {codemod} exited with {code}",
  "hold.gates-misconfigured": "the {level} gates are MISCONFIGURED: {reason}",
  "hold.prove-misconfigured": "prove is MISCONFIGURED: {reason}",
  "hold.diff-guard": "diff-guard refused the diff: {line}",
  "hold.review-failed": "review failed: {error}",
  "hold.review-escalated": "review escalated: {details}",
  "hold.review-revisions": "review asked for a revision after {revisions} retries: {details}",
  "hold.verify-failed": "verify failed: {summary}",
  "hold.verify-not-run": "verify failed to run: {error}",
  "hold.verify-unchecked": "verify could not check the change: {summary}",
  "hold.final-verification": "the final verification failed after {fixes} fixes: {failure}",
  "hold.draft-refused": "kozod refused the plan draft twice: {issues}",
  "hold.defect": "{defect}; kozo retry checks again",
  "hold.close-refused.complete":
    "{closer} closed the Issue but may not complete it; kozo close decides",
  "hold.close-refused.cancel":
    "{closer} closed the Issue but may not cancel it; kozo close decides",
  "hold.untrusted-edit":
    "{author}, who may not write, edited the request after it started; kozo retry takes the new text",
  "hold.pull-closed": "{url} was closed without a merge",
  "hold.diverged":
    "{branch} on GitHub no longer builds on {head}; kozo retry continues from kozod's commit",
  "hold.ci-failed": "CI failed after {fixes} fixes: {checks}",
  "stage.no-start-approval": "its autonomy level needs no start approval",
  "stage.approve": "kozo approve",
  "stage.retry": "kozo retry",
  "stage.return": "kozo return",
  "stage.done": "kozo close --done",
  "stage.cancel": "kozo close --cancel: {reason}",
  "stage.plan-always": "the request has no trusted requester, so its plan always needs an approval",
  "stage.plan-level": "the plan needs an approval at {level}",
  "stage.plan-feature":
    "{why}; the plan agent first works out its acceptance criteria with the owner",
  "stage.human-commit": "a human committed to {branch}",
  "stage.split-again":
    "{task} cannot be done within its scope, so the item is split again: {question}",
  "stage.merged": "merged into {branch}; the {level} gates passed there",
  "stage.merged-failed": "merged into {branch}; the {level} gates failed there",
  "stage.defect": "the check after the merge failed, a post-merge defect",
  "stage.complete": "every task is complete",
  "stage.checks-passed": "the checks of the {risk} risk tier passed",
  "stage.ready": "the checks of its risk tier passed",
  "stage.review-revise": "review asked for a revision: {summary}",
  "stage.verify-unmet": "verify found DONE_WHEN unmet: {summary}",
  "stage.conflict": "the diff conflicts with the latest {branch}: {error}",
  "stage.deep-failed": "the deep gates failed after rebasing on {branch}",
  "stage.moved-to-issue": "moved to {issue}",
  "stage.issue-closed": "the Issue was closed as {reason}",
  "stage.changes-requested": "{author} requested changes on {url}",
  "stage.ci-failed": "CI failed: {checks}",
  "run.closed": "the task is closed",
  "run.held": "the task is held",
  "run.kozod-stopped": "kozod stopped",
  "run.human-stopped": "a human stopped it",
  "run.interrupted": "kozod stopped while the run was going",
  "run.unfinished": "kozod could not finish it: {error}",
  "run.prepare-failed": "prepare failed",
  "run.refs-moved": "refs changed outside the task branch",
  "run.codemod-failed": "codemod failed",
  "run.gates-misconfigured": "gates misconfigured",
  "run.prove-misconfigured": "prove misconfigured",
  "run.diff-guard": "diff-guard refused the diff",
  "run.review-failed": "review failed",
  "run.verify-not-run": "verify failed to run",
  "run.no-verify-app": "no verify-app.md",
  "run.final-verification": "final verification failed",
  "run.draft-refused": "kozod refused the plan draft",
  "run.answer-invalid": "the answer does not match its schema",
  "run.report-invalid": "the run report does not match its schema",
  "run.uncommitted": "the run left uncommitted changes: {files}",
  "run.characterize-changed":
    "the task characterizes, so its diff changes only test files, but it changes {file}",
  "run.characterize-no-test":
    "the task characterizes, but its diff adds no test that a prove entry of the constraints runs",
  "run.gate-failed": "the {gate} gate failed",
  "run.prove-failed": "{line}",
  "session.lost": "{agent} lost its worker",
  "session.timed-out": "{agent} ran out of time",
  "session.stopped": "{agent} was stopped",
  "session.failed": "{agent} failed: {reason}",
  "session.answered": "{agent} answered",
  "session.no-diff": "there is no diff to review",
  "session.accept-blocking": "the review accepted the diff despite a blocking finding",
  "session.conditions-count":
    "the verify answer covers {count} conditions, not the {expected} given",
  "session.condition-order":
    "the verify answer's condition {index} is not DONE_WHEN condition {index}",
  "session.pass-unmet": "the verify answer passed with a condition that was not met",
  "session.no-evidence": "the verify answer met condition {index} without evidence",
  "session.not-cleaned": "the verify answer passed without cleaning up after the app",
  "session.verdict-inside": "the verdict directory must be outside the worktree",
  "session.evidence-changed": "evidence file {path} changed while it was copied",
  "session.evidence-missing": "evidence file {path} does not exist",
  "session.evidence-outside": "evidence file {path} is outside the worktree",
  "session.evidence-not-file": "evidence file {path} is not a regular file with a single link",
  "session.schema": "the {name} answer does not match its schema: {issues}",
  "session.ended": "the session ended with {subtype}",
  "session.no-result": "the session ended without a result",
  "session.failed-error": "the session failed: {error}",
  "node.failure": "{reason}:\n{details}",
  "node.exited": "{command} exited with {code}",
  "node.prepared": "already prepared",
  "node.refs-moved": "refs changed outside the task branch: {refs}",
  "node.stopped": "stopped",
  "node.split-again": "blocked: scope; the item is split again",
  "node.blocked": "blocked: {reason}",
  "node.codemod-exited": "codemod exited with {code}",
  "node.gates-misconfigured": "gates are MISCONFIGURED: {reason}",
  "node.verdict": "{verdict}: {summary}",
  "node.skipped-low": "skipped for the low risk tier",
  "node.skipped-no-verify-app": "skipped: the repository has no verify-app.md",
  "node.discarded": "{summary}; kozod discarded what it left in the worktree: {files}",
  "node.verified": "verified {head}",
  "note.ci-failed": "The CI checks {checks} failed on {head}.",
  "note.check-failed":
    "After the merge, the {level} gates on {branch} failed, so DONE_WHEN is not met:\n{output}",
  "note.changes-requested": "{author} requested changes",
  "defect.gates": "the {level} gates failed on {branch} after the merge",
  "risk.code-change": "the diff changes {file}, which is not documentation",
  "factory.pause": "kozo pause",
  "factory.resume": "kozo resume",
  "factory.api-failures": "three sessions in a row failed on the API; the last: {reason}",
  "factory.paused-label": "{login} put kozo:paused on {ref}",
  "demotion.defect": "a post-merge defect in {task}",
  "demotion.intervention": "a human intervened in {intervened} of the last {recent} merged diffs",
  "guard.not-text": "the path is not text",
  "guard.outside": "{path} is outside the worktree",
  "guard.symlink": "{path} goes through a symbolic link",
  "guard.hard-link": "{path} has more than one hard link",
  "guard.protected": "{path} is a protected path; ask with kozo_blocked if it must change",
  "guard.out-of-scope": "{path} is outside the task's scope ({scope})",
  "guard.existing-test":
    "{path} is an existing test, which this repository does not let a task change",
  "guard.command": "{name}: {why}",
  "guard.git": "git {name}: {why}",
  "guard.why.github": "the factory alone talks to GitHub",
  "guard.why.forge": "the factory alone talks to a forge",
  "guard.why.own-user": "commands run as the worker's own user",
  "guard.why.alias": "aliases would hide what a later command runs",
  "guard.why.keeps-running": "nothing may keep running after its command",
  "guard.why.scheduled": "nothing may be scheduled outside the run",
  "guard.why.started": "nothing may be started outside the run",
  "guard.why.outside-sandbox": "it runs outside the sandbox",
  "guard.why.network": "the run has no network beyond this machine",
  "guard.why.gates": "the gates run through the kozo_gates tool",
  "guard.why.push": "only kozod pushes",
  "guard.why.pull": "the task branch starts from the default branch kozod chose",
  "guard.why.merge": "humans merge",
  "guard.why.ref": "the run may change only its task branch",
  "guard.why.switch": "the run stays on its task branch",
  "guard.why.history": "history outside the task branch is not the run's",
  "guard.why.submodule": "submodules change what the repository checks out",
  "guard.why.bisect": "it moves HEAD off the task branch",
  "guard.git-config": "git -c and --config-env would change git's configuration for the command",
  "guard.git-elsewhere": "git {option} would point git somewhere other than the worktree",
  "guard.git-c-dir": "git -C must name a directory inside the worktree",
  "guard.git-dynamic-subcommand": "a git subcommand built from an expansion",
  "guard.git-dynamic-argument": "git {name}: an argument built from an expansion",
  "guard.git-stash":
    "git stash: the run keeps its changes in its worktree; commit them or keep editing",
  "guard.git-pager": "git grep --open-files-in-pager runs another program",
  "guard.git-changes": "git {command} would change a ref or a setting",
  "guard.git-unlisted": "git {name} is not a command a run may use",
  "guard.too-deep": "the command nests too deeply to check",
  "guard.unparsed": "the command does not parse: {error}",
  "guard.background": "background jobs could change files after this check",
  "guard.script-outside": "{how} {path}: only scripts inside the worktree may run",
  "guard.script-alone": "run {path} in a Bash call of its own",
  "guard.redirect-git": "{name} would redirect git",
  "guard.dynamic-command": "a command name built from an expansion",
  "guard.filled-command": "a command name that find or xargs fills in",
  "guard.xargs": "xargs {target}: xargs adds arguments from its input that the guard never reads",
  "guard.dynamic-eval": "eval of text built from an expansion",
  "guard.dynamic-path": "{name} of a path built from an expansion",
  "guard.dynamic-script": "{name} -c with a script built from an expansion",
  "guard.dynamic-script-path": "{name} with a script path built from an expansion",
  "guard.piped-script": "{name} reading its script from a pipe",
  "guard.pattern-outside": "the pattern reaches outside the worktree",
  "guard.command-not-text": "the command is not text",
  "guard.tool": "{tool} is not a tool a run may use",
  "guard.wrapper-dynamic": "{name} with an argument built from an expansion",
  "guard.wrapper-option": "{name} {option}: an option the guard does not know",
  "guard.wrapper-no-value": "{name} {flag} without its value",
  "guard.wrapper-dynamic-value": "{name} {flag} with a value built from an expansion",
  "notice.ready": "{task} is ready for you to review and merge",
  "notice.held.approval": "{subject} waits for your approval: {reason}",
  "notice.held.question": "{subject} waits for your question: {reason}",
  "notice.held.attention": "{subject} waits for your attention: {reason}",
  "notice.paused": "the factory paused: {reason}",
  "notice.refused": "kozod refused the factory definition: {issues}",
  "notice.demoted":
    "kozod lowered {class} in {repository} from {from} to {to}: {reason}; editing the Charter ends it",
  "notice.budget-spent":
    "the daily budget of {budget} USD is spent; nothing new starts until midnight",
  "notice.budget-share": "kozo has spent {percent} percent of the daily budget of {budget} USD",
  "notice.reminder": "{subject} has waited {days} days for your approval: {reason}",
  "api.no-repository": "no repository is registered; add one to factory/factory.yml",
  "api.name-repository": "name the repository: {repositories}",
  "api.unregistered": "{repository} is not a registered repository",
  "api.not-accepted": "not accepted: {reason}",
  "api.duplicate": "{ref} already asks for this",
  "api.added": "added {ref}; it goes to Triage",
  "api.added-waiting": "added {ref}; it waits for your start approval",
  "api.issue-local": "kozo issue moves items only in GitHub mode",
  "api.missing": "{ref} does not exist",
  "api.no-approval": "{ref} is not waiting for an approval",
  "api.approved-start": "approved the start of {ref}; it goes to Triage",
  "api.no-plan": "{ref} has no plan to approve",
  "api.approved-plan": "approved the plan of {ref}; {count} task(s) go to Building",
  "api.no-plan-approval": "{ref} is not waiting for a plan approval",
  "api.rejected-twice": "rejected the plan of {ref} a second time; it waits for your attention",
  "api.rejected": "rejected the plan of {ref}; the plan agent drafts it again with your reason",
  "api.explorer-stopped": "kozod answers questions only while it runs",
  "api.explorer-busy": "kozod answers one question at a time; ask again once the last answer is in",
  "api.budget-spent": "the daily budget of {budget} USD is spent; ask tomorrow",
  "api.answered": "answered {ref}; work resumes",
  "api.sent": "sent to {run}, which reads it at its next turn",
  "api.noted": "noted for the next run of {ref}",
  "api.already-paused": "{ref} is already paused",
  "api.closed": "{ref} is {stage}",
  "api.held-until": "{ref} is held by {hold}; it does not move until that clears",
  "api.paused-stopped": "paused {ref} and stopped {run}",
  "api.paused": "paused {ref}; it stops at the next node",
  "api.yours": "{ref} is yours; kozo return gives it back",
  "api.not-paused": "{ref} is not paused",
  "api.resumed": "resumed {ref}",
  "api.held": "{ref} is held by {hold}",
  "api.retry-building": "retrying {ref} from Building with its fix rounds given back",
  "api.retry-checkpoint": "retrying {ref} from its last checkpoint",
  "api.retry-plan": "retrying {ref} from its plan",
  "api.already-yours": "{ref} is already yours",
  "api.no-worktree": "{ref} has no worktree yet; its first run makes one",
  "api.taken":
    "{ref} is yours: commit in {worktree} on {branch}, then run kozo return {ref} <what you changed and checked>",
  "api.not-taken": "{ref} is not taken; kozo take hands it to you",
  "api.uncommitted": "{worktree} has uncommitted changes; commit them first",
  "api.wrong-branch": "{worktree} is not on {branch}; switch back to it first",
  "api.returned": "gave {ref} back; its checks run on your commits",
  "api.before-itself": "{ref} cannot move before itself",
  "api.already-there": "{ref} is already there",
  "api.moved-before": "moved {ref} before {before}",
  "api.moved-end": "moved {ref} to the end",
  "api.already-closed": "{ref} is already {stage}",
  "api.closed-done": "closed {ref} as done",
  "api.cancelled": "cancelled {ref}: {reason}",
  "api.factory-already-paused": "the factory is already paused",
  "api.factory-paused": "paused the factory; nothing new starts",
  "api.factory-not-paused": "the factory is not paused",
  "api.factory-resumed": "resumed the factory",
  "api.not-github": "{path} is not a registered GitHub repository",
  "api.install-waits": "the install waits for your review and merge: {url}",
  "api.install-complete": "{repository} has every file kozo installs",
  "api.install-opened": "opened {url}; edit the files, set status: ready, then merge it",
  "api.not-local": "{ref} is not a local item",
  "api.has-tasks": "{ref} has tasks already, whose work would not follow it",
  "api.no-github": "{repository} has no GitHub repository in factory.yml",
  "api.moved-issue": "moved {ref} to {issue}; kozod takes it up as {item}",
  "api.no-outcome": "{ref} has reached no outcome an eval case can expect yet",
  "api.no-start-run": "{ref} has no run to start from",
  "api.rebuilt": "rebuilt kozo.db from the event logs",
  "api.install-local": "in local mode, kozo admin install writes the files itself",
  "api.drafted": "drafted evals/{id}.yml from {run}",
  "api.prune-none": "no run of an item closed before {date} has records to prune",
  "api.prune-would": "would prune {count} runs of items closed before {date}: {runs}",
  "api.pruned": "pruned {count} runs of items closed before {date} to their logs and verdicts",
  "api.unknown-host": "unknown host",
  "api.hello-nonce": "hello needs a hex nonce",
  "api.session-origin": "a session is given only to the dashboard's own origin",
  "api.code-invalid": "the code is unknown, used or expired",
  "api.token": "missing or wrong API token",
  "api.code-token": "only the API token asks for a dashboard code",
  "api.write-origin": "writes are accepted only from this machine's own origin",
  "api.not-json": "the body is not JSON",
  "api.no-view": "no report view {view}",
  "api.days": "days must be a whole number from 1 to {max}",
  "api.unknown-list": "unknown list {list}",
  "api.not-reference": "{ref} is not a reference",
  "api.diff-task": "only a task has a diff",
  "api.no-diff": "{ref} has no diff",
  "api.no-branch": "{ref} has no branch yet",
  "api.records-task": "only a task has records",
  "api.not-run": "{run} is not a run",
  "api.no-evidence": "no such evidence",
  "api.unknown-verb": "unknown verb {verb}",
  "api.verb-kind": "a {kind} does not take {verb}",
  "api.invalid-install": "invalid install",
  "api.invalid-eval": "invalid eval case",
  "api.invalid-prune": "invalid prune",
  "api.no-endpoint": "no such endpoint",
  "api.invalid-item": "invalid item",
  "api.invalid-verb": "invalid {verb}",
  "cli.usage": `Usage: kozo <command>

Commands:
  up | down [--json]
      Start kozod in the background, or stop it
  status [--line] [--json]
      kozod's state, mode, runs, the inbox count and today's cost; --line
      prints one line for a status bar
  add <text> [--repo <path>] [--class <class>] [-f <file>] [--json]
      Add an item; the first line is its title and the rest, with the
      file's text, its body
  ls [inbox|items|tasks|runs] [--json]
      List what waits for you (the default) or every item, task or run
  show <ref> [-f] [--diff] [--json]
      Show an item, task or run; -f follows its events, and --diff prints a
      task's diff against the default branch
  say <ref> <text>          Answer a question or instruct a run or task
  say --ask <ref> <question>
      Ask about an item, task or run; the explorer answers from the records
      without touching the work
  approve <item> [text]     Approve a start or a plan
  reject <item> <reason>    Reject a plan
  pause [ref] [--now] | resume [ref]
      Stop or resume the whole factory, or one item, task or run
  retry <ref> [text]        Retry a task from its checkpoint or an item
  close <ref> --done | --cancel <reason>
      Complete an item or task that needed no change, or cancel it
  reorder <item> [--before <item>]
      Move an item before another in the order kozod starts work, or to the end
  issue <item>              In GitHub mode, move a local item without tasks to an
      Issue of its repository, which kozod then takes up
  take <task>               Take a task over and work in its worktree
  return <task> <text>      Give a taken task back once your work is committed;
      its checks run on your commits from the deterministic ones on
  report [--days <n>] [--review | --cost] [--json]
      The metrics and failures over the last <n> days (default 30) and the
      promotion proposals; --review adds each class's level, the demotions
      and the cost, --cost shows each day's cost against the budget
  dashboard [--url] [--json]
      Open the dashboard in the browser, or print its URL with --url; the URL
      opens a session once, within a minute
  check [path] [--json]
      Check the factory definition, each repository's Charter, claude and the
      sandbox; with a path, only the definition or .kozo/ in that directory
  admin init [--json]       Create the factory definition from kozo's template
  admin install <path> [--json]
      Add kozo's files to a repository; in GitHub mode kozod opens them as a
      pull request
  admin db-rebuild          Rebuild kozo.db from the event logs
  admin eval add <run> [--json]
      Draft the eval case of a run's item into the factory definition's evals/
  admin eval run [<case>...] [--json]
      Run the eval cases, or the named ones, each in a throwaway factory home,
      and print the share that reached the expected outcome and the cost
  admin prune --older-than <days> [--dry-run] [--json]
      Remove all but the event log, report, verdicts and decision log of
      every run whose item closed at least <days> days ago

  gates [--level fast|full|deep] [--base <ref>] [--json]
      Run the gates of one level (default full); with --base, take the
      constraints from the tip of <ref> instead of the worktree
  diff-guard --base <ref> [--head <ref>] [--scope <glob>]... [--json]
      Check the diff from the merge base of <ref> to <head> (default HEAD)
      against the Charter and constraints at the tip of <ref>
  prove --base <ref> [--preserve] [--json]
      Require the changed tests to pass at HEAD and to fail with the
      non-test changes reverted in place; with --preserve, to pass reverted
      too, for a change that keeps behaviour; the worktree must be clean
  review --base <ref> --goal <text> --done-when <text>... [--model <id>]
         [--max-cost <usd>] [--out <dir>] [--json]
      Judge the diff from the merge base of <ref> to HEAD in a separate
      claude session that sees only the diff, GOAL and DONE_WHEN; with
      --out, record the verdict in <dir>/verdict.json
  verify --base <ref> --goal <text> --done-when <text>... [--model <id>]
         [--max-cost <usd>] [--out <dir>] [--json]
      Run the app by .kozo/verify-app.md at the tip of <ref> in a sandboxed
      claude session, exercise each DONE_WHEN condition and, with --out,
      record the verdict and copy the evidence into <dir>

Options:
  --version  Print the version

A <ref> of an item is K-<n> or <repo>#<n>, of a task <item>/t<n> and of a
run r-<nnnn>. Exit codes: 0 success, 1 failure, 2 usage error, 3 waiting
for a human, 4 not found.

A <ref> after --base or --head is a full commit ID, HEAD, a full ref such
as refs/remotes/origin/main, or a branch name, read as refs/heads/<name>.`,
  "cli.unknown-command": "unknown command '{command}'",
  "cli.unknown-gate-level": "unknown gate level '{level}'",
  "cli.needs-base": "{command} needs --base <ref>",
  "cli.needs-session-options":
    "{command} needs --base <ref>, --goal <text> and at least one --done-when <text>",
  "cli.max-cost": "--max-cost must be a positive number of US dollars",
  "cli.needs-claude": "{command} needs the claude CLI on PATH",
  "cli.condition-met": "met",
  "cli.condition-not-met": "not met",
  "cli.kozod-not-installed": "kozod is not installed beside kozo or on PATH; set KOZOD to it",
  "cli.kozod-unreachable": "kozod is not running; start it with kozo up",
  "cli.kozod-timeout": "kozod did not answer within {seconds} seconds",
  "cli.kozod-foreign": "the server at {base} is not this home's kozod; the token was not sent",
  "cli.kozod-never-ran": "kozod has not run in this home yet; start it with kozo up",
  "cli.kozod-not-json": "kozod answered {status} with something that is not JSON",
  "cli.kozod-answered": "kozod answered {status}",
  "cli.kozod-already-running": "kozod is already running",
  "cli.kozod-up": "kozod is up",
  "cli.kozod-not-started": "kozod did not start; see {log}",
  "cli.kozod-not-running": "kozod is not running",
  "cli.kozod-not-running-pid": "kozod is not running; {file} names pid {pid}, which is not kozod",
  "cli.kozod-down": "kozod is down",
  "cli.kozod-not-stopped": "kozod (pid {pid}) did not stop within 15 seconds",
  "cli.opener-failed": "{opener} could not open the browser; run kozo dashboard --url",
  "cli.dashboard-opened": "opened the dashboard at {url}",
  "cli.status-down": "kozo: down",
  "cli.status-line": "kozo: {state} {mode} · {running} · {waiting} · {cost}",
  "cli.state-up": "up",
  "cli.state-paused": "paused",
  "cli.kozod-state-running": "running",
  "cli.kozod-state-paused": "paused ({reason})",
  "cli.count-running": "{count} running",
  "cli.count-waiting": "{count} waiting",
  "cli.count-in-inbox": "{count} in the inbox",
  "cli.cost-today": "{amount} today",
  "cli.cost-today-held": "{amount} today, {held} held back",
  "cli.unknown-class": "unknown work class '{class}'",
  "cli.add-needs-text": "add needs the request text",
  "cli.unknown-list": "unknown list '{list}'",
  "cli.nothing-in": "nothing in {list}",
  "cli.awaiting-merge": "awaiting merge",
  "cli.show-needs-ref": "show needs an item, task or run reference",
  "cli.diff-needs-task": "--diff needs a task reference",
  "cli.characterizes": "(characterizes)",
  "cli.draft-summary": "{class}, {risk} risk: {approach}",
  "cli.run-under": "{target} under {parent}",
  "cli.needs-reference": "{verb} needs a reference",
  "cli.say-needs-text": "say needs the text to send",
  "cli.reject-needs-reason": "reject needs a reason",
  "cli.close-needs-choice": "close needs --done or --cancel <reason>",
  "cli.return-needs-text": "return needs what you changed and checked",
  "cli.report-exclusive": "report takes --review or --cost, not both",
  "cli.report-days": "report takes --days <n>, a whole number from 1 to 365",
  "cli.report-window": "over the last {days} days, {merged} merged diffs",
  "cli.metric-autonomy": "{rate}  (70% or more)",
  "cli.metric-defect": "{rate}  (5% or less)",
  "cli.metric-cost": "{cost}  (median)",
  "cli.metric-time": "{time}  (median, within 24 h)",
  "cli.metric-revise": "{rate} of {reviews} reviews  (10% to 30%)",
  "cli.metric-held": "{held} questions and attention  (10 or fewer)",
  "cli.no-failures": "no failures in the window",
  "cli.failures": "failures in the window, for the retrospective: {count}",
  "cli.promotions": "promotion proposals: raise to L3 in the Charter",
  "cli.class-in-repository": "{class} in {repository}",
  "cli.levels": "levels as kozod applies them",
  "cli.demotions": "demotions, until the Charter changes",
  "cli.demotion": "{place}: {from} to {to}, {reason}",
  "cli.cost-in-window": "{cost} in the window",
  "cli.cost-of-budget": "{today} of {budget}",
  "cli.eval-add-takes-run": "admin eval add takes one run, r-<nnnn>",
  "cli.eval-exists": "{path} exists already; remove it to draft it again",
  "cli.eval-wrote": "wrote {path}; add the hidden tests and checks it needs, then commit it",
  "cli.eval-takes": "admin eval takes add or run",
  "cli.eval-no-results": "kozod --eval printed no results",
  "cli.eval-expected": "expected {expected}",
  "cli.eval-check-by-hand": "check by hand: {rule}",
  "cli.eval-summary": "{passed} of {total} reached the expected outcome; {cost} in all",
  "cli.exited-with": "{command} exited with {code}",
  "cli.install-takes-path": "admin install takes the repository's path",
  "cli.prune-takes-days": "admin prune takes --older-than <days>, a whole number of days",
  "cli.admin-takes": "admin takes init, install, db-rebuild, prune or eval",
  "cli.install-nothing": "{path} has every file kozo installs",
  "cli.installed":
    "added {files} to {path}; edit them, set status: ready in .kozo/charter.yml and commit them",
  "cli.init-not-empty": "{directory} is not empty; the factory definition is already there",
  "cli.init-commit-failed": "wrote {directory}, but could not commit it: {error}",
  "cli.init-created":
    "created the factory definition in {directory}; add a repository to factory.yml and commit it",
  "cli.check-takes-path": "check takes at most one path",
  "cli.check-neither":
    "neither a factory definition (factory.yml, agents/) nor a repository with .kozo/",
  "cli.check-at-commit": "{where} at {commit}",
  "cli.check-missing": "{path} is missing",
  "cli.check-charter-status": "status is {status}; kozo does not work here until it is ready",
  "cli.check-ready": "ready",
  "cli.check-valid": "valid",
  "cli.check-verify-app-missing": "{path} is missing, so verify does not run",
  "cli.check-hooks-sdk": "the worker registers the guard in code and loads no settings file",
  "cli.check-hooks-cli":
    "claude loads only the settings file kozod writes, whose hooks hand every tool call to the worker's guard",
  "cli.check-name-flags": "claude flags",
  "cli.check-name-sign-in": "claude sign-in",
  "cli.check-name-gh": "gh sign-in",
  "cli.check-claude-missing": "claude is not on PATH",
  "cli.check-flags-ok": "every flag kozo uses is there",
  "cli.check-flags-missing": "missing {flags}; update claude",
  "cli.check-signed-in": "signed in with {method}",
  "cli.check-not-signed-in": "not signed in; run claude auth login",
  "cli.check-gh-missing": "gh is not on PATH; GitHub mode reaches GitHub through it",
  "cli.check-gh-signed-in": "signed in to github.com as {login}",
  "cli.check-gh-not-signed-in": "gh is not signed in to github.com; run gh auth login",
  "cli.check-confines": "{tool} confines the gates",
  "cli.check-lsof-ok": "lists the processes a session leaves",
  "cli.check-lsof-missing":
    "lsof is not on PATH; kozod needs it to stop what a session leaves running",
  "cli.check-no-sandbox": "no sandbox for {platform}",
  "cli.check-missing-tools": "missing {tools}",
  "hold-kind.approval": "approval",
  "hold-kind.question": "question",
  "hold-kind.attention": "attention",
  "hold-kind.paused": "paused",
  "hold-kind.taken": "taken",
  "hold-kind.dependency": "dependency",
  "hold-kind.capacity": "capacity",
  "github.status": "**kozo**: {item} is in {stage}.",
  "github.status-waiting": "**kozo**: {item} is in {stage} and waits for {hold}: {reason}.",
  "github.table": "| Task | Stage | Pull request |",
  "github.task-waits": "{stage} (waits for {hold})",
  "github.cost": "Cost so far: {cost} USD",
  "github.question":
    "**Question about {ref}:** {question}\n\nAnswer with a reply here if you may write to this repository, or with `kozo say {ref} <answer>`.",
  "github.ready": "{task} is ready for you to review and merge: {url}",
  "github.part-of": "Part of #{issue}",
  "github.install-title": "Install kozo",
  "github.install-body":
    "This adds what kozo needs in this repository:\n\n{files}\n\nBefore merging, describe the repository in `AGENTS.md`, replace the commands in `.kozo/constraints.yml` and `.kozo/verify-app.md` with the repository's own, read every setting in `.kozo/charter.yml` and set its `status` to `ready`. kozo works here only after that.\n\nkozo does not change the repository's settings. To protect the default branch so that changes reach it only through pull requests that pass `kozo check`, an admin can apply this ruleset:\n\n```sh\ngh api --method POST repos/{repository}/rulesets --input - <<'EOF'\n{ruleset}\nEOF\n```",
  "github.label-stage": "The stage kozo shows",
  "github.label-needs": "kozo waits for a human",
  "github.label-accept": "Approve kozo's start on this Issue",
  "github.label-paused": "Pause the kozo factory",
  "handoff.why": "## Why",
  "handoff.task-of": "{title} — task {index} of {count}.",
  "handoff.what": "## What changed",
  "handoff.no-report": "(no run report)",
  "handoff.decisions": "Decisions:",
  "handoff.scope": "## Out of scope",
  "handoff.nothing": "Nothing noted.",
  "handoff.safe": "## Why it is safe",
  "handoff.prove-fail": "- prove: the changed tests fail without the change ({tests})",
  "handoff.prove-pass": "- prove: the changed tests pass without the change ({tests})",
  "handoff.review": "- review: {verdict} — {summary}",
  "handoff.review-none": "- review: not recorded",
  "handoff.verify": "- verify: {result} — {summary}",
  "handoff.verify-none": "- verify: not run",
  "handoff.verification": "## Verification",
  "handoff.merge": "Merge it with: git merge --no-ff {branch}",
  "issue.owner-name": "Use <owner>/<name>",
  "issue.kozo-label": "kozo: labels are kozo's own",
  "issue.github-required": "Name the GitHub repository in github mode",
  "issue.duplicate-repository": "Another repository is also named {name}",
  "issue.worktree-only": "Use worktree, the only isolation kozo has",
  "issue.gate-name": "Use lowercase letters, digits and -",
  "issue.gate-once": "List each gate once",
  "issue.prove-files": "Put {files} where the test files go",
  "issue.gate-undefined": 'Gate "{name}" is not defined in gates',
  "issue.blueprint-nodes":
    "List every node in the order {nodes}; the risk tier decides whether verify-app runs",
  "issue.task-id": "Use t<n>",
  "issue.codemod-line": "Write the codemod as one line of printable ASCII characters",
  "issue.task-twice": "Task {id} is listed twice",
  "plan.too-many-tasks":
    "the plan has {count} tasks, more than the Charter's max_tasks_per_item of {limit}",
  "plan.too-big":
    "{task} is estimated at {lines} lines in {files} files, over the Charter's {maxLines} lines in {maxFiles} files",
  "plan.cycle": "the dependencies form a cycle: {cycle}",
  "plan.shared-scope": "{a} and {b} share scope, but neither depends on the other",
  "plan.migration-after":
    "a migration's tasks form one chain in order, so {task} depends on {before} alone",
  "plan.migration-first":
    "a migration's tasks form one chain in order, so {task} depends on no task",
  "plan.migration-start":
    "a migration starts with a task that characterizes: {task} must add tests that pin the behaviour the migration keeps",
  "plan.characterize-codemod": "{task} characterizes, so it adds tests only and runs no codemod",
  "plan.done-when": "no task's done_when repeats the item's DONE_WHEN condition \"{condition}\"",
} as const;
