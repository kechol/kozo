import type { ComponentChildren } from "preact";
import { Icon, type IconName, toneIcon } from "./icons.tsx";
import type { Tone } from "./tone.ts";

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
