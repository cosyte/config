// A small delimited-message parser, written for the large-case calibration only: segments split on
// carriage returns, fields on `|`, repetitions on `~`, components on `^`, each level kept as an
// object, and every segment indexed by its type. It does the kind of work a message parser does on
// a large input (many short strings and small objects, all live until the call returns), so a call
// on a few MiB takes longer than a warmup batch and builds a heap of a few hundred MiB. It is not a
// parser any package ships.

/** Parse one field into its repetitions and their components. */
function parseField(text, position) {
  const repetitions = text.split("~").map((repetition, index) => ({
    index,
    components: repetition.split("^").map((value, at) => ({ at, value, empty: value === "" })),
  }));
  return { position, text, repetitions };
}

/** Parse one message into its segments, and index them by type. */
export function parseMessage(text) {
  const segments = [];
  const byType = new Map();
  for (const line of text.split("\r")) {
    if (line === "") continue;
    const fields = line.split("|").map(parseField);
    const segment = { type: fields[0].text, fields };
    segments.push(segment);
    const list = byType.get(segment.type) ?? [];
    list.push(segment);
    byType.set(segment.type, list);
  }
  return { segments, byType, count: segments.length };
}
