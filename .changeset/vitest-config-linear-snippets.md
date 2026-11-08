---
"@cosyte/vitest-config": patch
---

`@cosyte/vitest-config/snippets` reads a markdown fence opener and a `// =>` doctest line in time linear in the line's length. Two regular expressions there let several quantifiers take the same spaces, so a long line that failed to match took time quadratic in its length: 100,000 spaces took 8 to 32 seconds on Node 26 (CodeQL js/polynomial-redos). Every snippet with an expression and a value is read as before. A doctest line with no expression, `; // => 1`, now becomes `expect()`, which fails the snippet, where an unindented one used to pass as a line that asserted nothing.
