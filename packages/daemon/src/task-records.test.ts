import { describe, expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { type FactoryState, kozoHome, runFiles, type TaskState } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import { evidenceFile, runRecords } from "./task-records.ts";

describe("evidenceFile", () => {
  test("serves a run's own evidence, images in place and anything else as a download", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const evidence = runFiles(home, "r-0001").evidence;
    await mkdir(join(evidence, "shots"), { recursive: true });
    await Bun.write(join(evidence, "shots", "cart.png"), "png");
    await Bun.write(join(evidence, "page.html"), "<script>alert(1)</script>");
    expect(await evidenceFile(home, "r-0001", "shots/cart.png")).toMatchObject({
      type: "image/png",
      inline: true,
    });
    expect(await evidenceFile(home, "r-0001", "page.html")).toMatchObject({
      type: "application/octet-stream",
      inline: false,
    });
  });

  test("serves nothing outside the run's evidence, through .. or a link, and no directory", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const evidence = runFiles(home, "r-0001").evidence;
    await mkdir(join(evidence, "shots"), { recursive: true });
    await Bun.write(home.apiToken, "secret");
    await Bun.write(join(runFiles(home, "r-0002").evidence, "other.png"), "png");
    await symlink(home.apiToken, join(evidence, "token.txt"));
    expect(await evidenceFile(home, "r-0001", "../../../api.token")).toBeNull();
    expect(await evidenceFile(home, "r-0001", "../../r-0002/evidence/other.png")).toBeNull();
    expect(await evidenceFile(home, "r-0001", "token.txt")).toBeNull();
    expect(await evidenceFile(home, "r-0001", "shots")).toBeNull();
    expect(await evidenceFile(home, "r-0009", "cart.png")).toBeNull();
  });
});

describe("runRecords", () => {
  test("reads a run's report and verdicts only as their schemas do", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const runs = ["r-0001", "r-0002", "r-0003"];
    const state = {
      runs: Object.fromEntries(runs.map((run) => [run, { agent: "implement" }])),
    } as unknown as FactoryState;
    const task = { runs } as unknown as TaskState;
    const report = { version: 1, summary: "Done", changes: [], out_of_scope: [], tests: [] };
    await Bun.write(
      runFiles(home, "r-0001").report,
      JSON.stringify({ ...report, outcome: "done" }),
    );
    await Bun.write(runFiles(home, "r-0001").verdict, JSON.stringify({ version: 1 }));
    await Bun.write(runFiles(home, "r-0002").report, JSON.stringify({ ...report, version: 2 }));
    await Bun.write(runFiles(home, "r-0002").verdict, "{ not json");
    await Bun.write(runFiles(home, "r-0003").verdict, JSON.stringify({ version: 1, extra: true }));
    const [first, second, third] = await runRecords(home, state, task);
    expect(first).toMatchObject({ report: { outcome: "done", summary: "Done" } });
    expect(first?.verdict).toEqual({ version: 1 });
    expect(second).toEqual({ run: "r-0002", report: null, verdict: {}, decisions: "" });
    expect(third).toEqual({ run: "r-0003", report: null, verdict: {}, decisions: "" });
  });
});
