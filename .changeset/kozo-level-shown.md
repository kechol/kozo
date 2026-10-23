---
"@kozo/core": patch
"@kozo/daemon": patch
---

The autonomy level that `kozo ls items` and the dashboard show for an item without a requested class is now the one kozod runs it at: the lower of the default level and the drafted class's, where it used to show the drafted class's alone.
