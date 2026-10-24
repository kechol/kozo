---
"@kozo/core": minor
"@kozo/daemon": minor
"@kozo/verify": minor
---

prepare no longer reaches every host. kozod runs a proxy on 127.0.0.1 that tunnels HTTPS only to the package registries (npm, Yarn, PyPI, crates.io, the Go proxy, GitHub's downloads and Playwright's browsers) and to the hosts listed in `factory.yml`'s new `prepare_hosts`, a name or a `*.` suffix; prepare reaches only this machine, as the gates do, with `HTTPS_PROXY` set to the proxy, and kozod reports each host it refused once. A registry mirror must be listed in `prepare_hosts`.
