import type { ComponentChildren } from "preact";
import { Icon, type IconName, toneIcon } from "./icons.tsx";
import type { Tone } from "./tone.ts";

/** A state as a tinted label with its tone's glyph, or another glyph, or none. */
export function Badge({
  tone,
  icon,
  label,
  children,
}: {
  tone: Tone;
  icon?: IconName | null;
  /** What the badge stands for, for a short text such as a level. */
  label?: string;
  children: ComponentChildren;
}) {
  const glyph = icon === undefined ? toneIcon[tone] : icon;
  return (
    <span class={`badge ${tone}`} title={label}>
      {glyph ? <Icon name={glyph} size={12} /> : null}
      {children}
    </span>
  );
}
