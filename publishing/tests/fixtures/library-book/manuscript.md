# Opening

This fixture exercises the shared First Pair book builder with enough ordinary
prose to verify that PDF, EPUB, and browser output contain readable material.
It deliberately uses more than a single sentence so structural checks can
distinguish a real document from an empty conversion result.

## A Small Table

| Contract | Owner |
| --- | --- |
| Manuscript | Source repository |
| Artifact shape | FirstPair |

An example may document an operator's local command without turning it into a
resource URL:

```sh
cd /Users/example/src/book
```

# Closing

The second chapter gives the chunked HTML writer a genuine navigation target.
The finished fixture is disposable, but its build path is the same path used by
catalog books. A successful run proves the shared entrypoint, manifest writer,
versioned links, and mandatory output verification work together.
