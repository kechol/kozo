import type { Automation } from "@kozo/core";
import type { ControlPlane } from "./control-plane.ts";

/**
 * Adds each automation's item in the minutes its schedule matches, once a minute however often
 * it is asked; a minute that passed while kozod was down is not made up.
 */
export class Automations {
  private lastMinute = "";

  constructor(
    private readonly control: ControlPlane,
    private readonly automations: () => readonly Automation[],
    private readonly report: (line: string) => void,
  ) {}

  async run(now: Date): Promise<void> {
    const minute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
    if (minute === this.lastMinute) return;
    this.lastMinute = minute;
    for (const automation of this.automations()) {
      if (!automation.schedule.matches(now)) continue;
      try {
        const added = await this.control.addAutomated(automation);
        this.report(
          "ref" in added
            ? `kozod: automation ${automation.name} added ${added.ref}`
            : `kozod: automation ${automation.name} added nothing: ${added.skipped}`,
        );
      } catch (error) {
        this.report(`kozod: automation ${automation.name} failed: ${(error as Error).message}`);
      }
    }
  }
}
