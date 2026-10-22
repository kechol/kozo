# Running the app for verification

kozo's verify agent follows this procedure to exercise a change in the running app. Replace
each part with the repository's own commands; without this file, verify does not run.

## Start

The commands that build the app and start its processes from the repository root, in the
background, with where their output and process IDs go.

## Check that it is ready

The commands that wait until every process answers, and how long to wait.

## Operate

The test-only accounts, data, pages and queries available for exercising the app.

## Evidence

Where to save screenshots, command output and logs, under `.output/verify/`, and how to name
them.

## Clean up

The commands that stop the processes and restore the data.
