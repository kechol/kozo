import type { ComponentChildren } from "preact";
import { Icon, type IconName, toneIcon } from "./icons.tsx";
import { type Tone, toneOf } from "./tone.ts";
import { t } from "./words.ts";

/** A state as a tinted label with its tone's glyph, or with a glyph closer to what it says. */
export function Badge({
  tone,
  icon = toneIcon[tone],
  children,
}: {
  tone: Tone;
  icon?: IconName;
  children: ComponentChildren;
}) {
  return (
    <span class={`badge ${tone}`}>
      <Icon name={icon} size={12} />
      {children}
    </span>
  );
}

/** What a hold, or a task awaiting merge, is called wherever it shows, by its approval when it has one. */
const holdLabel: Record<
  string,
  | "hold.start"
  | "hold.plan"
  | "hold.approval"
  | "hold.question"
  | "hold.attention"
  | "hold.merge"
  | "hold.taken"
> = {
  start: "hold.start",
  plan: "hold.plan",
  approval: "hold.approval",
  question: "hold.question",
  attention: "hold.attention",
  merge: "hold.merge",
  taken: "hold.taken",
};

/** Glyphs closer to what waits than its tone's own. */
const holdGlyph: Partial<Record<string, IconName>> = {
  question: "question",
  merge: "pull-request",
};

/**
 * A hold as a badge, the same in the inbox, on the board and in the detail view; `merge` stands
 * for a task awaiting merge, which is no hold but waits for the human all the same.
 */
export function HoldBadge({
  hold,
  approval = null,
}: {
  hold: string;
  approval?: "start" | "plan" | null;
}) {
  const tone = hold === "merge" ? toneOf("waiting", hold) : toneOf("hold", hold);
  const word = holdLabel[approval ?? hold];
  return (
    <Badge tone={tone} icon={holdGlyph[hold]}>
      {word ? t(word) : hold}
    </Badge>
  );
}
