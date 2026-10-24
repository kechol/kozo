---
"@kozo/core": patch
"@kozo/daemon": patch
"@kozo/verify": patch
"@kozo/worker": patch
---

With `runtime: cli`, a hook or tool call whose request or reply is larger than a socket takes at once now arrives whole instead of hanging or failing, text split mid-character is no longer garbled, and a Stop hook the worker cannot answer keeps the agent going instead of letting it stop unchecked. prepare's egress proxy closes a tunnel whose client left or whose token was revoked while it was still opening, stops reading from upstream once the client is gone, passes on everything upstream sent before it closed, and no longer reports a request without kozod's token. `kozo admin eval` stops its egress proxy even when a case throws, an eval teardown that cannot read the base documents no longer replaces the case's result, `kozo issue` opens the Issue with its intake label in one step so a failure leaves no Issue that a retry would open twice, and a kozod start that fails part way stops the proxy and the API server it started.
