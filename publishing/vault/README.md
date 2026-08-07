# FirstPair Vault Builder

This directory contains the shared, compatibility-first Obsidian vault
toolchain. Book repositories own manuscripts, evidence maps, rights decisions,
and title-specific assertions. FirstPair owns deterministic projection,
packaging contracts, the standard Reader plugin, and differential QA.

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
