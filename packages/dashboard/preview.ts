/**
 * Serves the dashboard against a mock local API with fictional data, so that every view and
 * state can be looked at without a factory. Nothing here reaches kozod.
 *
 *   bun packages/dashboard/preview.ts [--port 7421] [--empty] [--down]
 *
 * Open the address it prints. `--empty` serves an empty inbox and board, and `--down` answers
 * every list with an error, as when kozod cannot be reached.
 */
import { parseArgs } from "node:util";
import type { InboxRow, ItemRow, Status, TaskRow } from "./src/api.ts";
import page from "./src/index.html";

const { values: options } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", default: "7421" },
    empty: { type: "boolean", default: false },
    down: { type: "boolean", default: false },
  },
});

const now = Date.now();
const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const repository = "example/sample-shop";

const status: Status = {
  mode: "local",
  paused: false,
  pausedReason: null,
  activeRuns: 2,
  waiting: 5,
  costTodayUsd: 3.42,
  repositories: [repository, "example/sample-api"],
};

const inbox: InboxRow[] = [
  {
    kind: "item",
    ref: "K-14",
    title: "Add a dark mode toggle to the storefront header",
    waiting: "approval",
    reason: "start approval",
    approval: "start",
    since: at(190),
  },
  {
    kind: "item",
    ref: "K-12",
    title: "Show the delivery estimate on the cart page",
    waiting: "approval",
    reason: "plan approval",
    approval: "plan",
    since: at(75),
  },
  {
    kind: "task",
    ref: "K-9/t2",
    title: "Validate coupon codes before checkout submits",
    waiting: "question",
    reason:
      "The coupon API answers 404 for expired codes and 410 for revoked ones. Should both show the same message to the shopper?",
    approval: null,
    since: at(42),
  },
  {
    kind: "task",
    ref: "K-7/t1",
    title: "Upgrade the image pipeline to sharp 0.34",
    waiting: "attention",
    reason: "full gates failed at test after 3 revisions: tests/images.test.ts times out",
    approval: null,
    since: at(18),
  },
  {
    kind: "task",
    ref: "K-5/t1",
    title: "Fix the rounding of tax totals in the order summary",
    waiting: "merge",
    reason: null,
    approval: null,
    since: at(6),
  },
];

const item = (
  ref: string,
  title: string,
  stage: string,
  hold: string | null,
  workClass: string | null,
  level: string | null,
): ItemRow => ({
  ref,
  repository,
  title,
  stage,
  shown_stage: stage,
  hold,
  hold_reason: hold === "approval" ? "start approval" : hold,
  updated_at: at(30),
  class: workClass,
  level,
});

const items: ItemRow[] = [
  item("K-15", "Translate the returns policy page", "intake", null, null, null),
  item(
    "K-14",
    "Add a dark mode toggle to the storefront header",
    "triage",
    "approval",
    "feature",
    "L1",
  ),
  item(
    "K-12",
    "Show the delivery estimate on the cart page",
    "planning",
    "approval",
    "feature",
    "L2",
  ),
  item(
    "K-9",
    "Validate coupon codes before checkout submits",
    "building",
    "question",
    "bugfix",
    "L2",
  ),
  item("K-8", "Remove the unused analytics wrapper", "building", null, "refactor", "L3"),
  item("K-7", "Upgrade the image pipeline to sharp 0.34", "reviewing", "attention", "deps", "L2"),
  item(
    "K-5",
    "Fix the rounding of tax totals in the order summary",
    "handoff",
    null,
    "bugfix",
    "L2",
  ),
  item("K-3", "Document the local setup in the README", "complete", null, null, null),
  item("K-2", "Bump the lint config", "complete", null, null, null),
  item("K-1", "Try a new font stack", "cancelled", null, null, null),
];

const task = (
  ref: string,
  goal: string,
  stage: string,
  hold: string | null,
  revisions: number,
): TaskRow => ({
  ref,
  item: ref.split("/")[0] ?? ref,
  goal,
  stage,
  hold,
  hold_reason: hold,
  revisions,
  updated_at: at(20),
});

const tasks: TaskRow[] = [
  task("K-9/t1", "Reject malformed coupon codes on the client", "complete", null, 0),
  task("K-9/t2", "Validate coupon codes before checkout submits", "building", "question", 1),
  task("K-8/t1", "Remove the analytics wrapper and its callers", "building", null, 0),
  task("K-7/t1", "Upgrade the image pipeline to sharp 0.34", "reviewing", "attention", 3),
  task("K-5/t1", "Fix the rounding of tax totals in the order summary", "handoff", null, 1),
  task("K-3/t1", "Document the local setup in the README", "complete", null, 0),
];

const plan = {
  class: "feature",
  risk: "low",
  approach:
    "Compute the estimate on the server from the warehouse cut-off and the carrier's transit days, and show it under the cart total.",
  done_when: [
    "The cart shows an estimated delivery date for every item in stock",
    "Items out of stock show no estimate",
  ],
  tasks: [
    {
      id: "t1",
      goal: "Add an estimate endpoint that reads the carrier's transit days",
      done_when: [],
      scope: ["src/server/estimate.ts"],
      depends_on: [],
    },
    {
      id: "t2",
      goal: "Show the estimate under the cart total",
      done_when: [],
      scope: ["src/cart/**"],
      depends_on: ["t1"],
    },
  ],
};

const runs = [
  ["r-0031", "implement", "claude-sonnet-5-5", 140, 120],
  ["r-0034", "review", "claude-opus-5-5", 110, 100],
  ["r-0036", "implement", "claude-sonnet-5-5", 60, 40],
].map(([ref, agent, model, started, ended]) => ({
  ref,
  item: "K-5",
  task: "K-5/t1",
  parent: null,
  agent,
  model,
  state: "succeeded",
  started_at: at(Number(started)),
  ended_at: at(Number(ended)),
}));

function detailOf(ref: string) {
  if (/^r-\d+$/.test(ref)) {
    const run = runs.find((candidate) => candidate.ref === ref);
    return run ? { kind: "run", run, events: 42, cost_usd: 0.81 } : null;
  }
  if (ref.includes("/t")) {
    const found = tasks.find((candidate) => candidate.ref === ref);
    if (!found) return null;
    return {
      kind: "task",
      task: {
        ...found,
        done_when: [
          "The order summary rounds each line's tax half to even before summing",
          "A test covers an order whose line taxes sum to x.xx5",
        ],
        scope: ["src/orders/summary.ts", "src/orders/summary.test.ts"],
        depends_on: [],
      },
      runs,
    };
  }
  const found = items.find((candidate) => candidate.ref === ref);
  if (!found) return null;
  const drafting = found.stage === "planning";
  return {
    kind: "item",
    item: {
      ...found,
      hold_approval: drafting ? "plan" : null,
      plan: drafting ? null : plan,
      draft: drafting ? plan : null,
    },
    tasks: tasks.filter((candidate) => candidate.item === ref),
    runs: runs.filter((candidate) => candidate.item === ref),
    cost_usd: 1.27,
  };
}

const records = {
  report: {
    run: "r-0036",
    report: {
      summary: "Tax is now rounded per line, half to even, before the total is summed.",
      changes: [
        "src/orders/summary.ts: round each line's tax",
        "src/orders/summary.test.ts: add the x.xx5 case",
      ],
      out_of_scope: [
        {
          path: "src/orders/discount.ts",
          note: "Discounts round the same way and may need it too",
        },
      ],
    },
  },
  review: {
    run: "r-0034",
    verdict: {
      verdict: "accept",
      summary: "The change matches the plan and the test fails without it.",
      findings: [
        {
          severity: "minor",
          criterion: "naming",
          issue: "roundTax could say it rounds half to even",
        },
      ],
    },
  },
  verify: {
    run: "r-0036",
    verdict: {
      result: "pass",
      summary: "Both conditions hold.",
      conditions: [
        {
          condition: "The order summary rounds each line's tax half to even before summing",
          met: true,
          observation: "Checked three orders in the running app.",
          evidence: ["summary.txt"],
        },
        {
          condition: "A test covers an order whose line taxes sum to x.xx5",
          met: true,
          observation: "summary.test.ts has the case and fails without the change.",
          evidence: ["test-output.txt"],
        },
      ],
    },
  },
  decisions: [
    {
      run: "r-0036",
      text: "Rounded cents with Math.round rather than a decimal library, since the amounts stay far below 2^53.",
    },
  ],
  nodes: [
    ["claim", "done"],
    ["prepare", "done"],
    ["brief", "done"],
    ["implement", "done"],
    ["verify-deterministic", "done"],
    ["review", "done"],
    ["verify-app", "done"],
    ["handoff", "running"],
    ["final-verify", "pending"],
  ].map(([node, state]) => ({ node, state, summary: null })),
  latest: "r-0036",
  costUsd: 2.14,
};

const diff = `diff --git a/src/orders/summary.ts b/src/orders/summary.ts
index 3b18e51..a9c4f02 100644
--- a/src/orders/summary.ts
+++ b/src/orders/summary.ts
@@ -12,9 +12,13 @@ export function summarize(lines: Line[]): Summary {
   const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
-  const tax = Math.round(subtotal * rate);
+  const tax = lines.reduce((sum, line) => sum + roundTax(line.price * line.quantity * rate), 0);
   return { subtotal, tax, total: subtotal + tax };
 }
+
+function roundTax(cents: number): number {
+  return Math.round(cents);
+}
`;

const events = [
  ["run.started", { agent: "implement", model: "claude-sonnet-5-5" }, null],
  ["agent.message", { text: "I'll round each line's tax before summing." }, "implement"],
  ["tool.call", { tool: "Edit" }, "implement"],
  ["gates.result", { level: "full", status: "pass" }, "verify-deterministic"],
  ["review.verdict", { verdict: "accept", summary: "The change matches the plan" }, "review"],
  ["node.enter", {}, "verify-app"],
  ["node.exit", { ok: true, summary: "pass" }, "verify-app"],
  ["stage.changed", { target: "task", from: "reviewing", to: "handoff", reason: "verified" }, null],
].map(([type, data, node], index, all) => ({
  v: 1,
  ts: at((all.length - index) * 7),
  seq: index + 1,
  type,
  run_id: "r-0036",
  item: "K-5",
  task: "K-5/t1",
  node,
  data,
}));

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
const list = (rows: unknown[]) =>
  options.down
    ? json({ error: "kozod is not running" }, { status: 503 })
    : json(options.empty ? [] : rows);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(options.port),
  routes: {
    "/": page,
    "/api/dashboard/session": () => json({ token: "preview" }),
    "/api/status": () =>
      options.down ? json({ error: "kozod is not running" }, { status: 503 }) : json(status),
    "/api/ls/inbox": () => list(inbox),
    "/api/ls/items": () => list(items),
    "/api/ls/tasks": () => list(tasks),
  },
  fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    if (/^\/api\/refs\/.+\/records$/.test(path)) return json(records);
    if (/^\/api\/refs\/.+\/diff$/.test(path))
      return json({ base: "main", branch: "kozo/K-5-t1", diff, cut: false });
    if (/^\/api\/refs\/.+\/events$/.test(path)) {
      const body = events
        .map((event, index) => `id: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`)
        .join("");
      // The stream stays open, as kozod's does, so the page does not connect again.
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    const verb = /^\/api\/refs\/(.+)\/[a-z]+$/.exec(path);
    if (verb && request.method === "POST") return json({ message: `${verb[1]}: done` });
    const ref = /^\/api\/refs\/(.+)$/.exec(path);
    if (ref?.[1]) {
      const found = detailOf(ref[1]);
      return found ? json(found) : json({ error: `${ref[1]} does not exist` }, { status: 404 });
    }
    if (path.startsWith("/api/runs/"))
      return new Response("evidence", { headers: { "content-type": "text/plain" } });
    if (request.method === "POST") return json({ message: "done" });
    return json({ error: "not found" }, { status: 404 });
  },
});

console.log(`dashboard preview: ${server.url}#code=${"0".repeat(64)}`);
