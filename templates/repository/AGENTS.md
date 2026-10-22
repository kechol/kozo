# Agent instructions

These instructions are for every coding agent working in this repository, kozo's included.

## The repository

Describe what this repository is, how it is laid out and how to build and test it.

## Conventions

List the conventions an agent must follow here: naming, error handling, tests, commit
messages. Keep each rule short and checkable.

## Rules and how they are enforced

| Rule | Enforced by |
| --- | --- |
| Existing tests are not changed | kozo diff-guard (`.kozo/charter.yml`: `existing_tests_protected`) |
| Protected paths are not changed unattended | kozo diff-guard (`.kozo/charter.yml`: `protected_paths`) |
| Every change keeps the gates green | kozo gates (`.kozo/constraints.yml`) |
