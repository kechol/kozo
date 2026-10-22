import type { Charter, Plan, PlanTask } from "@kozo/core";
import { globMatcher, protectedPathMatcher } from "@kozo/verify";

/**
 * Checks a plan against the Charter and the files tracked at the tip of the default branch, and
 * returns the plan as kozod takes it with every issue that keeps kozod from taking it. The risk
 * tier comes from a session that read the request, so it may only raise the tier: a task whose
 * scope reaches a protected path or covers every file is high risk.
 */
export function checkPlan(
  plan: Plan,
  charter: Charter,
  files: readonly string[],
): { plan: Plan; issues: string[] } {
  const { limits, protected_paths } = charter;
  const issues: string[] = [];
  if (plan.tasks.length > limits.max_tasks_per_item) {
    issues.push(
      `the plan has ${plan.tasks.length} tasks, more than the Charter's max_tasks_per_item of ${limits.max_tasks_per_item}`,
    );
  }
  for (const task of plan.tasks) {
    if (task.estimate.lines > limits.max_changed_lines || task.estimate.files > limits.max_files) {
      issues.push(
        `${task.id} is estimated at ${task.estimate.lines} lines in ${task.estimate.files} files, over the Charter's ${limits.max_changed_lines} lines in ${limits.max_files} files`,
      );
    }
  }

  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const cycle = dependencyCycle(plan.tasks, byId);
  if (cycle) issues.push(`the dependencies form a cycle: ${cycle.join(" -> ")}`);

  // Tasks joined by a dependency run one after the other, so only the others must not overlap.
  const matchers = new Map(plan.tasks.map((task) => [task.id, globMatcher(task.scope)]));
  const overlap = (a: PlanTask, b: PlanTask) => {
    const inA = matchers.get(a.id) ?? (() => false);
    const inB = matchers.get(b.id) ?? (() => false);
    return a.scope.some(inB) || b.scope.some(inA) || files.some((path) => inA(path) && inB(path));
  };
  plan.tasks.forEach((a, index) => {
    for (const b of plan.tasks.slice(index + 1)) {
      if (reaches(a, b.id, byId) || reaches(b, a.id, byId) || !overlap(a, b)) continue;
      issues.push(`${a.id} and ${b.id} share scope, but neither depends on the other`);
    }
  });

  const carried = new Set(plan.tasks.flatMap((task) => task.done_when.map((text) => text.trim())));
  for (const condition of plan.done_when) {
    if (!carried.has(condition.trim()))
      issues.push(`no task's done_when repeats the item's DONE_WHEN condition "${condition}"`);
  }

  const guarded = protected_paths.map(protectedPathMatcher);
  const isProtected = (path: string) => guarded.some((matches) => matches(path));
  const high = plan.tasks.some((task) => {
    const inScope = matchers.get(task.id) ?? (() => false);
    return (
      (files.length > 0 && files.every(inScope)) ||
      task.scope.some(isProtected) ||
      protected_paths.some(inScope) ||
      files.some((path) => inScope(path) && isProtected(path))
    );
  });
  return { plan: high ? { ...plan, risk: "high" } : plan, issues };
}

/** Whether `from` depends on `target`, directly or through other tasks. */
function reaches(from: PlanTask, target: string, byId: ReadonlyMap<string, PlanTask>): boolean {
  const seen = new Set<string>();
  const pending = [...from.depends_on];
  while (pending.length > 0) {
    const id = pending.pop() ?? "";
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(byId.get(id)?.depends_on ?? []));
  }
  return false;
}

/** The first dependency cycle among `tasks`, as the IDs along it, or null when there is none. */
function dependencyCycle(
  tasks: readonly PlanTask[],
  byId: ReadonlyMap<string, PlanTask>,
): string[] | null {
  const done = new Set<string>();
  const visit = (id: string, path: string[]): string[] | null => {
    const start = path.indexOf(id);
    if (start !== -1) return [...path.slice(start), id];
    if (done.has(id)) return null;
    for (const next of byId.get(id)?.depends_on ?? []) {
      const cycle = visit(next, [...path, id]);
      if (cycle) return cycle;
    }
    done.add(id);
    return null;
  };
  for (const task of tasks) {
    const cycle = visit(task.id, []);
    if (cycle) return cycle;
  }
  return null;
}
