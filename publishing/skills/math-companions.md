# Mathematics companions in all teaching formats

User default established 3 October 2026: build a written math companion and its
executable notebooks together. The default deliverables are PDF, EPUB, HTML,
a Python notebook, and a native OCaml notebook. A request for a math companion
includes those formats unless the user narrows the scope. Do not create only an
outline, a notebook summary, or one language edition.

Keep the source in the owning book repository. Use one canonical text and
interleave executable lessons in both notebooks. Include every definition,
explanation, worked example, exercise, figure, glossary, bibliography, and index
in the notebooks, with local anchors and embedded figures. The book editions
may omit executable code listings but must teach the same calculations.

Define notation, domains, dimensions, and technical terms before use, repeat
critical definitions locally, and provide an upfront notation guide plus a
final glossary and index. Preserve the series notation. For a companion that
extends others, audit actual lesson text and executed cells, distinguish a
passing mention from a worked lesson, and link existing prerequisites. Do not
restate a whole older companion merely to increase coverage.

Each numerical worked example must be computed from declared, editable inputs
in both Python and OCaml. OCaml computes natively; a Python bridge is not a
second implementation. Use mathematical identities and independent reference
answers as assertions; cross-language agreement alone is not proof of truth.
Keep synthetic demonstrations separate from dated empirical evidence and from
production deployment claims. No credentials or private corpus may be needed
to execute a delivered teaching notebook.

Use the shared FirstPair book builder and a source-owned, configuration-driven
notebook adapter. The reference complete-text adapter is
`~/src/eigentimes-math/papers/eigentimes-history-math/notebooks/build.py`.
It is an implementation reference, not authority to modify previous editions.
Record the tested runtime/dependencies and kernel names. Execute every code cell
in fresh kernels with an empty working directory; verify exact full-text and
figure coverage, cell source, absence of errors, and the expected result-key set.
Bind numerical-parity receipts to the exact notebook bytes. Retain saved outputs
and reading copies. State any browser math-rendering network dependency honestly.

Commit and push finished source before stamping all formats. Use semantic
version plus the recorded source commit in delivery names; increment the patch
version for corrections. The subsequent artifact-storage commit must not replace
the source revision in filenames. Check native MathML EPUB/HTML, internal and
external study links, and every final PDF page visually. Never claim that a
private repository URL is a public study resource. A self-contained study bundle
with exact lesson links is a valid local delivery.

Deliver regular versioned files to the user's established destination (for the
Eigen series, `~/icloud/papers`), preserve older releases, compare SHA-256 hashes,
and include a manifest and a source/study ZIP. Public hosting remains a separate
publication action governed by the source's FIRSTPAIR.md and current user scope.
