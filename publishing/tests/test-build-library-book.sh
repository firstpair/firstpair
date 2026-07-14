#!/usr/bin/env bash
set -euo pipefail

firstpair_root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture_source="$firstpair_root/publishing/tests/fixtures/library-book"
builder="$firstpair_root/publishing/scripts/build-library-book.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp -R "$fixture_source/." "$work/"
printf '%s  \n%s\n' \
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">' \
  '<text x="2" y="14">fixture</text></svg>' > "$work/fixture.svg"
printf '\n![Fixture diagram](fixture.svg)\n' >> "$work/manuscript.md"

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

typst compile "$work/narrow-column.typ" "$work/narrow-column.pdf"
if "$firstpair_root/publishing/scripts/check-pdf-layout.mjs" \
  "$work/narrow-column.pdf" > "$work/narrow-column.log" 2>&1; then
  echo "narrow-column PDF unexpectedly passed layout verification" >&2
  exit 1
fi
grep -q 'one-word column' "$work/narrow-column.log"

node "$firstpair_root/publishing/tests/test-vault-guide-workflow.mjs"

echo "Unified library book fixtures passed"
