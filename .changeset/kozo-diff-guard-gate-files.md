---
"@kozo/cli": minor
---

`kozo diff-guard` reports a change to a file that a gate command runs: a script it names, such as `scripts/lint.sh`, or the task file its runner reads, such as the Makefile of `make test` or `make -C web test`, the justfile, Taskfile, Rakefile, `tox.ini` or `noxfile.py`.
