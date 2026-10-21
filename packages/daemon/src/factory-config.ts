import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type Factory, factorySchema, type KozoHome } from "@kozo/core";

/** The factory kozod runs when `factory.yml` is absent: local mode and no repositories yet. */
export const builtInFactory: Factory = {
  version: 1,
  mode: "local",
  runtime: "sdk",
  repositories: [],
  agent_defaults: { model: "claude-sonnet-5-5" },
  concurrency: 1,
  budget: { daily_usd: 15 },
};

/** A factory.yml that does not parse or that asks for something P2a cannot run. */
export class FactoryConfigError extends Error {}

function expandHome(path: string): string {
  return resolve(
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path,
  );
}

/** Reads `factory/factory.yml` over the built-in defaults, key by key, and checks the result. */
export async function loadFactory(home: KozoHome): Promise<Factory> {
  const file = Bun.file(join(home.factory, "factory.yml"));
  let overrides: unknown = {};
  if (await file.exists()) {
    try {
      overrides = Bun.YAML.parse(await file.text()) ?? {};
    } catch (error) {
      throw new FactoryConfigError(`factory.yml: ${(error as Error).message}`);
    }
  }
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    throw new FactoryConfigError("factory.yml: expected a mapping");
  }
  const result = factorySchema.safeParse({ ...builtInFactory, ...overrides });
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<document>"}: ${issue.message}`,
    );
    throw new FactoryConfigError(`factory.yml: ${issues.join("; ")}`);
  }
  const factory = result.data;
  if (factory.mode !== "local")
    throw new FactoryConfigError("factory.yml: only mode: local runs in this version");
  if (factory.runtime !== "sdk")
    throw new FactoryConfigError("factory.yml: only runtime: sdk runs in this version");
  return {
    ...factory,
    repositories: factory.repositories.map((repository) => ({
      ...repository,
      path: expandHome(repository.path),
    })),
  };
}
