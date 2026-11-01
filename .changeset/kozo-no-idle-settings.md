---
"@kozo/core": minor
---

The Charter's `isolation` accepts only `worktree`, and a blueprint lists every node, `verify-app` included: `isolation: docker` and a blueprint without `verify-app` changed nothing, since verify runs as the risk tier decides. A factory definition whose `blueprints/docs.yml` came from an earlier template needs `verify-app` added after `review`.
