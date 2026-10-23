import { type AutonomyLevel, type Charter, type WorkClass, workClassSchema } from "./charter.ts";
import { autonomyLevel, demotionKey, type FactoryState, type TaskState } from "./state.ts";

/** How many merged diffs, all autonomous and free of defects, call for a promotion proposal. */
export const promotionWindow = 20;
/** The merged diffs whose share with a human's intervention can call for a demotion. */
export const interventionWindow = 10;
export const interventionLimit = 0.3;

const below: Record<AutonomyLevel, AutonomyLevel | null> = { L1: null, L2: "L1", L3: "L2" };

/** The level one below `level`, or null at L1. */
export const lowerLevel = (level: AutonomyLevel) => below[level];

/** The merged diffs of a class in a repository, the earliest merge first. */
function mergedDiffs(state: FactoryState, repository: string, workClass: WorkClass): TaskState[] {
  return Object.values(state.tasks)
    .filter(
      (task) =>
        task.merged !== null &&
        task.class === workClass &&
        state.items[task.item]?.repository === repository,
    )
    .sort((a, b) => ((a.merged?.at ?? "") < (b.merged?.at ?? "") ? -1 : 1));
}

/**
 * The Charter as kozod applies it in `repository`: each class kozod demoted there at the level it
 * lowered it to, while the Charter's text is still the one it demoted from.
 */
export function demotedCharter(
  state: FactoryState,
  repository: string,
  charter: Charter,
  charterSha: string,
): Charter {
  const levels = { ...charter.levels };
  for (const demotion of Object.values(state.demotions)) {
    if (demotion.repository !== repository || demotion.charterSha !== charterSha) continue;
    if (demotion.to < autonomyLevel(charter, demotion.class)) levels[demotion.class] = demotion.to;
  }
  return { ...charter, levels };
}

/**
 * Why a class of a repository is due a demotion, or null: a post-merge defect found, or a
 * human's intervention in more than 30 percent of its last ten merged diffs, since its last
 * demotion, whose evidence is spent.
 */
export function demotionDue(
  state: FactoryState,
  repository: string,
  workClass: WorkClass,
): string | null {
  const since = state.demotions[demotionKey(repository, workClass)]?.at ?? "";
  const diffs = mergedDiffs(state, repository, workClass);
  const defect = diffs.find((task) => task.defectAt !== null && task.defectAt > since);
  if (defect) return `a post-merge defect in ${defect.ref}`;
  const recent = diffs.filter((task) => (task.merged?.at ?? "") > since).slice(-interventionWindow);
  if (recent.length < interventionWindow) return null;
  const intervened = recent.filter((task) => task.intervened).length;
  return intervened / recent.length > interventionLimit
    ? `a human intervened in ${intervened} of the last ${recent.length} merged diffs`
    : null;
}

/**
 * The classes of a repository that the record calls to promote to L3: at L2 in `charter`, as
 * kozod applies it, with their last 20 merged diffs all autonomous and free of defects.
 */
export function promotionProposals(
  state: FactoryState,
  repository: string,
  charter: Charter,
): WorkClass[] {
  return workClassSchema.options.filter((workClass) => {
    if (autonomyLevel(charter, workClass) !== "L2") return false;
    const last = mergedDiffs(state, repository, workClass).slice(-promotionWindow);
    return (
      last.length === promotionWindow &&
      last.every((task) => !task.intervened && task.defectAt === null)
    );
  });
}
