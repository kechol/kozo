import { describe, expect, test } from "bun:test";
import { type Charter, type Plan, type PlanTask, parseCharter } from "@kozo/core";
import { suiteBase } from "@kozo/testing";
import { checkPlan } from "./plan-checks.ts";

const parsed = parseCharter(suiteBase[".kozo/charter.yml"] ?? "");
if (!parsed.ok) throw new Error(parsed.issues.join("; "));
const charter: Charter = parsed.value;

const files = ["src/stock.ts", "src/stock.test.ts", "docs/stock.md", "db/migrations/001.sql"];

const task = (id: string, fields: Partial<PlanTask> = {}): PlanTask => ({
  id,
  goal: `Goal of ${id}`,
  done_when: [`${id} is done`],
  scope: [`src/${id}/**`],
  depends_on: [],
  estimate: { lines: 20, files: 2 },
  ...fields,
});

const planOf = (tasks: PlanTask[], done_when = tasks.flatMap((entry) => entry.done_when)): Plan =>
  ({
    version: 1,
    item: "K-1",
    class: "bugfix",
    risk: "low",
    approach: "Change it",
    done_when,
    tasks,
  }) as Plan;

describe("checkPlan", () => {
  test("takes a plan of independent tasks with disjoint scopes as it is", () => {
    const plan = planOf([task("t1"), task("t2", { scope: ["docs/**"] })]);
    expect(checkPlan(plan, charter, files)).toEqual({ plan, issues: [] });
  });

  test("takes a migration as one chain from a task that characterizes", () => {
    const migration = (tasks: PlanTask[]) => ({ ...planOf(tasks), class: "migration" }) as Plan;
    const chain = [
      task("t1", { characterize: true }),
      task("t2", { depends_on: ["t1"], codemod: "npx codemod" }),
      task("t3", { depends_on: ["t2"] }),
    ];
    expect(checkPlan(migration(chain), charter, files).issues).toEqual([]);
    expect(
      checkPlan(
        migration([
          task("t1"),
          task("t2", { depends_on: ["t1"] }),
          task("t3", { depends_on: ["t1"] }),
          task("t4", { depends_on: ["t2", "t3"], characterize: true, codemod: "npx codemod" }),
        ]),
        charter,
        files,
      ).issues,
    ).toEqual([
      "a migration's tasks form one chain in order, so t3 depends on t2 alone",
      "a migration's tasks form one chain in order, so t4 depends on t3 alone",
      "a migration starts with a task that characterizes: t1 must add tests that pin the behaviour the migration keeps",
      "t4 characterizes, so it adds tests only and runs no codemod",
    ]);
  });

  test("refuses a dependency cycle", () => {
    const plan = planOf([
      task("t1", { depends_on: ["t3"] }),
      task("t2", { depends_on: ["t1"] }),
      task("t3", { depends_on: ["t2"] }),
    ]);
    expect(checkPlan(plan, charter, files).issues).toEqual([
      "the dependencies form a cycle: t1 -> t3 -> t2 -> t1",
    ]);
  });

  test("refuses overlapping scopes unless a dependency joins the tasks", () => {
    const shared = planOf([
      task("t1", { scope: ["src/**"] }),
      task("t2", { scope: ["src/stock.ts"] }),
    ]);
    expect(checkPlan(shared, charter, files).issues).toEqual([
      "t1 and t2 share scope, but neither depends on the other",
    ]);
    const byFile = planOf([
      task("t1", { scope: ["src/*.ts"] }),
      task("t2", { scope: ["src/stock*"] }),
    ]);
    expect(checkPlan(byFile, charter, files).issues).toHaveLength(1);
    const chained = planOf([
      task("t1", { scope: ["src/**"] }),
      task("t2", { scope: ["docs/**"], depends_on: ["t1"] }),
      task("t3", { scope: ["src/stock.ts"], depends_on: ["t2"] }),
    ]);
    expect(checkPlan(chained, charter, files).issues).toEqual([]);
  });

  test("refuses an item DONE_WHEN condition that no task repeats", () => {
    const plan = planOf([task("t1")], ["t1 is done", "The notice shows on the product page"]);
    expect(checkPlan(plan, charter, files).issues).toEqual([
      `no task's done_when repeats the item's DONE_WHEN condition "The notice shows on the product page"`,
    ]);
  });

  test("refuses too many tasks and tasks estimated over the limits, listing each", () => {
    const count = charter.limits.max_tasks_per_item + 1;
    const tasks = Array.from({ length: count }, (_, index) =>
      task(`t${index + 1}`, index === 1 ? { estimate: { lines: 61, files: 2 } } : {}),
    );
    expect(checkPlan(planOf(tasks), charter, files).issues).toEqual([
      `the plan has ${count} tasks, more than the Charter's max_tasks_per_item of ${charter.limits.max_tasks_per_item}`,
      "t2 is estimated at 61 lines in 2 files, over the Charter's 60 lines in 4 files",
    ]);
  });

  test("raises the risk of a task that reaches a protected path or covers every file", () => {
    for (const scope of [["db/**"], ["db/migrations/002.sql"], ["**"]]) {
      expect(checkPlan(planOf([task("t1", { scope })]), charter, files).plan.risk).toBe("high");
    }
    expect(checkPlan(planOf([task("t1")]), charter, files).plan.risk).toBe("low");
  });
});
