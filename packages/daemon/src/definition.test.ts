import { describe, expect, test } from "bun:test";
import { type KozoHome, kozoHome } from "@kozo/core";
import { gitRepository, tempDirectory } from "@kozo/testing";
import {
  DefinitionError,
  refreshDefinition,
  type StartRefusal,
  startingDefinition,
} from "./definition.ts";
import { EventStore } from "./event-store.ts";

const review = (model?: string) =>
  `---\nname: review\ndescription: Reviews a diff.\n${model ? `model: ${model}\n` : ""}---\n\nReview it.\n`;

describe("applying the definition", () => {
  test("applies a valid commit, refuses an invalid one once and keeps the last applied", async () => {
    await using dir = await tempDirectory();
    await using repo = await gitRepository();
    const home: KozoHome = { ...kozoHome(dir.path), factory: repo.path };
    const store = await EventStore.open(home);
    const types = () =>
      store.db
        .query<{ type: string }, []>(
          "select type from events where type like 'factory.%' and type != 'factory.created' order by id",
        )
        .all()
        .map((row) => row.type);
    const reports: string[] = [];
    const report = (line: string) => reports.push(line);

    const first = await repo.commit({ "factory.yml": "concurrency: 2\n" });
    const inUse = { current: await startingDefinition(home, store) };
    expect(inUse.current.commit).toBe(first);
    expect(types()).toEqual(["factory.applied"]);

    const broken = await repo.commit({ "agents/review/agent.md": "no frontmatter\n" });
    await refreshDefinition(home, store, inUse, report);
    await refreshDefinition(home, store, inUse, report);
    expect(inUse.current.commit).toBe(first);
    expect(types()).toEqual(["factory.applied", "factory.refused"]);
    expect(store.state.definition).toEqual({ applied: first, refused: broken });
    expect(reports).toHaveLength(1);

    // At start, an invalid tip falls back to the last applied commit, and is handed back
    // as refused, recorded by the earlier refresh.
    const refusals: StartRefusal[] = [];
    expect((await startingDefinition(home, store, (r) => refusals.push(r))).commit).toBe(first);
    expect(refusals).toMatchObject([{ commit: broken, running: first, recorded: false }]);

    const fixed = await repo.commit({ "agents/review/agent.md": review() });
    await refreshDefinition(home, store, inUse, report);
    expect(inUse.current.commit).toBe(fixed);
    expect(inUse.current.factory.concurrency).toBe(2);
    expect(store.state.definition).toEqual({ applied: fixed, refused: null });
    store.close();
  });

  test("takes a change of mode only at the next start", async () => {
    await using dir = await tempDirectory();
    await using repo = await gitRepository();
    const home: KozoHome = { ...kozoHome(dir.path), factory: repo.path };
    const store = await EventStore.open(home);
    const reports: string[] = [];
    const first = await repo.commit({ "factory.yml": "concurrency: 2\n" });
    const inUse = { current: await startingDefinition(home, store) };
    const github = await repo.commit({ "factory.yml": "mode: github\nconcurrency: 2\n" });
    await refreshDefinition(home, store, inUse, (line) => reports.push(line));
    expect(inUse.current.commit).toBe(first);
    expect(store.state.definition).toEqual({ applied: first, refused: github });
    expect(reports[0]).toContain("mode changes from local to github only when kozod starts again");
    expect((await startingDefinition(home, store)).factory.mode).toBe("github");
    store.close();
  });

  test("refuses to start on an invalid definition that was never applied", async () => {
    await using dir = await tempDirectory();
    await using repo = await gitRepository();
    const home: KozoHome = { ...kozoHome(dir.path), factory: repo.path };
    const store = await EventStore.open(home);
    await repo.commit({ "factory.yml": "concurrency: none\n" });
    await expect(startingDefinition(home, store)).rejects.toThrow(DefinitionError);
    store.close();
  });
});
