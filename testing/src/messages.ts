import { type Message, render } from "@kozo/core";

/** The English sentence of a hold's reason, or undefined when there is no hold. */
export const reasonOf = (hold: { reason: Message } | null | undefined) =>
  hold ? render(hold.reason, "en") : undefined;
