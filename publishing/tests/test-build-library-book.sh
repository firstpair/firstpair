#!/usr/bin/env bash
set -euo pipefail

firstpair_root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture_source="$firstpair_root/publishing/tests/fixtures/library-book"
builder="$firstpair_root/publishing/scripts/build-library-book.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

node --test "$firstpair_root/publishing/tests/test-pdf-layout.mjs"

cp -R "$fixture_source/." "$work/"
printf '%s  \n%s\n' \
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">' \
  '<text x="2" y="14">fixture</text></svg>' > "$work/fixture.svg"
printf '\n![Fixture diagram](fixture.svg)\n' >> "$work/manuscript.md"
# A committed fixture, so editions carry a real source commit.
git -C "$work" init -q
git -C "$work" add -A
git -C "$work" -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m fixture

"$builder" --repo-root "$work" --config single.book.build.json
"$builder" --repo-root "$work" --config dual.book.build.json
"$builder" both --repo-root "$work" --config preview-full.book.build.json

for dist in dist-single dist-dual dist-preview dist-full; do
  "$firstpair_root/publishing/scripts/verify-library-book.sh" "$work/$dist"
  if grep -RInE '[[:blank:]]+$' "$work/$dist" \
    --include='*.html' --include='*.css' --include='*.svg'; then
    echo "generated HTML/CSS/SVG contains trailing whitespace: $dist" >&2
    exit 1
  fi
done

find "$work/dist-single/firstpair-build-fixture-chapters" -type f -name '*.svg' | grep -q .

grep -q '^primary_format: typst$' "$work/dist-dual/VERSION.md"
grep -q '^html_title: FirstPair Build Fixture$' "$work/dist-dual/VERSION.md"
grep -q '^pdf_file_troff: firstpair-build-fixture-troff.pdf$' "$work/dist-dual/VERSION.md"
grep -q '^edition: preview$' "$work/dist-preview/VERSION.md"
grep -q '^edition: full$' "$work/dist-full/VERSION.md"
grep -q '^tutorial_file: tutorial.html$' "$work/dist-single/VERSION.md"
cmp -s "$work/tutorial.html" "$work/dist-single/tutorial.html"
pdfinfo "$work/dist-single/firstpair-build-fixture.pdf" | grep -q '^Title:[[:space:]]*FirstPair Build Fixture$'
pdfinfo "$work/dist-single/firstpair-build-fixture.pdf" | grep -q '^Author:[[:space:]]*First Pair Press$'

mkdir -p "$work/resolution-book" \
  "$work/resolution-config/nested/sail/book" \
  "$work/resolution-multi/docs/books/firstpair-build-fixture"
cp -R "$work/dist-single" "$work/resolution-book/book"
cp -R "$work/dist-single/." "$work/resolution-config/nested/sail/book/"
cp -R "$work/dist-single" "$work/resolution-multi/docs/books/firstpair-build-fixture/dist"
printf '%s\n' \
  '{' \
  '  "schemaVersion": 1,' \
  '  "bookRoot": "nested/sail",' \
  '  "metadata": "metadata.yaml",' \
  '  "version": "1.0.0",' \
  '  "dist": "nested/sail/book"' \
  '}' > "$work/resolution-config/book.build.json"
printf '%s\n' \
  '# FirstPair Library Contract' \
  '' \
  'slug: firstpair-build-fixture' \
  'shelf: testing' \
  > "$work/resolution-config/FIRSTPAIR.md"

node "$firstpair_root/scripts/publish-book-to-library.mjs" \
  "$work/resolution-book" \
  --slug firstpair-build-fixture \
  --dry-run --no-build --no-smoke --no-deploy --no-icloud \
  > "$work/book-plan.json"
node "$firstpair_root/scripts/publish-book-to-library.mjs" \
  "$work/resolution-config" \
  --dry-run --no-build --no-smoke --no-deploy --no-icloud \
  > "$work/config-plan.json"
node "$firstpair_root/scripts/publish-book-to-library.mjs" \
  "$work/resolution-multi" \
  --slug firstpair-build-fixture \
  --dry-run --no-build --no-smoke --no-deploy --no-icloud \
  > "$work/multi-plan.json"

grep -q '"edition": "full"' "$work/book-plan.json"
grep -q '/resolution-book/book"' "$work/book-plan.json"
grep -q '"source": ".*/resolution-book/book/tutorial.html"' "$work/book-plan.json"
grep -q 'book-uploads/staging/firstpair-build-fixture/tutorial.html' "$work/book-plan.json"
grep -q '/resolution-config/nested/sail/book"' "$work/config-plan.json"
grep -q '"shelf": "testing"' "$work/config-plan.json"
# Several shelves: the first is the catalog shelf, and all are listed.
sed -i.bak 's/^shelf: testing$/shelf: testing, unix/' "$work/resolution-config/FIRSTPAIR.md"
node "$firstpair_root/scripts/publish-book-to-library.mjs" \
  "$work/resolution-config" \
  --dry-run --no-build --no-smoke --no-deploy --no-icloud \
  > "$work/shelves-plan.json"
grep -q '"shelf": "testing"' "$work/shelves-plan.json"
node -e 'const p = JSON.parse(require("fs").readFileSync(process.argv[1])); const find = (o) => o && typeof o === "object" ? (o.shelves ?? Object.values(o).map(find).find(Boolean)) : undefined; const s = find(p); if (JSON.stringify(s) !== JSON.stringify(["testing", "unix"])) { console.error(s); process.exit(1) }' "$work/shelves-plan.json"
sed -i.bak 's/^shelf: testing, unix$/shelf: testing/' "$work/resolution-config/FIRSTPAIR.md"
grep -q '/docs/books/firstpair-build-fixture/dist"' "$work/multi-plan.json"

if node "$firstpair_root/scripts/publish-book-to-library.mjs" \
  "$work/resolution-config" \
  --slug wrong-slug \
  --dry-run --no-build --no-smoke --no-deploy --no-icloud \
  > "$work/conflicting-contract.log" 2>&1; then
  echo "conflicting FIRSTPAIR.md slug unexpectedly passed" >&2
  exit 1
fi
grep -q 'conflicts with FIRSTPAIR.md slug' "$work/conflicting-contract.log"

cp -R "$work/dist-single" "$work/dist-bad-link"
perl -0pi -e 's#</body>#<a href="missing.md">broken</a></body>#' \
  "$work/dist-bad-link/firstpair-build-fixture.html"
if "$firstpair_root/publishing/scripts/verify-library-book.sh" \
  "$work/dist-bad-link" > "$work/bad-link.log" 2>&1; then
  echo "relative Markdown resource link unexpectedly passed verification" >&2
  exit 1
fi
grep -q 'links to source Markdown: missing.md' "$work/bad-link.log"

# The PDF information page names the publisher, version stamp and full commit.
pdftotext -f 1 -l 4 "$work/dist-single/firstpair-build-fixture.pdf" - | tr -s '[:space:]' ' ' > "$work/info-page.txt"
grep -q 'firstpair.press' "$work/info-page.txt"
grep -q "$(sed -n 's/^version_stamp: //p' "$work/dist-single/VERSION.md")" "$work/info-page.txt"
grep -q "Source commit $(git -C "$work" rev-parse HEAD)" "$work/info-page.txt"
cp -R "$work/dist-single" "$work/dist-no-imprint"
printf '#set page(width: 6in, height: 9in)\nA book without an information page.\n' > "$work/no-imprint.typ"
typst compile "$work/no-imprint.typ" "$work/dist-no-imprint/firstpair-build-fixture.pdf"
if "$firstpair_root/publishing/scripts/verify-library-book.sh" \
  "$work/dist-no-imprint" > "$work/no-imprint.log" 2>&1; then
  echo "PDF without an information page unexpectedly passed verification" >&2
  exit 1
fi
grep -q 'PDF information page does not show firstpair.press' "$work/no-imprint.log"
grep -q 'does not show the full source commit' "$work/no-imprint.log"

# The EPUB imprint shows the same full commit; without it the verifier fails.
python3 - "$work" <<'PY'
import base64, json, pathlib, sys
work = pathlib.Path(sys.argv[1])
(work / 'cover.png').write_bytes(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
config = json.loads((work / 'single.book.build.json').read_text())
config.update(dist='dist-imprint', buildDir='build-imprint', epub={'coverImage': 'cover.png', 'imprint': True})
config.pop('tutorial', None)
(work / 'imprint.book.build.json').write_text(json.dumps(config, indent=2))
PY
"$builder" --repo-root "$work" --config imprint.book.build.json
unzip -p "$work/dist-imprint/firstpair-build-fixture.epub" EPUB/text/firstpair-imprint.xhtml \
  | grep -q "Source commit $(git -C "$work" rev-parse HEAD)"
cp -R "$work/dist-imprint" "$work/dist-no-epub-commit"
python3 - "$work/dist-no-epub-commit/firstpair-build-fixture.epub" <<'PY'
import re, sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as source:
    entries = [(info, source.read(info.filename)) for info in source.infolist()]
with zipfile.ZipFile(path, 'w') as target:
    for info, data in entries:
        if info.filename.endswith('firstpair-imprint.xhtml'):
            data = re.sub(rb'<p class="commit">.*?</p>', b'', data)
        target.writestr(info, data)
PY
if "$firstpair_root/publishing/scripts/verify-library-book.sh" \
  "$work/dist-no-epub-commit" > "$work/no-epub-commit.log" 2>&1; then
  echo "EPUB without its source commit unexpectedly passed verification" >&2
  exit 1
fi
grep -q 'EPUB information page does not show the full source commit' "$work/no-epub-commit.log"

typst compile "$work/narrow-column.typ" "$work/narrow-column.pdf"
if "$firstpair_root/publishing/scripts/check-pdf-layout.mjs" \
  "$work/narrow-column.pdf" > "$work/narrow-column.log" 2>&1; then
  echo "narrow-column PDF unexpectedly passed layout verification" >&2
  exit 1
fi
grep -q 'one-word column' "$work/narrow-column.log"

node "$firstpair_root/publishing/tests/test-vault-guide-workflow.mjs"

echo "Unified library book fixtures passed"
