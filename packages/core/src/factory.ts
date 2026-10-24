import { z } from "zod";
import { type ParseResult, parseYamlDocument } from "./document.ts";
import { agentNameSchema } from "./work-model.ts";

const githubRepository = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, "Use <owner>/<name>");

const agentSettings = z.strictObject({ model: z.string().min(1) });

export const repositorySchema = z.strictObject({
  path: z.string().min(1),
  github: githubRepository.optional(),
  /** In GitHub mode, only open Issues with this label become items. */
  label: z
    .string()
    .min(1)
    .refine((label) => !label.startsWith("kozo:"), "kozo: labels are kozo's own")
    .optional(),
});
export type Repository = z.infer<typeof repositorySchema>;

// The built-in defaults and `~` expansion belong to the loader; this checks only the shape.
export const factorySchema = z
  .strictObject({
    version: z.literal(1),
    mode: z.enum(["local", "github"]),
    runtime: z.enum(["sdk", "cli"]),
    repositories: z.array(repositorySchema),
    agent_defaults: agentSettings,
    agents: z.partialRecord(agentNameSchema, agentSettings).optional(),
    concurrency: z.int().positive(),
    budget: z.strictObject({ daily_usd: z.number().positive() }),
    /** Hosts prepare may reach besides the built-in registries: a name or a `*.` suffix. */
    prepare_hosts: z.array(z.string().regex(/^(\*\.)?[a-z0-9.-]+$/)).optional(),
  })
  .superRefine((factory, context) => {
    if (factory.mode !== "github") return;
    const names = new Set<string>();
    factory.repositories.forEach((repository, index) => {
      if (repository.github === undefined) {
        context.addIssue({
          code: "custom",
          path: ["repositories", index, "github"],
          message: "Name the GitHub repository in github mode",
        });
        return;
      }
      // GitHub-mode item references name a repository without its owner, as in `app#212`, and
      // GitHub treats names that differ only in case as one repository.
      const name = repository.github.replace(/^[^/]*\//, "").toLowerCase();
      if (names.has(name)) {
        context.addIssue({
          code: "custom",
          path: ["repositories", index, "github"],
          message: `Another repository is also named ${name}`,
        });
      }
      names.add(name);
    });
  });
export type Factory = z.infer<typeof factorySchema>;

export function parseFactory(text: string): ParseResult<Factory> {
  return parseYamlDocument(factorySchema, text);
}
