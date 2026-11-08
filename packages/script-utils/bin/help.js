// Not a bin: the one answer every gate bin gives to `--help` and `-h`, written once beside them.
//
// A gate asked for its help checks nothing. At a terminal that is what was asked for, so the help
// goes to stdout and the exit is 0. Under CI it is a trap: a package script that ends in `--help`
// passes a required check having checked nothing (`"attw": "cosyte-attw --help"` did exactly that).
// So when `CI` is set to anything but an empty string, `false` or `0`, which is how GitHub Actions
// and the other common runners announce themselves, the help goes to stderr, a refusal follows it,
// and the bin exits 2, the code every gate here uses for "did not run".

/**
 * Whether this process runs under CI, read the way the common runners set it.
 *
 * @param {Record<string, string | undefined>} [env] The environment to read.
 * @returns {boolean} True when `CI` is set to anything but an empty string, `false` or `0`.
 */
export function underCi(env = process.env) {
  const value = env.CI;
  return value !== undefined && value !== "" && value !== "false" && value !== "0";
}

/**
 * Answer `--help`: print the help and return 0, or under CI print it to stderr with a refusal and
 * return 2.
 *
 * @param {string} name The bin's name, for the refusal line.
 * @param {string} help The help text.
 * @param {Record<string, string | undefined>} [env] The environment to read.
 * @returns {number} The exit code.
 */
export function answerHelp(name, help, env = process.env) {
  if (!underCi(env)) {
    process.stdout.write(help);
    return 0;
  }
  process.stderr.write(help);
  process.stderr.write(
    `${name}: refusing --help under CI (CI=${env.CI}). It prints this text and checks nothing, ` +
      "so a CI step that runs it must not pass. Run the gate without --help.\n",
  );
  return 2;
}
