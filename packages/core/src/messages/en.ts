/**
 * The English sentence of every message, which also sets the codes: a `{name}` is a value the
 * message carries.
 */
export const en = {
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
