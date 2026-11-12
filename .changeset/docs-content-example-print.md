---
"@cosyte/script-utils": patch
---

`cosyte-docs-content` now reads what each TypeScript and JavaScript sample in a library's README and
docs-content pages prints, under the new rule `example-print`. A `console` method that prints,
`process.stdout.write`, `process.stderr.write`, or a printing method of an object named `log`,
`logger` or ending in `Logger` is a finding when an argument reads an identifying accessor (a name,
a record or member number, a date of birth, an address, a phone number, an email or a free-text
note, such as `msg.patient.mrn` or `doc.getMrn()`) or prints a whole message, segment, resource or
person (`console.log(msg)`, `JSON.stringify(bundle)`). A field read through a person or a name is
a finding whatever its last name (`patient.gender`, `res.name[0].text`, `patient.photo[0].url`;
the list is `PERSON_PATHS`). A printer is found however the sample calls it: `console["log"]`,
`console?.log`, `console.log?.()`, a name given to it (`const print = console.log`, `.bind`,
`const { info } = logger`), and a logger under another name (`const c = console`, `pino()`,
`createLogger()`, `logger.child()`, `new Console()`). A thrown error whose message carries an
identifying value is a finding too. A chain that ends in a `length`, `size` or
`precision` read, a comparison, a type, a count and a code are allowed. A finding names the file, the
line and the list entry it matched, never the value.

The rule is advisory: its findings are listed on stdout and never change the exit code. A library
turns it on, once its samples are swept, with `cosyte-docs-content.config.json` at its repository
root: `{ "examplePrint": { "required": true } }`. The same object's `accessors`, `wholeValues` and
`printers` add the library's own names to the lists; any other key, or a file that is not JSON,
stops the check with exit 2. New exports: `samplePrintFindings`, `sampleBlocks`,
`examplePrintFindings`, `readPrintConfig`, `readReadme` and the lists they read. What a caller
changes: nothing until it turns the rule on; then each sample that prints an identifying value reads
it into a variable or asserts on it, with the synthetic value in a comment.

The docs-content standard (decision record 0006) states the rule, with a right and a wrong example,
in its new section 14, and is now a page on docs.cosyte.com beside the testing and performance
standards.
