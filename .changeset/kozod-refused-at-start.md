---
"@kozo/daemon": patch
---

A factory definition that kozod refuses when it starts is now logged to `kozod.log` and notified, as one refused while kozod runs already was; kozod still goes on with the definition it last applied.
