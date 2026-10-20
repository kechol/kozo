# Changesets

Every user-visible change needs one. Run `bunx changeset`, pick the packages and
the bump level, and describe the change in a sentence or two. The text lands
verbatim in the changelog.

All `@kozo/*` packages form one fixed group, so they always share a version.
That version is the version of the `kozo` and `kozod` executables and of the
`v<version>` release tag.
