/**
 * The tones the page colours states with, after GitHub's and Linear's conventions: blue asks for
 * a human's decision, yellow is work in progress, orange needs care, red failed, green passed or
 * awaits a merge, violet is merged and done, and grey is not active. style.css gives each its
 * colours, so no other file names a colour for a state.
 */
export type Tone = "info" | "progress" | "warning" | "negative" | "positive" | "done" | "neutral";

export const tones = {
  stage: {
    intake: "neutral",
    triage: "neutral",
    planning: "info",
    building: "progress",
    reviewing: "progress",
    handoff: "positive",
    complete: "done",
    cancelled: "neutral",
  },
  hold: {
    approval: "info",
    question: "warning",
    attention: "negative",
    dependency: "neutral",
    capacity: "neutral",
    paused: "neutral",
    taken: "neutral",
  },
  waiting: { approval: "info", question: "warning", attention: "negative", merge: "positive" },
  run: {
    running: "progress",
    succeeded: "positive",
    failed: "negative",
    stopped: "neutral",
    lost: "warning",
  },
  node: { done: "positive", running: "progress", failed: "negative", pending: "neutral" },
  gates: { pass: "positive", fail: "negative", MISCONFIGURED: "warning" },
  review: { accept: "positive", revise: "warning", escalate: "negative" },
  severity: { blocking: "negative", minor: "neutral" },
  verify: { pass: "positive", fail: "negative", blocked: "warning" },
  risk: { low: "neutral", normal: "neutral", high: "warning" },
} as const satisfies Record<string, Record<string, Tone>>;

/** The tone of a value of one kind of state; a value the table does not know is neutral. */
export function toneOf(kind: keyof typeof tones, value: string | null | undefined): Tone {
  if (!value) return "neutral";
  return (tones[kind] as Record<string, Tone>)[value] ?? "neutral";
}
