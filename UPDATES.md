# Pending updates for other machines

Work done on one machine that another machine has to finish, because the
vaults or inputs it needs live there. Delete an entry once it is done.

## FirstPair Triptych 3.8.0 into the Triptych vaults on Capitola

Recorded 2026-11-02. Triptych 3.8.0 (firstpair-reader `1ca3fbf`) makes the
Reader's top bar icon-only. Previous moves to the left end and Next to the
right end. Each button's name and destination are now its tooltip and
aria-label. On a phone the icons fill the first row from edge to edge, and
Review and the progress line wrap onto a second row. Nothing else changed:
the ledger, the payloads and `data.json` are untouched. The only Triptych
vaults on the laptop are the E·I·C ones, and they already run 3.8.0. Every
other Triptych vault is on Capitola and still runs 3.7.2 or older.

1. Pull:
   - `~/src/firstpair-reader` to `1ca3fbf` or later;
   - `~/src/two-republics` to `23f8aa0` or later. It adds the E·I·C vault,
     `stop_before` in edition specs, and figure pages named by their caption.
2. Close Obsidian (`pgrep -x Obsidian` prints nothing).
3. Update each vault that has `.obsidian/plugins/firstpair-triptych/`.
   To find them:
   `find ~ -path '*/.obsidian/plugins/firstpair-triptych/manifest.json' 2>/dev/null`.
   The vaults known from two-republics AGENTS.md / EDITIONS.md:
   - Lighthouse Republics Vault and its Preview Vault;
   - Le Repubbliche del Faro Vault and its Preview Vault;
   - Республики-маяки Vault and its Preview Vault;
   - Lighthouse Republics EN-RU Vault;
   - Республики-маяки 4.1–4.3 Vault;
   - The Invented Enemy EN-RU Vault
     (`~/src/russophobia/book/dist-obsidian/`).

   Two ways to update a vault:
   - Rebuild it with its usual builder. The builders install the plugin from
     firstpair-reader `HEAD` via `scripts/obsidian_triptych_contract.py`, and
     they keep `Preferences/` and `.obsidian/`.
   - Or copy just the three release files, which keeps everything else:

     ```sh
     src=~/src/firstpair-reader/plugins/firstpair-triptych
     for v in "<vault>" ...; do
       cp "$src"/{main.js,manifest.json,styles.css} "$v/.obsidian/plugins/firstpair-triptych/"
     done
     ```

     Copying is enough for this release, because only the plugin changed.
4. Check each one:
   `grep '"version"' "<vault>/.obsidian/plugins/firstpair-triptych/manifest.json"`
   should show `3.8.0`.
5. Vaults on Obsidian Sync upload the plugin the next time Obsidian opens
   them. On each phone, quit Obsidian and reopen it to load 3.8.0.
6. Delete this entry and push.
