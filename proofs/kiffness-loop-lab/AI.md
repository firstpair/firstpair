# AI Collaboration Notes

This proof exists so a future AI can understand the book without reverse
engineering the repository.

## What This Is

`First Pair Loop Lab` is a small proof book adapted from the Kiffness controller
manual workflow. The original local iCloud path was not directly readable from
this shell because of macOS permissions, so the proof used the pushed
`alexy/music` repository as source evidence and kept the new text compact.

## What To Preserve

- Keep `manuscript.md` readable as prose.
- Keep build behavior in scripts, not in memory.
- Keep generated utmac source in `dist/` so humans and AIs can inspect the
  Bell Labs edition without needing to run the converter first.
- Treat `dist/VERSION.md` as the artifact contract.

## What AI May Do

- Propose chapter order.
- Convert Markdown into `.ms` and `.tr` forms.
- Check generated artifact names and page counts.
- Note toolchain warnings, especially from utmac font configuration.

## What AI Must Not Do

- Hide source changes in generated artifacts.
- Publish or deliver to iCloud without an explicit human request.
- Treat AI notes as a substitute for manuscript edits.
