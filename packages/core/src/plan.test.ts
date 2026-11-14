import { describe, expect, test } from "bun:test";
import { parseYamlDocument } from "./document.ts";
import { planSchema } from "./plan.ts";

const parse = (text: string) => parseYamlDocument(planSchema, text);

const example = `version: 1
item: app#212
class: refactor
risk: normal
approach: Put date formatting in one place and replace the screens' own versions
done_when:
  - Every date follows the user's time zone
tasks:
  - id: t1
    goal: Put date formatting in one place
    done_when: ["formatDate takes a time zone and its unit tests pass"]
    scope: ["src/date/**"]
    depends_on: []
    estimate: { lines: 120, files: 3 }
  - id: t2
    goal: Replace the screens' own formatting with formatDate
    done_when: ["src/ui calls toLocaleString nowhere"]
    scope: ["src/ui/**"]
    depends_on: [t1]
    estimate: { lines: 260, files: 7 }
`;

function issuesOf(text: string) {
  const result = parse(text);
  if (result.ok) throw new Error("expected the plan to be rejected");
  return result.issues;
}

describe("planSchema", () => {
  test("parses a plan with two tasks", () => {
    const result = parse(example);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tasks.map((task) => task.depends_on)).toEqual([[], ["t1"]]);
  });

  test("a missing field, an unknown field and a wrong version are issues", () => {
    expect(issuesOf(example.replace("risk: normal\n", ""))[0]).toStartWith("risk:");
    expect(issuesOf(example.replace("risk: normal", "risk: normal\nowner: me"))[0]).toStartWith(
      '<document>: Unrecognized key: "owner"',
    );
    expect(issuesOf(example.replace("version: 1", "version: 2"))[0]).toStartWith("version:");
  });

  test("the item must be an item reference", () => {
    expect(issuesOf(example.replace("item: app#212", "item: app#212/t1"))).toEqual([
      "item: Use K-<n> or <repo>#<n>",
    ]);
  });

  test("empty DONE_WHEN and an empty task list are issues", () => {
    expect(issuesOf(example.replace(/done_when:\n {2}- .*\n/, "done_when: []\n"))[0]).toStartWith(
      "done_when:",
    );
    expect(issuesOf(example.replace(/tasks:\n[\s\S]*$/, "tasks: []\n"))[0]).toStartWith("tasks:");
  });

  test("duplicate IDs and dependencies outside the plan are issues", () => {
    expect(issuesOf(example.replace("id: t2", "id: t1"))).toContain(
      "tasks.1.id: Task t1 is listed twice",
    );
    expect(issuesOf(example.replace("depends_on: [t1]", "depends_on: [t3]"))).toEqual([
      "tasks.1.depends_on.0: Task t3 is not in the plan",
    ]);
    expect(issuesOf(example.replace("depends_on: [t1]", "depends_on: [t2]"))).toEqual([
      "tasks.1.depends_on.0: A task cannot depend on itself",
    ]);
  });

  test("a task ID must be t<n>", () => {
    expect(issuesOf(example.replace("id: t2", "id: task2"))[0]).toStartWith("tasks.1.id:");
  });

  test("a codemod is one line of printable ASCII", () => {
    const withCodemod = (codemod: string) =>
      example.replace(
        "    depends_on: [t1]\n",
        `    depends_on: [t1]\n    codemod: ${JSON.stringify(codemod)}\n`,
      );
    expect(parse(withCodemod("npx codemod src/ui")).ok).toBe(true);
    for (const hidden of [
      "npx codemod\nrm -rf src",
      "npx codemod\rrm",
      "npx\u001b[2Kcodemod",
      "npx codemod \u202erm -rf\u202c",
      "npx\u200bcodemod",
      "npx codemod\u2028rm",
    ]) {
      expect(issuesOf(withCodemod(hidden))).toEqual([
        "tasks.1.codemod: Write the codemod as one line of printable ASCII characters",
      ]);
    }
  });
});
