---
"@kozo/verify": patch
---

On Linux, the sandbox hides each path at its real path and only once, so kozod starts where `/var/run` links to `/run` and Docker's socket exists, as on Ubuntu 24.04, instead of refusing with `Can't create file at /var/run/docker.sock`.
