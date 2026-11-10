---
"@cosyte/vitest-config": patch
---

Barrels are read, not named. `cosyteVitest` and `cosyteStryker` used to leave every `index.ts` out
of coverage and mutation testing. They now read each `.ts` file under `src/` (declaration files
aside) and leave out only a barrel: a file whose every statement is an import that binds names or
an export of names, with at least one export. So a library's coverage and its default mutate list
now include:

- every `index.ts` that holds any other statement: a function, a class, a constant, a call, a type
  alias, an interface, a side-effect import;
- every file the reading does not understand, whatever its name.

They now leave out a file of nothing but re-exports under any name, not only `index.ts`.
`DEFAULT_MUTATE` no longer names `index.ts`; `cosyteStryker()` adds a `!` entry for each barrel it
found. Both take a new `root` option, the directory whose `src/` is read, the working directory by
default. Tests, declarations, `__fixtures__` and `generated` stay out by name, as before.

A library whose `index.ts` holds code measures it for the first time when it adopts this version,
so its coverage and mutation scores can fall below its floor.

`cosyteStryker` now sets `ignoreStatic: true`. A static mutant, in code that runs once when a
module loads, can be tested only by running every test again; on our HL7 library they were 43% of
the mutants and about 94% of a full run's time. Ignored mutants are not in the score, so a full
run's score can move either way, and the ratchet lists an ignored mutant in a pull request's
changed lines with Stryker's reason. A package whose module-level tables are what it checks passes
`stryker: { ignoreStatic: false }`.
