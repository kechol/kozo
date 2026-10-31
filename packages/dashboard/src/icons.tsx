import type { JSX } from "preact";
import type { Tone } from "./tone.ts";

/** The glyphs the page draws, on a 16 px grid with 1.5 px strokes, drawn for kozo. */
const shapes = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  alert: <path d="M8 2.5l6 11H2zM8 6.5v3M8 11.5h.01" />,
  question: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M6.3 6.4a1.75 1.75 0 013.4.6c0 1.2-1.7 1.4-1.7 2.4M8 11.5h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  pause: <path d="M6 4v8M10 4v8" />,
  play: <path d="M5.5 3.8v8.4L12 8z" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  "arrow-up": <path d="M8 12.5v-9M4.5 7L8 3.5 11.5 7" />,
  "arrow-down": <path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" />,
  "chevron-down": <path d="M4.5 6.5L8 10l3.5-3.5" />,
  circle: <circle cx="8" cy="8" r="5.75" />,
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
  merge: (
    <>
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="8" r="1.5" />
      <path d="M5 5v6M5 5c0 2.5 2 3 5 3" />
    </>
  ),
  "pull-request": (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="12.5" r="1.5" />
      <path d="M4.5 5v6M11.5 11V6.5a2 2 0 00-2-2H7.5M9 3L7.5 4.5 9 6" />
    </>
  ),
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof shapes;

export const iconNames = Object.keys(shapes) as IconName[];

/** The glyph a tone shows beside its colour, so that no state is told by colour alone. */
export const toneIcon: Record<Tone, IconName> = {
  info: "dot",
  progress: "clock",
  warning: "alert",
  negative: "x",
  positive: "check",
  done: "merge",
  neutral: "circle",
};

/** A glyph that decorates text beside it, so it is hidden from assistive technology. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}
