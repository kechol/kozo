import { describe, expect, test } from "bun:test";
import { parseEvalCase } from "./eval-case.ts";

const upstream = `version: 1
id: hono-5083
repository: honojs/hono
start: 0fc7ffc94988d0dce19477d3e1cce29f3c2da1cb
request:
  issue: https://github.com/honojs/hono/issues/5083
  title: "etag middleware ignores If-None-Match: *"
  bodySha256: ${"ab".repeat(32)}
expected:
  outcome: complete
  prepare: "bun install --frozen-lockfile"
  hidden:
    commit: 2126289c15b0f87fb928645c4ed92d0f81d21cd4
    paths:
      - src/middleware/etag/index.test.ts
  checks:
    - "bunx vitest --run src/middleware/etag/index.test.ts"
  reference: 2126289c15b0f87fb928645c4ed92d0f81d21cd4
`;

describe("parseEvalCase", () => {
  test("reads a case from an upstream issue and one with its own request and files", () => {
    expect(parseEvalCase(upstream)).toMatchObject({
      ok: true,
      value: { id: "hono-5083", expected: { outcome: "complete" } },
    });
    const own = `version: 1
id: shop-low-stock
repository: kechol/kozo-sample-shop
start: eval/shop-low-stock
request:
  title: Show when only a few units are left
  body: Say Only N left.
expected:
  outcome: split
  why: It spans the catalog and checkout.
  forbidden:
    - implements it as a single task
  hidden:
    files:
      e2e/low-stock.spec.ts: shop-low-stock/low-stock.spec.ts
`;
    expect(parseEvalCase(own).ok).toBe(true);
  });

  test("refuses an unknown outcome, a request with neither body nor issue, and a bad id", () => {
    expect(parseEvalCase(upstream.replace("outcome: complete", "outcome: merged")).ok).toBe(false);
    expect(parseEvalCase(upstream.replace(/ {2}issue: .*\n/, "")).ok).toBe(false);
    expect(parseEvalCase(upstream.replace("id: hono-5083", "id: Hono 5083")).ok).toBe(false);
  });
});
