import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { emptyState, kozoHome } from "@kozo/core";
import { exampleCharter, gitRepository, said, tempDirectory } from "@kozo/testing";
import { defaultBranch, readDefinition } from "@kozo/verify";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { formatItemFile, parseItemFile, readItemFile } from "./item-file.ts";
import { readCharter } from "./repository.ts";

async function definitionWith(repository: string, home: string) {
  await mkdir(join(home, "factory"), { recursive: true });
  await Bun.write(
    join(home, "factory", "factory.yml"),
    `repositories:\n  - { path: ${repository} }\n`,
  );
  const loaded = await readDefinition(kozoHome(home).factory, null);
  if (!loaded.ok) throw new Error(loaded.issues.join("; "));
  return { current: loaded.definition };
}

describe("item files", () => {
  test("format and parse back, keeping a human's edits to the body", () => {
    const text = formatItemFile({
      repository: "/src/shop",
      class: "bugfix",
      title: "Reject a blank quantity",
      body: "Adding an empty quantity creates a broken line.",
    });
    expect(text).toStartWith(
      "---\nversion: 1\nrepository: /src/shop\nclass: bugfix\n---\n\n# Reject",
    );
    const edited = `${text}\nAlso keep the cart as it was.\n`;
    expect(parseItemFile(edited)).toEqual({
      repository: "/src/shop",
      class: "bugfix",
      title: "Reject a blank quantity",
      body: "Adding an empty quantity creates a broken line.\n\nAlso keep the cart as it was.",
    });
    expect(() => parseItemFile("# no front matter\n")).toThrow("front matter");
    const spaced = formatItemFile({
      repository: "/src/my shop: two",
      class: null,
      title: "T",
      body: "",
    });
    expect(parseItemFile(spaced).repository).toBe("/src/my shop: two");
  });
});

describe("readCharter", () => {
  test("reads the Charter from the default branch and refuses one that is not ready", async () => {
    await using repo = await gitRepository();
    await repo.commit({ "README.md": "# shop\n" }, "start");
    expect(await defaultBranch(repo.path)).toBe("main");
    expect(await readCharter(repo.path, "local", emptyState())).toEqual({
      ok: false,
      reason: ".kozo/charter.yml is missing on main",
    });
    await repo.commit({ ".kozo/charter.yml": exampleCharter.replace("ready", "incomplete") });
    expect(await readCharter(repo.path, "local", emptyState())).toMatchObject({
      ok: false,
      reason: expect.stringContaining("incomplete"),
    });
    await repo.commit({ ".kozo/charter.yml": "version: 1\n" });
    expect(await readCharter(repo.path, "local", emptyState())).toMatchObject({ ok: false });
    await repo.commit({ ".kozo/charter.yml": exampleCharter });
    await repo.git("switch", "--quiet", "-c", "feature");
    await repo.commit({ ".kozo/charter.yml": "broken: [" });
    expect(await readCharter(repo.path, "local", emptyState())).toMatchObject({ ok: true });
  });
});

describe("ControlPlane.addItem", () => {
  async function setup(charter = exampleCharter) {
    const repo = await gitRepository();
    await repo.commit({ ".kozo/charter.yml": charter }, "start");
    const dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const store = await EventStore.open(home);
    const control = new ControlPlane(home, store, await definitionWith(repo.path, dir.path));
    return {
      repo,
      home,
      store,
      control,
      async [Symbol.asyncDispose]() {
        store.close();
        await dir[Symbol.asyncDispose]();
        await repo[Symbol.asyncDispose]();
      },
    };
  }

  test("an L1 item is written, recorded and waits for a start approval", async () => {
    await using env = await setup();
    const result = await env.control.addItem({
      title: "Reject a blank quantity",
      body: "Adding an empty quantity creates a broken line.",
    });
    expect(result).toMatchObject({
      ref: "K-1",
      message: { code: "api.added-waiting" },
      awaitingHuman: true,
    });
    expect(await readItemFile(env.home, "K-1")).toMatchObject({
      repository: env.repo.path,
      title: "Reject a blank quantity",
    });
    expect(env.store.state.items["K-1"]).toMatchObject({
      stage: "intake",
      hold: { kind: "approval", reason: { code: "hold.start-approval" } },
    });
  });

  test("an L2 item goes to Triage", async () => {
    await using env = await setup();
    const result = await env.control.addItem({ title: "Document the cart", class: "docs" });
    expect(said(result)).toBe("added K-1; it goes to Triage");
    expect(env.store.state.items["K-1"]).toMatchObject({ stage: "triage", hold: null });
  });

  test("an open item with the same title is a duplicate", async () => {
    await using env = await setup();
    await env.control.addItem({ title: "Reject a blank quantity" });
    await expect(env.control.addItem({ title: "  reject a   BLANK quantity" })).rejects.toThrow(
      "K-1 already asks for this",
    );
  });

  test("a repository without a ready Charter refuses the item with the reason", async () => {
    await using env = await setup(exampleCharter.replace("ready", "incomplete"));
    await expect(env.control.addItem({ title: "Anything" })).rejects.toThrow(
      "not accepted: .kozo/charter.yml on main is incomplete, not ready",
    );
    expect(env.store.state.items).toEqual({});
  });

  test("an unregistered repository is refused", async () => {
    await using env = await setup();
    await expect(
      env.control.addItem({ title: "Anything", repository: "/elsewhere" }),
    ).rejects.toThrow("/elsewhere is not a registered repository");
  });
});
