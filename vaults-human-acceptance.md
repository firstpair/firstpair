# Vaults: Human Acceptance

## Purpose

Automated migration QA is complete. Human acceptance remains intentionally
separate: a reader must confirm that each candidate is at least as usable as
the established vault it may eventually replace. This review does not
authorize publication or replacement.

The immediate acceptance set is Cicero on Himself at source revision
`319e9b4f899401945f3022f5509fa4c2083bd00f`:

| Product | Established baseline | Sealed candidate |
| --- | --- | --- |
| Desktop | `~/src/cicero/book/dist-obsidian/Cicero on Himself Vault` | `~/src/cicero/book/dist-obsidian/Cicero on Himself Candidate` |
| Mobile | `~/src/cicero/book/dist-obsidian/Cicero on Himself Mobile Vault` | `~/src/cicero/book/dist-obsidian/Cicero on Himself Mobile Candidate` |
| Preview | `~/src/cicero/book/dist-obsidian/Cicero on Himself Preview Vault` | `~/src/cicero/book/dist-obsidian/Cicero on Himself Preview Candidate` |

Automated validation, differential QA, deterministic archive comparison, ZIP
integrity, desktop/phone rendering, and publication dry-run all pass. The
candidate archives and screenshots are under
`~/src/books-local-backups/firstpair-vault-candidates/`.

## Preserve the evidence

Do not open the baseline or sealed candidate directories directly in
Obsidian. Obsidian can rewrite workspace, plugin, and index files. Make a
disposable review copy of each vault first. Keep the baseline and candidate
copies visibly distinct, and never enable Sync on them.

Before copying, quit Obsidian completely. Then, from zsh, use Finder or a
recursive copy that preserves filenames and metadata. A suitable review area
is:

```zsh
mkdir -p ~/src/books-local-backups/vault-human-review/cicero-319e9b4
cp -R \
  ~/src/cicero/book/dist-obsidian/'Cicero on Himself Vault' \
  ~/src/books-local-backups/vault-human-review/cicero-319e9b4/desktop-baseline
cp -R \
  ~/src/cicero/book/dist-obsidian/'Cicero on Himself Candidate' \
  ~/src/books-local-backups/vault-human-review/cicero-319e9b4/desktop-candidate
cp -R \
  ~/src/cicero/book/dist-obsidian/'Cicero on Himself Mobile Vault' \
  ~/src/books-local-backups/vault-human-review/cicero-319e9b4/mobile-baseline
cp -R \
  ~/src/cicero/book/dist-obsidian/'Cicero on Himself Mobile Candidate' \
  ~/src/books-local-backups/vault-human-review/cicero-319e9b4/mobile-candidate
cp -R \
  ~/src/cicero/book/dist-obsidian/'Cicero on Himself Preview Vault' \
  ~/src/books-local-backups/vault-human-review/cicero-319e9b4/preview-baseline
cp -R \
  ~/src/cicero/book/dist-obsidian/'Cicero on Himself Preview Candidate' \
  ~/src/books-local-backups/vault-human-review/cicero-319e9b4/preview-candidate
```

Open only one review copy at a time. Quit Obsidian between products so cached
plugin state from one vault cannot disguise a first-open failure in another.

## Acceptance method

Review each baseline and candidate as a pair. Perform the same task in the
baseline first, then in the candidate. Record `pass`, `regression`, or `not
applicable` for every item. A candidate passes only if it has no material
regression and no unresolved privacy, provenance, navigation, or data-loss
concern.

For every defect, record:

- product and viewport;
- exact starting note and clicks or keystrokes;
- expected and observed result;
- screenshot or short screen recording;
- whether the baseline behaves differently;
- severity: blocking, significant, or cosmetic.

Do not repair a review copy and call it accepted. Report the defect so it can
be fixed in source and the candidate can be regenerated reproducibly.

## Common first-open review

Complete this section for desktop, mobile, and preview candidates.

- [ ] Obsidian opens the vault without a missing-folder, corruption, or
      restricted-mode surprise.
- [ ] The intended Home note is the obvious first entry point.
- [ ] Home explains what edition this is and gives a clear next action.
- [ ] The Vault Guide is welcoming to a first-time Obsidian user and explains
      installation, trust, navigation, search, links, updates, and recovery.
- [ ] Guide links reach the common handbook and the correct book-specific
      destinations.
- [ ] The initial layout has no private paths, developer tabs, stale searches,
      missing panes, or unrelated recent files.
- [ ] Text is readable at the default zoom without clipped headings, horizontal
      scrolling, overlapping controls, or illegible contrast.
- [ ] Internal links, backlinks, hover previews, history, and search behave as
      described in the Guide.
- [ ] Closing and reopening the vault returns to a sensible reading state.
- [ ] No unexpected network, login, Sync, installer, or permission prompt is
      required for ordinary reading.

## Cicero content and provenance review

- [ ] Move from the Reader to at least five cited passages distributed across
      early, middle, and late material.
- [ ] For each sample, confirm the quotation, translation, citation, witness,
      and source metadata agree.
- [ ] Follow links in both directions: Reader to source or anthology and back
      to the reading context.
- [ ] Test at least one Latin-to-English and one English-to-Latin navigation
      path.
- [ ] Confirm diacritics, apostrophes, em dashes, Greek, and Latin text render
      correctly and remain searchable.
- [ ] Inspect one known gap or qualified claim and confirm uncertainty is
      visible rather than presented as settled fact.
- [ ] Confirm rights and provenance notes are understandable and do not expose
      local machine paths or private research material.
- [ ] Compare representative illustrations and captions with the baseline for
      crop, resolution, attribution, and reading order.

## Desktop acceptance

- [ ] Review the complete Reader structure and confirm all major parts and
      navigation indexes are discoverable.
- [ ] Exercise the richer source, claim, derivative, bilingual-passage, gap,
      visual, and attachment collections from their intended indexes.
- [ ] Confirm the graph and backlinks assist provenance exploration without
      becoming the only way to navigate.
- [ ] Resize the window from a laptop-sized view to a large desktop view and
      check long quotations, tables, callouts, images, and footnotes.
- [ ] Disable and re-enable the book Reader plugin, then confirm the vault still
      has a usable Markdown fallback and recovers without lost state.
- [ ] Compare startup, search, navigation, and page-change responsiveness with
      the baseline. Record any repeated delay that is noticeable to a reader.
- [ ] Confirm that the candidate's removal of unsafe workspace paths causes no
      loss of useful baseline behavior.

## Mobile acceptance

Use a real phone or tablet if available. A narrow desktop window is useful but
is not a substitute for touch, the mobile keyboard, or the mobile Obsidian
runtime.

- [ ] Transfer a disposable copy to the device without enabling Sync against a
      working vault.
- [ ] Open from a cold start and confirm Home and the compact Reader appear
      promptly.
- [ ] Navigate with touch through several chapters, bilingual passages,
      illustrations, Back, and forward history.
- [ ] Open and dismiss the keyboard while searching; confirm it does not cover
      essential results or controls.
- [ ] Rotate portrait to landscape and back without clipped text or lost
      reading position.
- [ ] Test links near screen edges, long titles, footnotes, callouts, images,
      and text selection.
- [ ] Put Obsidian in the background, return to it, then quit and relaunch;
      confirm the Reader remains coherent.
- [ ] Compare perceived startup and navigation performance with the mobile
      baseline.
- [ ] Confirm the intentionally compact edition still contains everything the
      mobile Guide promises; absence of desktop-only research collections is
      clearly explained.

## Preview acceptance

- [ ] Confirm the preview identifies itself as a preview everywhere a reader
      could reasonably mistake it for the full edition.
- [ ] Confirm its contents, part and chapter counts, and stopping boundary
      match the public description.
- [ ] Follow every primary path from Home through the available Reader and
      source material; the smaller edition should contain no dead-end sales or
      placeholder navigation.
- [ ] Confirm omitted full-edition material is not leaked through search,
      backlinks, attachments, caches, or plugin data.
- [ ] Confirm the preview provides enough bilingual and provenance material to
      demonstrate the book honestly without suggesting unsupported coverage.
- [ ] Compare the preview vault with the current firstpair.org description and
      Vault Guide. Record any promise the artifact does not fulfill.

## Accessibility and safety review

- [ ] Navigate the main reading path by keyboard alone on desktop.
- [ ] Check headings and link labels for meaningful names rather than generic
      `click here` instructions.
- [ ] Check light and dark themes for readable contrast and illustrations that
      do not disappear into the background.
- [ ] Increase text size substantially and confirm reading and navigation
      remain usable.
- [ ] Confirm the candidate contains no credentials, tokens, email archives,
      personal notes, absolute home-directory paths, device names, or private
      Sync configuration.
- [ ] Confirm external links are clearly external and point to the expected
      destinations before opening them.

## Acceptance record

Complete one record per product and retain it beside the visual evidence.

```markdown
### Cicero <desktop|mobile|preview> acceptance

- Candidate source revision: 319e9b4f899401945f3022f5509fa4c2083bd00f
- Reviewer:
- Date:
- Obsidian version:
- Operating system and device:
- Baseline reviewed:
- Candidate reviewed:
- Common first-open: pass / fail
- Content and provenance: pass / fail
- Product-specific behavior: pass / fail
- Accessibility and safety: pass / fail
- Blocking defects:
- Significant defects:
- Cosmetic defects:
- Evidence directory:
- Decision: accept / reject / accept after listed fixes
- Notes:
```

The three product decisions roll up as follows:

| Product | Reviewer | Decision | Blocking issues | Evidence |
| --- | --- | --- | --- | --- |
| Desktop | | Pending | | |
| Mobile | | Pending | | |
| Preview | | Pending | | |

## After human review

If any product is rejected, preserve the report and review copy, fix the
source or shared FirstPair tooling, regenerate all affected products, and
repeat automated and human comparison. Do not patch the generated candidate.

If all three products are accepted:

1. commit the completed acceptance record and any non-sensitive evidence
   index;
2. retain the old vault archives as rollback artifacts;
3. make a separate, explicit decision about which candidate becomes the
   delivered desktop, mobile, or preview vault;
4. run the clean-and-pushed publication preflight again immediately before any
   outward-facing replacement;
5. publish through the standard FirstPair workflow and verify the downloaded
   artifacts from firstpair.org on desktop and mobile.

Human acceptance is complete only after the checklist and decision table are
filled in. Publication remains a later, separately authorized operation.
