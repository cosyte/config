---
"@cosyte/process": patch
---

Two more invocations of the `cosyte-process` bin, and the canonical trigger surface of the two
security-workflow callers, published as data. Nothing about the six verbs, the four modifiers, the
token partition or `cosyte-process.config.json` changes: an installed consumer that edits nothing
keeps the behaviour it had, `cosyte-process check` grades the same five scripts and the same
override file, and an override file naming either new invocation is refused exactly as any other
unknown key is.

`cosyte-process sync-version` writes `package.json`'s version into the exported `VERSION` constant
in `src/index.ts`, replacing the per-repo copies of that script. Five conditions, numbered in the
README because every refusal names the one it failed: a usable manifest version, exactly one
declaration of the form `export const VERSION: string = "<value>";` anchored at column 0 anywhere in
the file, a literal splice (a version carrying `$&` or `$1` is written character for character), an
idempotent run that does not touch an already-synced file, and an exit vocabulary closed at 0 and 1.
The declared value runs to the first quote, so a declaration line carrying anything after it is not
one and is refused rather than spliced over. Two competing declarations are refused rather than
guessed between, and reported by line number.

`cosyte-process pack-docs [outputdir]` builds `docs-content.tar.gz` and `source.tar.gz` into an
output directory that defaults to `dist-artifacts`. It checks `docs-content/intro.md`,
`docs-content/sidebars.json`, `src/`, `package.json` and `tsconfig.json`, and builds both archives,
before it creates that directory, so a refused run leaves nothing half-built behind; the archives are
written with `node:zlib` alone, so no `tar` binary has to be on PATH.

Either invocation refuses rather than crashes, whatever the reason. A failure no condition of its
contract describes, an unwritable source file or an output path that is already a file, reaches
stderr as the same shape of diagnostic: the path, the invocation, what the system reported in
structural terms, the action available, and exit 1. Stdout stays empty and no diagnostic carries the
content of a file that was read.

`SECURITY_WORKFLOW_SURFACES` is the canonical trigger surface of `codeql.yml` and `scorecard.yml`,
and `gradeWorkflowText`, `gradeWorkflowFile` and `gradeSecurityWorkflows` compare a repository's own
copies against it. A workflow only runs from the repository's own `.github/workflows/` directory, so
the files stay where they are and what is shared is what they must say. A pass means every element
was found and equal; that the file exists is not one of the elements, and `scorecard.yml` carrying no
`pull_request` trigger is an element in the same way as `codeql.yml` carrying one.
