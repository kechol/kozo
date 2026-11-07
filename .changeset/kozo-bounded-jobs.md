---
"@kozo/daemon": patch
"@kozo/verify": patch
---

A fetch, push or `ls-remote` that the network holds up ends after five minutes instead of stopping kozod's polling, merge detection and automations behind it, and those jobs no longer pile up while one of them waits.
