# FirstPair Vault Builder

This directory contains the shared, compatibility-first Obsidian vault
toolchain. Book repositories own manuscripts, evidence maps, rights decisions,
and title-specific assertions. FirstPair owns deterministic projection,
packaging contracts, and differential QA. The standard Reader plugin and the
editorial Triptych plugin live in their own repository, `firstpair-reader`
(`$FIRSTPAIR_READER_ROOT`, default `~/src/firstpair-reader`); the builder
installs the Reader's release files as committed there
(`firstpair_vault/reader_plugin.py`, ref `$FIRSTPAIR_READER_REF`, default
`HEAD`). Plugin development is documented in that repository.

The builder has two independent axes:

- profile: `code`, `history`, or `triptych`;
- product: `desktop`, `mobile`, or `preview`.

Existing vaults remain authoritative until `firstpair-vault compare` reports no
hard regressions and the title-specific review is accepted. The comparison
never mutates either vault.

```sh
publishing/scripts/firstpair-vault plan vault.build.json --product desktop
publishing/scripts/firstpair-vault build vault.build.json --product desktop
publishing/scripts/firstpair-vault compare \
  --baseline '/path/to/working vault' \
  --candidate '/path/to/candidate vault' \
  --contract vault.qa.json
```

Do not run `build` while Obsidian is open. The CLI enforces the process gate on
macOS before writing a vault.
