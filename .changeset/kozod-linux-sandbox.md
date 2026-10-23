---
"@kozo/verify": minor
"@kozo/cli": patch
"@kozo/testing": patch
---

kozod confines the diff's commands on Linux with bubblewrap. The system is mounted read-only, the factory's home, credentials, the user's runtime directory and Docker's socket are hidden, and only the worktree, pnpm's locks and, for prepare, the package caches are writable. Every command but prepare runs in a network namespace of its own, so it reaches only its own loopback; a service the gates need on Linux must be started by the gates themselves, not as a `services` entry on the host. kozod refuses to start when `bwrap` is missing or cannot create namespaces, and `kozo check` reports it.
