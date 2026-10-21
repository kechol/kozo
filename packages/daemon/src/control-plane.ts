import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { type AddItem, autonomyLevel, type Factory, isClosed, type KozoHome } from "@kozo/core";
import { CommandError, type VerbResult } from "./api.ts";
import type { EventStore } from "./event-store.ts";
import { itemPath, writeItemFile } from "./item-file.ts";
import { readCharter } from "./repository.ts";

const normalTitle = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The control plane: every decision about items, tasks and runs that can be made without a
 * model, each recorded as events through the store.
 */
export class ControlPlane {
  constructor(
    readonly home: KozoHome,
    readonly store: EventStore,
    readonly factory: Factory,
  ) {}

  private repositoryFor(requested: string | undefined): string {
    const registered = this.factory.repositories.map((repository) => repository.path);
    if (registered.length === 0) {
      throw new CommandError(422, "no repository is registered; add one to factory/factory.yml");
    }
    if (requested === undefined) {
      if (registered.length > 1) {
        throw new CommandError(400, `name the repository: ${registered.join(", ")}`);
      }
      return registered[0] ?? "";
    }
    const path = resolve(requested);
    const match = registered.find((repository) => repository === path);
    if (!match) throw new CommandError(422, `${requested} is not a registered repository`);
    return match;
  }

  /**
   * Intake: registers a local item after the Charter and duplicate checks. An item at L1 waits
   * for a start approval; any other goes on to Triage.
   */
  async addItem(body: AddItem): Promise<{ ref: string } & VerbResult> {
    const repository = this.repositoryFor(body.repository);
    const charter = await readCharter(repository);
    if (!charter.ok) throw new CommandError(422, `not accepted: ${charter.reason}`);
    const title = normalTitle(body.title);
    const duplicate = Object.values(this.store.state.items).find(
      (item) =>
        !isClosed(item.stage) &&
        item.repository === repository &&
        normalTitle(item.title) === title,
    );
    if (duplicate) throw new CommandError(409, `${duplicate.ref} already asks for this`);

    const ref = this.store.nextLocalItem();
    await writeItemFile(this.home, ref, {
      repository,
      class: body.class ?? null,
      title: body.title.trim(),
      body: body.body ?? "",
    });
    try {
      await this.store.append({
        type: "item.created",
        item: ref,
        data: { repository, title: body.title.trim(), source: "local" },
      });
    } catch (error) {
      await rm(itemPath(this.home, ref), { force: true });
      throw error;
    }
    if (autonomyLevel(charter.charter, body.class ?? null) === "L1") {
      await this.store.append({
        type: "hold.set",
        item: ref,
        data: { target: "item", hold: "approval", reason: "start approval" },
      });
      return {
        ref,
        message: `added ${ref}; it waits for your start approval`,
        awaitingHuman: true,
      };
    }
    await this.store.append({
      type: "stage.changed",
      item: ref,
      data: { target: "item", from: "intake", to: "triage" },
    });
    return { ref, message: `added ${ref}; it goes to Triage` };
  }
}
