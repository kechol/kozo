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
  "hold.no-progress": "no progress after {attempts} attempts: {failure}",
  "hold.prepare-failed": "prepare failed: {command} exited with {code}",
  "hold.refs-moved": "the run changed refs outside its branch: {refs}",
  "hold.run-failed": "the run {outcome}",
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
  "hold.draft-failed": "{agent} {outcome}",
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
} as const;
