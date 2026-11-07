# Agent instructions

These instructions are for every coding agent working in this repository, kozo's included.

## The repository

Describe what this repository is, how it is laid out and how to build and test it.

## Structure and boundaries

Name the modules and what each is for, which module may depend on which, and where new code of
each kind goes. Name the existing pieces a change should reuse rather than make again, such as
the error type, the data access layer or the shared UI components. kozo's planning reads this to
place each task, and review judges every diff against it.

## Conventions

List the conventions an agent must follow here: naming, error handling, tests, commit
messages. Keep each rule short and checkable.

## Rules and how they are enforced

| Rule | Enforced by |
| --- | --- |
| Existing tests are not changed | kozo diff-guard (`.kozo/charter.yml`: `existing_tests_protected`) |
| Protected paths are not changed unattended | kozo diff-guard (`.kozo/charter.yml`: `protected_paths`) |
| Every change keeps the gates green | kozo gates (`.kozo/constraints.yml`) |
| Modules depend on each other only as Structure and boundaries says | A boundaries gate in `.kozo/constraints.yml`, once there is one; review until then |
