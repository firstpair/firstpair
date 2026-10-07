# Counting Arnold's Meanders with Verified Algorithms

In how many ways can a river cross a straight road n times? No closed formula is known. This paper formalizes Arnold's meander problem in Lean 4 and gives two counting algorithms proved, for every n, to return exactly the specified count: a search with parity pruning and a transfer matrix with merged and pruned states. The verified transfer matrix computes the counts up to n = 32; values up to n = 13 are checked by the Lean kernel alone. With an animated visualization of the rivers.

## Current Public Editions

- [PDF](/arnold-meanders/pdf/)
- [EPUB](/arnold-meanders/epub/)
- [Read online](/read/arnold-meanders/)
- [Chapter reader](/read/arnold-meanders/chapters/)
- [Interactive tutorial](/learn/arnold-meanders/)



The source repository owns the manuscript, metadata, version manifest, build
pipeline, and canonical generated artifacts:

[https://github.com/querygraph/meander](https://github.com/querygraph/meander)
