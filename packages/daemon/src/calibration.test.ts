import { describe, expect, test } from "bun:test";
import { calibrate, calibrationLines, type Measured } from "./calibration.ts";

const task = (lines: number, stoppedForScope = false): Measured => ({
  class: "bugfix",
  estimate: { lines: 10, files: 2 },
  actual: stoppedForScope ? null : { lines, files: 4 },
  stoppedForScope,
});

describe("calibrate", () => {
  test("takes the median ratio of counted to estimated size and the share stopped for scope", () => {
    const measured = [task(10), task(20), task(30), task(15), task(25), task(0, true)];
    expect(calibrate(measured)).toEqual([
      { class: "bugfix", tasks: 6, lines: 2, files: 2, scope_blocks: 1 / 6 },
    ]);
  });

  test("leaves out a class with fewer than five measured diffs", () => {
    expect(calibrate([task(10), task(20), task(30), task(40), task(0, true)])).toEqual([]);
  });

  test("says each class in one line for the drafting agents", () => {
    expect(
      calibrationLines([
        { class: "feature", tasks: 8, lines: 2.04, files: 1.5, scope_blocks: 0.25 },
      ]),
    ).toEqual([
      "CALIBRATION feature: over 8 recent tasks here, diffs came to 2.0x the estimated lines and 1.5x the estimated files, and 25% stopped for their scope",
    ]);
  });
});
