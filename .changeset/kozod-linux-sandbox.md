---
"@kozo/verify": minor
"@kozo/cli": patch
"@kozo/testing": patch
---

kozod confines the diff's commands on Linux with bubblewrap. The system is mounted read-only, the factory's home, credentials, the user's runtime directory and Docker's socket are hidden, and only the worktree, pnpm's locks and, for prepare, the package caches are writable. Every command but prepare runs in a network namespace of its own, so it reaches only its own loopback and the ports of its worktree (`KOZO_PORTS`) that this machine listens on when it starts, such as the database a repository's services started, which socat relays into it; a port nobody listens on stays the command's own. It sees empty /run and /tmp, so it reaches no Unix socket outside the paths it may write. Install socat for a repository whose gates use such services. A path that may not be written stays unwritten even before it exists. kozod refuses to start when `bwrap` is missing or cannot create namespaces, and `kozo check` reports it.
