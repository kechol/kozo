import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { claudeJudge } from "../packages/verify/src/index.ts";
import { badChanges, goodChange } from "../testing/src/index.ts";
import { caughtBy, failedToRun, type LayerOutcome, runLayers } from "./bad-changes/layers.ts";

// Usage: bun run scripts/bad-changes.ts --model claude-sonnet-5-5 [--model ...]
//          [--out .output/bad-changes]
// Runs the good change and every bad change through every layer, review once per model, with
// the installed claude. Each review is a paid model call.
const { values } = parseArgs({
  options: {
    model: { type: "string", multiple: true, default: [] },
    out: { type: "string", default: ".output/bad-changes" },
  },
});
const executable = Bun.which("claude");
if (executable === null) throw new Error("the claude CLI is not on PATH");
if (values.model.length === 0) throw new Error("name at least one --model");

const cases = [
  {
    id: "good-change",
    kind: "The change does what the task asks.",
    layer: "none",
    files: goodChange,
  },
  ...badChanges,
];

interface Row {
  id: string;
  layer: string;
  outcome: LayerOutcome;
  costUsd: number;
  seconds: number;
}

const report: Record<string, Row[]> = {};
for (const model of values.model) {
  const rows: Row[] = [];
  for (const change of cases) {
    let costUsd = 0;
    const judge = claudeJudge(executable);
    const metered = {
      judge: async (request: Parameters<typeof judge.judge>[0]) => {
        const answer = await judge.judge(request);
        costUsd += answer.costUsd;
        return answer;
      },
    };
    const started = performance.now();
    const outcome = await runLayers(change.files, { judge: metered, model });
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    rows.push({ id: change.id, layer: change.layer, outcome, costUsd, seconds });
    console.error(`${model} ${change.id}: ${JSON.stringify(outcome)}`);
  }
  report[model] = rows;
}

await mkdir(values.out, { recursive: true });
await Bun.write(`${values.out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

// A bad change is caught when its own layer, or any layer, rejects it; the good change must pass.
for (const [model, rows] of Object.entries(report)) {
  const good = rows.find((row) => row.id === "good-change");
  const bad = rows.filter((row) => row.id !== "good-change");
  const reviewCases = bad.filter((row) => row.layer === "review");
  const caught = bad.filter((row) => Object.values(caughtBy(row.outcome)).some(Boolean));
  const reviewCaught = reviewCases.filter((row) => caughtBy(row.outcome).review);
  const reviewFlagged = bad.filter((row) => caughtBy(row.outcome).review);
  const cost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  console.log(
    [
      `## ${model}`,
      `- good change: review ${good?.outcome.review}`,
      `- bad changes caught by some layer: ${caught.length}/${bad.length}`,
      `- review-only cases caught by review: ${reviewCaught.length}/${reviewCases.length}`,
      `- bad changes review rejected on its own: ${reviewFlagged.length}/${bad.length}`,
      `- cases where a layer failed to run: ${rows.filter((row) => failedToRun(row.outcome).length > 0).length}`,
      `- cost: $${cost.toFixed(4)}`,
      "",
      "| case | expected layer | gates | diff-guard | prove | review | cost |",
      "|---|---|---|---|---|---|---|",
      ...rows.map(
        (row) =>
          `| ${row.id} | ${row.layer} | ${row.outcome.gates} | ${row.outcome.diffGuard} | ${row.outcome.prove} | ${row.outcome.review} | $${row.costUsd.toFixed(4)} |`,
      ),
      "",
    ].join("\n"),
  );
}
