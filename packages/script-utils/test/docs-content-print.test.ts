/**
 * What a sample may print: a TypeScript or JavaScript sample in a README or a docs-content page never
 * passes a value that identifies a person to a console, logger or printer call. Each kind of call
 * and each kind of argument is shown red, each print the rule allows is shown green, and the command
 * line is graded on its exit codes: advisory (0, the findings on stdout) until the library's
 * cosyte-docs-content.config.json requires it (1), and 2 when that file cannot be read.
 *
 * Every sample, value and page here is synthetic.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONSOLE_METHODS,
  DOCS_CONTENT_RULES,
  DocsContentRefusal,
  examplePrintFindings,
  IDENTIFYING_ACCESSORS,
  LOGGER_METHODS,
  NUMBERS_HEADING,
  NUMBERS_PLACEHOLDER,
  PERSON_PATHS,
  PERSON_SAFE_ENDS,
  PRINT_CONFIG_FILE,
  PRINT_NESTING_LIMIT,
  PRINT_CONFIG_KEY,
  PRINT_CONFIG_KEYS,
  PRINT_RULE,
  QUALITY_PAGES,
  readPrintConfig,
  readReadme,
  runDocsContentCheck,
  SAFE_READS,
  SAMPLE_LANGUAGES,
  sampleBlocks,
  samplePrintFindings,
  STREAM_PRINTERS,
  WHOLE_VALUES,
} from "../docs-content.js";

/** The list entries a sample's findings matched, one per finding. */
function entries(code: string, extra = {}): string[] {
  return samplePrintFindings(code, extra).map((finding) => finding.entry);
}

describe("the rule's lists", () => {
  it("names the rule and the file a library turns it on in", () => {
    expect(PRINT_RULE).toBe("example-print");
    expect(DOCS_CONTENT_RULES[PRINT_RULE]).toBe(
      "a README or docs-content sample never passes a value that identifies a person to a " +
        "console, logger or printer call (advisory until cosyte-docs-content.config.json requires it)",
    );
    expect(PRINT_CONFIG_FILE).toBe("cosyte-docs-content.config.json");
    expect(PRINT_CONFIG_KEY).toBe("examplePrint");
    expect(PRINT_CONFIG_KEYS).toEqual(["required", "accessors", "wholeValues", "printers"]);
    expect(SAMPLE_LANGUAGES).toEqual(["ts", "typescript", "tsx", "js", "javascript", "mjs"]);
    expect(SAFE_READS).toEqual(["length", "size", "precision"]);
    expect(PERSON_SAFE_ENDS).toEqual(["type", "resourceType", "kind", "code", "count"]);
    expect(PRINT_NESTING_LIMIT).toBe(200);
    expect(STREAM_PRINTERS).toEqual(["process.stdout.write", "process.stderr.write"]);
  });

  it("flags every identifying accessor it lists, read as a member", () => {
    for (const entry of IDENTIFYING_ACCESSORS) {
      const chain = entry.split(".").join("?.");
      expect(entries(`console.log(record.${chain});`), entry).toEqual([entry]);
    }
  });

  it("flags every whole value it lists, printed whole", () => {
    for (const entry of WHOLE_VALUES) {
      expect(entries(`console.log(${entry});`), entry).toEqual([entry]);
    }
  });
});

describe("each kind of call", () => {
  const read = "msg.patient.mrn";

  it("flags each console method that prints", () => {
    for (const method of CONSOLE_METHODS) {
      expect(entries(`console.${method}("label", ${read});`), method).toEqual(["mrn"]);
    }
  });

  it("flags a write to stdout or stderr", () => {
    for (const printer of STREAM_PRINTERS) {
      expect(entries(`${printer}(String(${read}));`), printer).toEqual(["mrn"]);
    }
  });

  it("flags each logger method, on any object named as a logger", () => {
    for (const logger of ["log", "logger", "this.logger", "ctx.log", "auditLogger"]) {
      for (const method of LOGGER_METHODS) {
        expect(entries(`${logger}.${method}(${read});`), `${logger}.${method}`).toEqual(["mrn"]);
      }
    }
  });

  it("flags a printer the library names, and only once it is named", () => {
    expect(entries(`out.print(${read});`)).toEqual([]);
    expect(entries(`out.print(${read});`, { printers: ["out.print"] })).toEqual(["mrn"]);
  });

  it("does not read a call that does not print", () => {
    for (const call of [
      "console.count",
      "console.assert",
      "console.time",
      "logger.child",
      "log.lookup",
      "catalog.info",
      "logbook.info",
      "foo.log",
      "fake.console.log",
      "fake?.console.log",
      "console.log.bind",
      "print",
      "write",
      "process.stdout.end",
      "expect",
      'console("log")',
      'console["log", 1]',
      "console[log]",
    ]) {
      expect(entries(`${call}(${read});`), call).toEqual([]);
    }
  });

  it("does not read a printer that is named but not called", () => {
    expect(entries(`const print = console.log;\nconst value = ${read};`)).toEqual([]);
    expect(entries(`console.log;`)).toEqual([]);
    expect(entries(`console.log`)).toEqual([]);
    expect(entries(`console.`)).toEqual([]);
    expect(entries(`console.log[${read}];`)).toEqual([]);
  });

  it("finds a call inside a function, a group or a template", () => {
    expect(entries("rows.forEach((r) => { console.log(r.mrn); });")).toEqual(["mrn"]);
    expect(entries("function f() {}\nconsole.log(p.mrn);")).toEqual(["mrn"]);
    expect(entries("const s = `${console.log(p.mrn)}`;")).toEqual(["mrn"]);
  });

  it("reads only the call's own arguments", () => {
    expect(entries("console.log(n);\nconst copy = msg;")).toEqual([]);
    expect(entries('console.log("(");\nconst copy = msg;')).toEqual([]);
    expect(entries('console.log(")", msg);')).toEqual(["msg"]);
    expect(entries("console.log(a], msg);")).toEqual(["msg"]);
    expect(entries("console.log(a[0], msg);")).toEqual(["msg"]);
    expect(entries("}\nconsole.log(p.mrn);")).toEqual(["mrn"]);
  });

  it("gives the line of the call, in a sample of many lines", () => {
    const code = [
      "const msg = parse(text);",
      "console.log(",
      '  "record number",',
      "  msg.patient.mrn,",
      ");",
      "console.log(msg.meta.type);",
      "logger.info({ id: msg.patient?.mrn });",
    ].join("\n");
    expect(samplePrintFindings(code).map((f) => f.line)).toEqual([2, 7]);
  });

  it("reports one finding a call, however many arguments identify", () => {
    expect(entries("console.log(p.mrn, p.fullName, msg);")).toEqual(["mrn"]);
  });
});

describe("each kind of argument", () => {
  const flagged: [string, string, string][] = [
    ["a member", "console.log(msg.patient.mrn);", "mrn"],
    ["an optional chain", "console.log(msg?.patient?.dateOfBirth?.raw);", "dateOfBirth"],
    ["a string key", 'console.log(msg.patient["mrn"]);', "mrn"],
    ["an optional string key", "console.log(msg.patient?.['mrn']);", "mrn"],
    ["a getter", "console.log(doc.getMrn());", "mrn"],
    ["another case", "console.log(row.MRN);", "mrn"],
    ["snake case", "console.log(row.date_of_birth);", "dateOfBirth"],
    ["a bare name", "const mrn = msg.patient.mrn;\nconsole.log(mrn);", "mrn"],
    ["a non-null assertion", "console.log(msg.patient!.mrn);", "mrn"],
    ["a shorthand key", "logger.info({ mrn });", "mrn"],
    ["an object's value", "logger.info({ id: msg.patient.mrn, n: 1 });", "mrn"],
    ["a spread", "logger.info({ ...msg.patient.address });", "address"],
    ["a template", "console.log(`record ${msg.patient.mrn}`);", "mrn"],
    ["a template in a template", "console.log(`a ${`b ${p.email}`}`);", "email"],
    ["an array", "console.log([p.phone, 1]);", "phone"],
    ["parentheses", "console.log((p.ssn));", "ssn"],
    ["a member after parentheses", "console.log((rows[0]).mrn);", "mrn"],
    ["a conditional's branch", 'console.log(ok ? p.mrn : "none");', "mrn"],
    ["a conditional's other branch", 'console.log(ok ? "none" : p.mrn);', "mrn"],
    ["a nested conditional", "console.log(a ? (b ? 1 : 2) : p.mrn);", "mrn"],
    ["a mapped list", "console.log(patients.map((p) => p.mrn));", "mrn"],
    ["a function body", "console.log(rows.map((r) => { return r.city; }));", "city"],
    ["a lazy message", "logger.debug(() => p.notes);", "notes"],
    ["a lazy whole value", "logger.debug(() => msg);", "msg"],
    ["a call's argument", "console.log(format(p.mrn));", "mrn"],
    ["an index on a list", "console.log(p.identifiers[0].value);", "identifiers"],
    ["an operand", 'console.log("MRN " + p.mrn);', "mrn"],
    ["a fallback", 'console.log(p.mrn ?? "none");', "mrn"],
    ["a dotted entry", "console.log(res.name[0].family);", "name.family"],
    ["a dotted entry by getter", "console.log(doc.getPatient()?.name?.given);", "name.given"],
    ["a dotted entry with an id", "console.log(ds.patient.id);", "patient.id"],
    ["a cast", "console.log(p.mrn as string);", "mrn"],
    ["an awaited value", "console.log(await p.mrn);", "mrn"],
    ["a whole message", "console.log(msg);", "msg"],
    ["a whole value as a member", "console.log(bundle.entry[0].resource);", "resource"],
    ["a whole value by getter", "console.log(doc.getPatient());", "patient"],
    ["a whole value made text", "console.log(msg.toString());", "msg"],
    ["a whole value as JSON", "console.log(JSON.stringify(bundle, null, 2));", "bundle"],
    ["a whole value in String()", "console.log(String(segment));", "segment"],
    ["a whole value inspected", "console.log(util.inspect(resource));", "resource"],
    ["a whole value serialized", "console.log(serializeResource(resource));", "resource"],
    ["a whole value in a template", "process.stdout.write(`${segment}\\n`);", "segment"],
    ["a whole value from a list", "console.log(msg.segments[0]);", "segments"],
    ["a whole value as JSON text", "console.log(bundle.toJSON());", "bundle"],
    ["a whole value as its primitive", "console.log(segment.valueOf());", "segment"],
    ["a whole value formatted", 'console.log(util.format("%s", msg));', "msg"],
    ["a whole value encoded", "console.log(encodeMessage(msg));", "msg"],
    ["a key with hyphens", 'console.log(p["date-of-birth"]);', "dateOfBirth"],
    ["a comparison's absence", "console.log(p.mrn, n == 1);", "mrn"],
    ["a chained conditional", "console.log(a ? p.mrn : b ? 1 : 2);", "mrn"],
    ["a later entry of an object", "logger.info({ code: 1, mrn });", "mrn"],
    ["an item after a comparison", "console.log([p.mrn, a < b]);", "mrn"],
    ["a call's argument before a comparison", "console.log(f(p.mrn, a < b));", "mrn"],
    ["a whole value added to", "console.log(msg + n);", "msg"],
    ["a string that reads like an operator", 'console.log("<", "in", p.mrn);', "mrn"],
    ["a string like a comparison, joined", 'console.log("<" + p.mrn);', "mrn"],
    ["a string like `in`, joined", 'console.log("in" + p.mrn);', "mrn"],
  ];
  for (const [kind, code, entry] of flagged) {
    it(`flags ${kind}`, () => {
      expect(entries(code)).toEqual([entry]);
    });
  }

  it("never echoes the argument, which may hold a synthetic value", () => {
    const [finding] = samplePrintFindings(
      'console.log("SYNTHETIC-MRN-0001", lookup["SYNTHETIC-KEY"], msg.patient.mrn);',
    );
    expect(finding?.message).toBe(
      'console.log prints what "mrn" reads, which identifies a person: read it into a variable ' +
        "or assert on it, with its synthetic value in a comment",
    );
    const [whole] = samplePrintFindings('console.log("SYNTHETIC^PATIENT", msg);');
    expect(whole?.message).toBe(
      'console.log prints "msg" whole, a message, segment, resource or person: print a type, a ' +
        "code or a count from it instead",
    );
  });
});

describe("the prints the rule allows", () => {
  const allowed: [string, string][] = [
    ["a message type", "console.log(msg.meta.type);"],
    ["a count", "console.log(msg.warnings.length, rows.size);"],
    ["a warning code", "console.warn(warnings.map((w) => w.code));"],
    ["a warning's text", "console.warn(w.code, w.message, w.position);"],
    ["an error's text", "console.log(error instanceof Error ? error.message : error);"],
    ["date precision", "console.log(msg.patient?.dateOfBirth?.precision);"],
    ["a length", "console.log(p.mrn.length, p.addresses.size);"],
    ["a comparison", 'console.log(p.mrn === "SYN-1", p.mrn !== q.mrn, a < p.dob);'],
    ["a loose comparison", "console.log(p.mrn == null, p.mrn != null, p.mrn > 0);"],
    ["a trailing comma", "console.log(n,);"],
    ["a digest of a whole value", "console.log(hash(JSON.stringify(msg)));"],
    ["a call named like a serializer", "console.log(reformat(msg), formatter(msg));"],
    ["a to-text method not called", "console.log(msg.toString);"],
    ["a get inside a name", "console.log(p.zipgetCode, p.getmrn);"],
    ["a computed key that starts with a string", 'console.log(table["mrn" + n]);'],
    ["an instance test", "console.log(p.mrn instanceof String);"],
    ["a membership test of a field", 'console.log("x" in p.address);'],
    ["an arrow's parameters", "console.log(rows.map((mrn: string) => mrn.length));"],
    ["an arrow's bare parameter", "console.log(rows.map(mrn => mrn.length));"],
    ["a negation", "console.log(!p.mrn);"],
    ["a type", "console.log(typeof p.mrn);"],
    ["a membership test", 'console.log("mrn" in p);'],
    ["a conditional's condition", 'console.log(p.mrn ? "has one" : "none");'],
    ["a string that names a field", 'console.log("mrn", "dateOfBirth");'],
    ["a comment that names a field", "console.log(n); // p.mrn\n/* p.email */ console.log(1);"],
    ["a key that names a field", "logger.info({ mrn: count, email: true });"],
    ["a whole value passed to a reader", "console.log(patient(msg)?.code, toISO(msg));"],
    ["a field of a whole value", "console.log(msg.segments[0].type, bundle.total);"],
    ["a whole value read, not printed", "const msg = parse(text);\nexpect(msg.patient.mrn);"],
    ["a version", "console.log(VERSION);"],
    ["a literal", 'process.stdout.write("ok\\n");\nconsole.log(1, null, /x/);'],
    ["a regular expression with a quote", 'console.log(/"/.test(t), a / b / c);'],
    ["a computed key", "console.log(table[p.mrn]);"],
    ["a call on a printer's result", "console.log(sum(rows));"],
    ["an empty call", "console.log();"],
    ["a name like a field's", "console.log(cityCount, mrnLength, given);"],
  ];
  for (const [kind, code] of allowed) {
    it(`allows ${kind}`, () => {
      expect(entries(code)).toEqual([]);
    });
  }

  it("reads code it cannot parse without failing", () => {
    for (const code of [
      "console.log(",
      "console.log(p.mrn",
      "console.log(`${p.mrn",
      "console.log('unclosed",
      "console.log(a)) ]",
      "/* unclosed",
      "console.log(/[/]/.source);",
      "console.log(a?.5:b);",
      "console.log(a?.(p.mrn));",
    ]) {
      expect(() => samplePrintFindings(code), code).not.toThrow();
    }
    expect(entries("console.log(p.mrn")).toEqual(["mrn"]);
    expect(entries("console.log(`${p.mrn")).toEqual(["mrn"]);
    expect(entries("console.log(a?.(p.mrn));")).toEqual(["mrn"]);
  });
});

describe("reading the code as written", () => {
  it("counts the lines of comments, strings and templates that run over several", () => {
    const code = [
      "/* a comment", //               1
      "   over two lines */", //       2
      "const t = `a template", //      3
      "over two lines`;", //           4
      "const u = `an escaped \\", //   5
      "newline`;", //                  6
      "console.log(p.mrn);", //        7
    ].join("\n");
    expect(samplePrintFindings(code).map((f) => f.line)).toEqual([7]);
  });

  it("ends a block comment at its own close, or at the end of the sample", () => {
    expect(entries("/*/ console.log(p.mrn) */")).toEqual([]);
    expect(entries("/* console.log(p.mrn)")).toEqual([]);
    expect(entries("/* a */ console.log(p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log(n*2, p.mrn);")).toEqual(["mrn"]);
  });

  it("ends a line comment at the end of the line or of the sample", () => {
    expect(entries("console.log(n); // p.mrn")).toEqual([]);
    expect(entries("// console.log(p.mrn)\nconsole.log(p.email);")).toEqual(["email"]);
  });

  it("keeps an escaped quote inside its string", () => {
    expect(entries('console.log("p.mrn \\" p.mrn");')).toEqual([]);
    expect(entries("console.log('p.mrn \\' p.mrn');")).toEqual([]);
    expect(entries('console.log(p["mrn\\')).toEqual(["mrn"]);
    expect(entries('console.log("it\'s", p.mrn);')).toEqual(["mrn"]);
    expect(samplePrintFindings("const s = 'unclosed\nconsole.log(p.mrn);")[0]?.line).toBe(2);
  });

  it("reads a regular expression as one token, escapes and classes included", () => {
    expect(entries("console.log(/a\\/p.mrn/.source);")).toEqual([]);
    expect(entries("console.log(/[/]p.mrn/.source);")).toEqual([]);
    expect(entries("/console.log(p.mrn)/.test(s);")).toEqual([]);
    expect(entries("console.log(rows.map(() => { return /p.mrn/; }));")).toEqual([]);
    expect(entries("console.log(/x/gi, p.mrn);")).toEqual(["mrn"]);
    expect(entries("const r = /x/")).toEqual([]);
    expect(entries('console.log(/"/.test(t), p.mrn);')).toEqual(["mrn"]);
    expect(entries("console.log(p.mrn); f(/unclosed")).toEqual(["mrn"]);
    expect(entries('console.log("in" / 2, p.mrn);')).toEqual(["mrn"]);
    expect(entries("console.log(/[a]/.source, p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log(/x/ / 2, p.mrn);")).toEqual(["mrn"]);
    expect(samplePrintFindings("f(/unclosed\nconsole.log(p.mrn);")[0]?.line).toBe(2);
  });

  it("reads a slash after a value as division", () => {
    expect(entries("console.log(a.b / 2, p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log((a) / 2, p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log(a[0] / 2, p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log({ a: 1 } / 2, p.mrn);")).toEqual(["mrn"]);
  });

  it("reads `?.` before a digit as a conditional", () => {
    expect(entries("console.log(p.mrn ?.5 : 1);")).toEqual([]);
    expect(entries("console.log(a?.")).toEqual([]);
  });

  it("reads braces inside a template's expression", () => {
    expect(entries("console.log(`${f({ a: 1 }) + p.mrn}`);")).toEqual(["mrn"]);
    expect(entries("console.log(`${rows.length} rows`);")).toEqual([]);
    expect(entries("console.log(`a{p.mrn}`);")).toEqual([]);
    expect(entries("console.log(`$p.mrn`);")).toEqual([]);
    expect(entries("console.log(`\\${p.mrn}`);")).toEqual([]);
    expect(entries("console.log(`${n}`, p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log(`${n} ${p.mrn}`);")).toEqual(["mrn"]);
    expect(entries("console.log(`${`x`}`, p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log(`${f({ a: 1 })}`, p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log(`unclosed ${p.mrn")).toEqual(["mrn"]);
  });

  it("reads a conditional inside a conditional", () => {
    expect(entries("console.log(a ? b ? 1 : 2 : p.mrn);")).toEqual(["mrn"]);
    expect(entries("console.log(a ? b ? p.mrn : 2 : 3);")).toEqual(["mrn"]);
    expect(entries("console.log(a ? b ? 1 : 2 : 3);")).toEqual([]);
  });

  it("reads a call on a parenthesized value", () => {
    expect(entries("console.log((fn)(msg));")).toEqual([]);
    expect(entries("console.log((fn)(p.mrn));")).toEqual(["mrn"]);
  });

  it("adds a library's own accessors and whole values to the lists", () => {
    const code = "console.log(r.practiceAssignedId);\nconsole.log(ds);";
    expect(entries(code)).toEqual([]);
    expect(entries(code, { accessors: ["practiceAssignedId"], wholeValues: ["ds"] })).toEqual([
      "practiceAssignedId",
      "ds",
    ]);
  });

  it("keeps every default entry when a library adds its own", () => {
    const extra = { accessors: ["practiceAssignedId"], wholeValues: ["ds"] };
    for (const entry of IDENTIFYING_ACCESSORS) {
      const chain = entry.split(".").join("?.");
      expect(entries(`console.log(record.${chain});`, extra), entry).toEqual([entry]);
    }
    for (const entry of WHOLE_VALUES) {
      expect(entries(`console.log(${entry});`, extra), entry).toEqual([entry]);
    }
  });
});

describe("the whole path, not its last name", () => {
  it("flags a safe last name on a path through a person, a name or an identifying field", () => {
    expect(entries("console.log(patient.address[0].line);")).toEqual(["address"]);
    expect(entries("console.log(patient.photo[0].url);")).toEqual(["photo"]);
    expect(entries("console.log(patient.telecom[0].system);")).toEqual(["telecom"]);
    expect(entries("console.log(res.name[0].text);")).toEqual(["name"]);
    expect(entries("console.log(msg.patient.gender);")).toEqual(["patient"]);
    expect(entries("console.log(doc.getPatient().race);")).toEqual(["patient"]);
    expect(entries("console.log(bundle.patients[0].gender);")).toEqual(["patients"]);
  });

  it("flags every person path it lists, with a safe name after it", () => {
    for (const entry of PERSON_PATHS) {
      expect(entries(`console.log(record.${entry}[0].url);`), entry).toEqual([entry]);
    }
  });

  it("still allows a length, a size or a precision on such a path, and the path's end", () => {
    expect(entries("console.log(msg.patient.name.length, patient.address.size);")).toEqual([]);
    expect(entries("console.log(msg.patient.birthDate.precision);")).toEqual([]);
    expect(entries("console.log(code.name, segment.name, field.name);")).toEqual([]);
    expect(entries("console.log(patient(msg)?.code, patient(msg).gender);")).toEqual([]);
    expect(
      entries("console.log(patients.map((p) => p.code), patients.widgetCount().gender);"),
    ).toEqual([]);
  });

  it("allows a type, a kind, a code or a count read through a person", () => {
    // A DICOMDIR record in a loop is often named patient, and its type is "PATIENT", a code.
    expect(entries('console.log(patient.type, image.referencedFileId?.join("/"));')).toEqual([]);
    expect(entries("console.log(patient.resourceType, msg.patient.kind);")).toEqual([]);
    expect(entries("console.log(bundle.patients[0].code, person.count);")).toEqual([]);
    expect(entries("console.log(patient.resource_type, Patient.Type);")).toEqual([]);
  });

  it("allows a length or a size read from what a call returns", () => {
    expect(entries('console.log(serializeResource(bundle).length, "bytes");')).toEqual([]);
    expect(entries("console.log(JSON.stringify(msg).length, lookup(p.mrn).size);")).toEqual([]);
    expect(entries("console.log(JSON.stringify(msg).trim());")).toEqual(["msg"]);
    expect(entries("console.log(lookup(p.mrn).code);")).toEqual(["mrn"]);
    expect(entries("console.log(String(segment).length.x);")).toEqual(["segment"]);
  });

  it("still flags an identifying field, or the whole person, that ends in a safe name", () => {
    expect(entries("console.log(patient.name.type);")).toEqual(["patient.name"]);
    expect(entries("console.log(patient.address[0].type);")).toEqual(["address"]);
    expect(entries("console.log(patient.telecom[0].code);")).toEqual(["telecom"]);
    expect(entries("console.log(patient.type.display);")).toEqual(["patient"]);
    expect(entries("console.log(patient);")).toEqual(["patient"]);
  });

  it("names the person or the name it read through", () => {
    expect(samplePrintFindings("console.log(msg.patient.gender);")[0]?.message).toBe(
      'console.log prints what "patient" reads, which identifies a person: read it into a ' +
        "variable or assert on it, with its synthetic value in a comment",
    );
  });
});

describe("every way to call a printer", () => {
  const read = "p.mrn";

  it("flags a printer read by a string key or an optional chain", () => {
    for (const call of [
      'console["log"]',
      "console['warn']",
      "console?.log",
      "console?.['log']",
      "console.log?.",
      'process["stdout"].write',
      "process.stderr?.write",
      "logger?.info",
      'this["logger"].error',
    ]) {
      expect(entries(`${call}(${read});`), call).toEqual(["mrn"]);
    }
  });

  it("names the printer as the code calls it, and never the argument", () => {
    expect(samplePrintFindings(`console["log"](${read});`)[0]?.message).toMatch(
      /^console\.log prints what "mrn" reads/,
    );
  });

  it("flags an alias of a console or logger method", () => {
    for (const code of [
      "const print = console.log;\nprint(p.mrn);",
      "let say = logger.info;\nsay(p.mrn);",
      "var out = process.stdout.write;\nout(p.mrn);",
      "const say = console.log.bind(console);\nsay(p.mrn);",
      "print = console.error;\nprint(p.mrn);",
      "const a = console.log;\nconst b = a;\nb(p.mrn);",
      "const { log } = console;\nlog(p.mrn);",
      "const { info: say, warn } = logger;\nsay(p.mrn);",
      "const { count, log } = console;\nlog(p.mrn);",
      "const out = row.print;\nout(p.mrn);",
      "print(p.mrn);\nconst print = console.log",
      "function f() { const print = console.log; print(p.mrn); }",
      "let { log } = console;\nlog(p.mrn);",
      "var { warn } = console;\nwarn(p.mrn);",
    ]) {
      expect(entries(code, { printers: ["row.print"] }), code).toEqual(["mrn"]);
    }
    const [aliased] = samplePrintFindings("const print = console.log;\nprint(p.mrn);");
    expect(aliased).toMatchObject({ line: 2, entry: "mrn" });
    expect(aliased?.message).toMatch(/^print prints what "mrn" reads/);
  });

  it("flags a logger under another name", () => {
    for (const code of [
      "const c = console;\nc.log(p.mrn);",
      "const audit = pino();\naudit.info(p.mrn);",
      "const audit = pino({ level: 'info' }).child({ app: 'x' });\naudit.warn(p.mrn);",
      "const svc = new Logger('x');\nsvc.error(p.mrn);",
      "const out = winston.createLogger({});\nout.info(p.mrn);",
      "const l = log4js.getLogger();\nl.debug(p.mrn);",
      "const kid = logger.child({ id: 1 });\nkid.info(p.mrn);",
      "const kid = this.logger.child({ id: 1 });\nkid.info(p.mrn);",
      "const sink = this.logger;\nsink.info(p.mrn);",
      "const out = bunyan.createLogger({ name: 'x' });\nout.fatal(p.mrn);",
      "const out = consola.create({});\nout.info(p.mrn);",
      "const out = new Console(process.stdout);\nout.log(p.mrn);",
      "const c = console;\nconst { info } = c;\ninfo(p.mrn);",
    ]) {
      expect(entries(code), code).toEqual(["mrn"]);
    }
  });

  it("keeps a logger by its own name when it is set to something it does not know", () => {
    for (const code of [
      "const logger = config.sink;\nlogger.info(p.mrn);",
      "const logger = rows.bind(x);\nlogger.info(p.mrn);",
      "const logger = parse(text);\nlogger.info(p.mrn);",
      "const { count: log } = console;\nlog.info(p.mrn);",
    ]) {
      expect(entries(code), code).toEqual(["mrn"]);
    }
  });

  it("does not take a name for a printer that is set to something else", () => {
    for (const code of [
      "const print = format;\nprint(p.mrn);",
      "const out = parse(text);\nout.info(p.mrn);",
      "const out = records.child({});\nout.info(p.mrn);",
      "const out = logger.format(text);\nout.info(p.mrn);",
      "const { mrn } = p;\nmrn(1);",
      "const { info } = catalog;\ninfo(p.mrn);",
      "a.print = console.log;\nprint(p.mrn);",
      "const n = 1;\nn(p.mrn);",
      "const n = 1 + console.log;\nn(p.mrn);",
      "const print = console.log(1);\nprint(p.mrn);",
      "const c = console.log.apply(console, []);\nc(p.mrn);",
      "const out = pinocchio();\nout.info(p.mrn);",
      "const out = jalapino();\nout.info(p.mrn);",
      "const [log] = console;\nlog(p.mrn);",
      "const print =",
      "const {} = console;",
      "const { log: [a] } = console;\n(f)(p.mrn);",
      "const { log: } = console;",
      "const out = this.records;\nout.info(p.mrn);",
      "x == console.log;\nx(p.mrn);",
      "const { [k]: say } = console;\nsay(p.mrn);",
      "{ log } = console;\nlog(p.mrn);",
      "const = console.log;\nprint(p.mrn);",
    ]) {
      expect(entries(code), code).toEqual([]);
    }
  });

  it("still allows a safe print through an alias", () => {
    expect(entries("const print = console.log;\nprint(msg.meta.type);")).toEqual([]);
    expect(entries("const { log } = console;\nlog(msg.warnings.length);")).toEqual([]);
  });
});

describe("a thrown error", () => {
  it("flags a thrown error whose message carries an identifying field", () => {
    for (const code of [
      "throw new Error(`no record for ${p.mrn}`);",
      'throw new TypeError("bad " + p.email);',
      "throw Error(`at ${segment}`);",
      "throw new errors.ParseError({ detail: p.dateOfBirth });",
      "throw p.mrn;",
      "throw segment;",
    ]) {
      expect(entries(code), code).toHaveLength(1);
    }
    expect(samplePrintFindings("throw new Error(`no record for ${p.mrn}`);")).toEqual([
      {
        line: 1,
        entry: "mrn",
        message:
          'a thrown error carries what "mrn" reads, which identifies a person: read it into a ' +
          "variable or assert on it, with its synthetic value in a comment",
      },
    ]);
    expect(entries('console.log("throw", p.mrn);')).toEqual(["mrn"]);
    expect(samplePrintFindings("throw segment;")[0]?.message).toBe(
      'a thrown error carries "segment" whole, a message, segment, resource or person: print a ' +
        "type, a code or a count from it instead",
    );
  });

  it("allows a thrown error that carries no identifying value", () => {
    for (const code of [
      "throw new Error(`unknown code ${code}`);",
      "throw new Error(error.message);",
      "throw new Error(msg);",
      "throw error;",
      "throw error;\nconst copy = segment;",
      "const copy = segment;\nthrow error;",
      "throw",
      "throw new",
      "const thrown = p.mrn;",
    ]) {
      expect(entries(code), code).toEqual([]);
    }
  });
});

describe("the bounds on a sample", () => {
  const deep = (open: string, close: string, levels: number): string =>
    `${open.repeat(levels)}x${close.repeat(levels)}`;

  it("reads a sample nested to the limit", () => {
    const inside = "console.log(p.mrn)";
    const groups =
      "(".repeat(PRINT_NESTING_LIMIT - 1) + inside + ")".repeat(PRINT_NESTING_LIMIT - 1);
    expect(entries(groups)).toEqual(["mrn"]);
    const templates =
      "`${".repeat(PRINT_NESTING_LIMIT - 1) + inside + "}`".repeat(PRINT_NESTING_LIMIT - 1);
    expect(entries(templates)).toEqual(["mrn"]);
    expect(() => samplePrintFindings(deep("`${", "}`", PRINT_NESTING_LIMIT))).not.toThrow();
    // Templates side by side do not nest, however many there are.
    const siblings = `console.log(${"`${x}`, ".repeat(PRINT_NESTING_LIMIT + 1)}p.mrn);`;
    expect(entries(siblings)).toEqual(["mrn"]);
  });

  it("refuses a sample nested past the limit, naming its line and never its text", () => {
    for (const [label, code] of [
      ["groups", deep("(", ")", PRINT_NESTING_LIMIT + 1)],
      ["a template in groups", deep("(", ")", PRINT_NESTING_LIMIT).replace("x", "`x`")],
      ["brackets", deep("[{", "}]", 10_000)],
      ["templates", deep("`${", "}`", PRINT_NESTING_LIMIT + 1)],
      ["many templates", deep("`${", "}`", 10_000)],
      ["templates in groups", deep("(`${", "}`)", 10_000)],
    ]) {
      expect(() => samplePrintFindings(`\n${code}`), label).toThrow(DocsContentRefusal);
      expect(() => samplePrintFindings(`\n${code}`), label).toThrow(
        `nests groups and templates more than ${PRINT_NESTING_LIMIT} deep, at its line 2`,
      );
    }
  });

  // Read to the end of the sample for each throw, 40,000 throws took far past this timeout.
  it(
    "reads a thrown error on each of many lines in time linear in the sample",
    { timeout: 5_000 },
    () => {
      const code = "throw error;\n".repeat(40_000) + "throw p.mrn;\nthrow p.mrn\nthrow error";
      expect(entries(code)).toEqual(["mrn", "mrn"]);
      // A throw with no `;` ends at the next throw, which is read on its own.
      expect(samplePrintFindings("throw error\nthrow p.mrn")).toMatchObject([{ line: 2 }]);
    },
  );

  it("lets an error that is not about nesting through, as it is", () => {
    const readme = "```js\nconsole.log(x);\n```\n";
    // A list entry that is not a string fails as itself, not as a sample nested too deep.
    const extra = { accessors: [1 as unknown as string] };
    expect(() => examplePrintFindings({ pages: [], readme }, extra)).toThrow(TypeError);
  });
});

describe("the samples of a page", () => {
  it("reads each TypeScript and JavaScript fence, with the line of its first code line", () => {
    const text = [
      "# A page", //                                  1
      "", //                                          2
      "```ts", //                                     3
      "console.log(p.mrn);", //                       4
      "```", //                                       5
      "```json", //                                   6
      '{ "mrn": 1 }', //                              7
      "```", //                                       8
      "  ~~~~js no-run a listener that never closes", // 9
      "  a();", //                                    10
      "  ~~~", //                                     11
      "  b();", //                                    12
      "  ~~~~", //                                    13
      "````TSX", //                                   14
      "```", //                                       15
      "````", //                                      16
      "```sh", //                                     17
      "echo",
      "```",
      "```mjs",
      "last();",
    ].join("\n");
    expect(sampleBlocks(text)).toEqual([
      { line: 4, code: "console.log(p.mrn);" },
      { line: 10, code: "  a();\n  ~~~\n  b();" },
      { line: 15, code: "```" },
      { line: 21, code: "last();" },
    ]);
  });

  it("closes a fence only on a run of its own character, alone on its line", () => {
    const text = [
      "Text with ```ts in it",
      "```ts",
      "a();",
      "~~~",
      "a ```",
      "```x",
      "``` trailing",
      "b();",
      "```",
    ].join("\n");
    expect(sampleBlocks(text)).toEqual([
      { line: 3, code: "a();\n~~~\na ```\n```x\n``` trailing\nb();" },
    ]);
  });

  it("reads every language a sample runs as, and no other", () => {
    for (const language of SAMPLE_LANGUAGES) {
      expect(sampleBlocks(`\`\`\`${language}\nx\n\`\`\`\n`), language).toHaveLength(1);
    }
    for (const language of ["", "json", "sh", "text", "html"]) {
      expect(sampleBlocks(`\`\`\`${language}\nx\n\`\`\`\n`), language).toEqual([]);
    }
    expect(sampleBlocks("```json\nunclosed")).toEqual([]);
  });

  it("finds a print in the README and in each page, by the line in that file", () => {
    const page = {
      name: "quickstart",
      text: "---\nid: quickstart\n---\n\n```ts\nconsole.log(msg);\n```\n",
    };
    const readme = "# Lib\n\n```js\nconst a = 1;\nconsole.log(p.mrn);\n```\n";
    expect(examplePrintFindings({ pages: [page], readme })).toEqual([
      {
        file: "README.md",
        line: 5,
        rule: PRINT_RULE,
        message: expect.stringContaining('"mrn"'),
      },
      {
        file: "docs-content/quickstart.md",
        line: 6,
        rule: PRINT_RULE,
        message: expect.stringContaining('"msg" whole'),
      },
    ]);
    expect(examplePrintFindings({ pages: [], readme: null })).toEqual([]);
    expect(examplePrintFindings({ pages: [page] }, { wholeValues: [] }).map((f) => f.file)).toEqual(
      ["docs-content/quickstart.md"],
    );
  });
});

describe("the files it reads", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "docs-content-print-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function tree(label: string, files: Record<string, string>): string {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  const config = (value: unknown): Record<string, string> => ({
    [PRINT_CONFIG_FILE]: JSON.stringify(value),
  });

  it("reads no file as advisory, with the default lists", () => {
    expect(readPrintConfig(tree("no-config", {}))).toEqual({
      required: false,
      accessors: [],
      wholeValues: [],
      printers: [],
    });
    expect(readPrintConfig(tree("empty-config", config({})))).toEqual({
      required: false,
      accessors: [],
      wholeValues: [],
      printers: [],
    });
  });

  it("reads a library's settings", () => {
    const settings = {
      required: true,
      accessors: ["practiceAssignedId"],
      wholeValues: ["ds"],
      printers: ["out.print"],
    };
    expect(readPrintConfig(tree("config", config({ examplePrint: settings })))).toEqual(settings);
  });

  it("refuses a file it cannot take, naming what is wrong", () => {
    const refusals: [string, string, RegExp][] = [
      ["not-json", "{", /is not JSON/],
      ["array", "[]", /is not a JSON object/],
      ["null", "null", /is not a JSON object/],
      ["other-key", '{"other":1}', /holds "other"; the only key it takes is "examplePrint"/],
      ["rule-array", '{"examplePrint":[]}', /holds "examplePrint" that is not an object/],
      ["rule-null", '{"examplePrint":null}', /holds "examplePrint" that is not an object/],
      [
        "unknown-key",
        '{"examplePrint":{"strict":true}}',
        /holds "examplePrint.strict"; it takes only required, accessors, wholeValues, printers/,
      ],
      [
        "required-string",
        '{"examplePrint":{"required":"yes"}}',
        /holds "examplePrint.required" that is not true or false/,
      ],
      [
        "list-string",
        '{"examplePrint":{"accessors":"mrn"}}',
        /holds "examplePrint.accessors" that is not a list of names/,
      ],
      [
        "list-blank",
        '{"examplePrint":{"printers":["out.print"," "]}}',
        /holds "examplePrint.printers" that is not a list of names/,
      ],
      [
        "list-number",
        '{"examplePrint":{"wholeValues":[1]}}',
        /holds "examplePrint.wholeValues" that is not a list of names/,
      ],
    ];
    for (const [label, text, message] of refusals) {
      const dir = tree(`refuse-${label}`, { [PRINT_CONFIG_FILE]: text });
      expect(() => readPrintConfig(dir), label).toThrow(message);
    }
  });

  it("refuses a settings file or a README that is not a regular file", () => {
    const dir = tree("linked", { "real.json": "{}", "real.md": "# x\n" });
    symlinkSync(join(dir, "real.json"), join(dir, PRINT_CONFIG_FILE));
    symlinkSync(join(dir, "real.md"), join(dir, "README.md"));
    expect(() => readPrintConfig(dir)).toThrow(/is not a regular file/);
    expect(() => readReadme(dir)).toThrow(/is not a regular file/);
  });

  it("reads the README, or none", () => {
    expect(readReadme(tree("readme", { "README.md": "# Lib\n" }))).toBe("# Lib\n");
    expect(readReadme(tree("no-readme", {}))).toBeNull();
  });
});

describe("the command line", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "docs-content-print-cli-"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A page that keeps the front matter rules. */
  function page(name: string, body = "Text.\n"): string {
    const title = name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
    return (
      `---\nid: ${name}\ntitle: ${title}\nsidebar_label: ${name}\n` +
      `description: "A page about ${name}."\n---\n\n# ${name}\n\n${body}`
    );
  }

  /** The smallest tree that keeps the standard, with its quickstart's body and extra files. */
  function tree(label: string, quickstart: string, extra: Record<string, string> = {}): string {
    const dir = join(root, label);
    const files: Record<string, string> = {
      "docs-content/sidebars.json": JSON.stringify({
        docs: [
          "intro",
          { type: "category", label: "Installation", items: ["installation"] },
          { type: "category", label: "Quickstart", items: ["quickstart"] },
          { type: "category", label: "How-to guides", items: ["read-a-field"] },
          { type: "category", label: "Explanation", items: ["the-model"] },
          { type: "category", label: "Reference", items: ["limitations"] },
          { type: "category", label: "Troubleshooting", items: ["troubleshooting"] },
          ...QUALITY_PAGES,
        ],
      }),
      "docs-content/intro.md": page("intro"),
      "docs-content/installation.md": page("installation"),
      "docs-content/quickstart.md": page("quickstart", quickstart),
      "docs-content/read-a-field.md": page("read-a-field"),
      "docs-content/the-model.md": page("the-model"),
      "docs-content/limitations.md": page("limitations"),
      "docs-content/troubleshooting.md": page("troubleshooting"),
      ...Object.fromEntries(
        QUALITY_PAGES.map((name) => [
          `docs-content/${name}.md`,
          page(name, `${NUMBERS_HEADING}\n\n${NUMBERS_PLACEHOLDER}\n`),
        ]),
      ),
      ...extra,
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  function cli(dir: string): { code: number; out: string; err: string } {
    let out = "";
    let err = "";
    const code = runDocsContentCheck({
      dir,
      ratchet: {},
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    });
    return { code, out, err };
  }

  const printing = "```ts\nconst msg = parse(SAMPLE);\nconsole.log(msg.patient?.mrn);\n```\n";
  const readme = '# Lib\n\n```js\nconsole.log("SYNTHETIC-0001", msg);\n```\n';

  it("passes a tree whose samples print nothing identifying", () => {
    const dir = tree("clean", "```ts\nconsole.log(msg.meta.type);\n```\n", {
      "README.md": "# Lib\n\n```ts\nconsole.log(msg.warnings.length);\n```\n",
    });
    expect(cli(dir)).toEqual({ code: 0, out: "docs-content: OK (9 page(s) checked)\n", err: "" });
  });

  it("lists the prints and passes while the rule is advisory", () => {
    const dir = tree("advisory", printing, { "README.md": readme });
    expect(cli(dir)).toEqual({
      code: 0,
      out:
        "docs-content: 2 sample print(s) of an identifying value, advisory until " +
        'cosyte-docs-content.config.json sets "examplePrint": { "required": true }:\n' +
        '  README.md:4 [example-print] console.log prints "msg" whole, a message, segment, ' +
        "resource or person: print a type, a code or a count from it instead\n" +
        '  docs-content/quickstart.md:12 [example-print] console.log prints what "mrn" reads, ' +
        "which identifies a person: read it into a variable or assert on it, with its synthetic " +
        "value in a comment\n" +
        "docs-content: OK (9 page(s) checked)\n",
      err: "",
    });
  });

  it("fails on each print once the library requires the rule", () => {
    const dir = tree("required", printing, {
      "README.md": readme,
      [PRINT_CONFIG_FILE]: JSON.stringify({ examplePrint: { required: true } }),
    });
    const result = cli(dir);
    expect(result).toEqual({
      code: 1,
      out: "",
      err:
        "docs-content: 2 finding(s) in 9 page(s).\n" +
        '  README.md:4 [example-print] console.log prints "msg" whole, a message, segment, ' +
        "resource or person: print a type, a code or a count from it instead\n" +
        '  docs-content/quickstart.md:12 [example-print] console.log prints what "mrn" reads, ' +
        "which identifies a person: read it into a variable or assert on it, with its synthetic " +
        "value in a comment\n",
    });
    expect(result.err).not.toContain("SYNTHETIC");
  });

  it("passes a required rule over samples that print nothing identifying", () => {
    const dir = tree("required-clean", "```ts\nconsole.log(msg.meta.type);\n```\n", {
      [PRINT_CONFIG_FILE]: JSON.stringify({ examplePrint: { required: true } }),
    });
    expect(cli(dir).code).toBe(0);
  });

  it("reads the library's own entries", () => {
    const dir = tree("extended", "```ts\nconsole.log(r.practiceAssignedId);\n```\n", {
      [PRINT_CONFIG_FILE]: JSON.stringify({
        examplePrint: { required: true, accessors: ["practiceAssignedId"] },
      }),
    });
    expect(cli(dir)).toMatchObject({ code: 1, out: "" });
  });

  it("exits 2 on a sample nested past the limit, naming the file and line", () => {
    const nested = "```ts\n\n" + "(".repeat(PRINT_NESTING_LIMIT + 1) + "secret\n```\n";
    const result = cli(tree("too-deep", nested));
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toBe(
      "docs-content: docs-content/quickstart.md:12 nests groups and templates more than " +
        `${PRINT_NESTING_LIMIT} deep; the print rule reads no deeper. Nothing was checked.\n`,
    );
  });

  it("exits 2 when the settings file cannot be read, checking nothing", () => {
    const dir = tree("bad-config", printing, { [PRINT_CONFIG_FILE]: "{" });
    const result = cli(dir);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toMatch(
      /^docs-content: cosyte-docs-content\.config\.json is not JSON \(.+\)\. Nothing was checked\.\n$/,
    );
  });
});
