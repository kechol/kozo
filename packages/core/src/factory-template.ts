import explorerAgent from "../../../templates/factory/agents/explorer/agent.md" with {
  type: "text",
};
import implementAgent from "../../../templates/factory/agents/implement/agent.md" with {
  type: "text",
};
import planAgent from "../../../templates/factory/agents/plan/agent.md" with { type: "text" };
import reviewAgent from "../../../templates/factory/agents/review/agent.md" with { type: "text" };
import triageAgent from "../../../templates/factory/agents/triage/agent.md" with { type: "text" };
import verifyAgent from "../../../templates/factory/agents/verify/agent.md" with { type: "text" };
import bugfixBlueprint from "../../../templates/factory/blueprints/bugfix.yml" with {
  type: "text",
};
import depsBlueprint from "../../../templates/factory/blueprints/deps.yml" with { type: "text" };
import docsBlueprint from "../../../templates/factory/blueprints/docs.yml" with { type: "text" };
import migrationBlueprint from "../../../templates/factory/blueprints/migration.yml" with {
  type: "text",
};
import perfBlueprint from "../../../templates/factory/blueprints/perf.yml" with { type: "text" };
import refactorBlueprint from "../../../templates/factory/blueprints/refactor.yml" with {
  type: "text",
};
import factoryYml from "../../../templates/factory/factory.yml" with { type: "text" };
import verifyAppSkill from "../../../templates/factory/skills/verify-app/SKILL.md" with {
  type: "text",
};

/**
 * kozo's built-in factory definition, by path: what `kozo admin init` writes, and what kozod
 * uses for a file the factory definition does not have.
 */
export const factoryTemplate = {
  "factory.yml": factoryYml,
  "agents/triage/agent.md": triageAgent,
  "agents/plan/agent.md": planAgent,
  "agents/implement/agent.md": implementAgent,
  "agents/review/agent.md": reviewAgent,
  "agents/verify/agent.md": verifyAgent,
  "agents/explorer/agent.md": explorerAgent,
  "skills/verify-app/SKILL.md": verifyAppSkill,
  "blueprints/bugfix.yml": bugfixBlueprint,
  "blueprints/deps.yml": depsBlueprint,
  "blueprints/docs.yml": docsBlueprint,
  "blueprints/refactor.yml": refactorBlueprint,
  "blueprints/perf.yml": perfBlueprint,
  "blueprints/migration.yml": migrationBlueprint,
} as const;
