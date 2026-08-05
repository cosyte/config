/**
 * Is this module the file Node was pointed at, rather than one imported by something else?
 *
 * Compares the caller's module URL against `process.argv[1]` as PATHS, tolerating the three
 * divergences a raw string comparison gets wrong: an extension-less specifier that Node or a
 * loader resolved, percent-encoding in the module URL, and a symlinked invocation.
 *
 * When the answer is genuinely ambiguous it returns `true`, so an unsure gate runs loudly rather
 * than skipping silently.
 *
 * @param moduleUrl The calling module's `import.meta.url`.
 * @returns `true` when this module is the process entry point.
 * @throws {TypeError} When `moduleUrl` is not a non-empty string.
 */
export declare function isCliEntrypoint(moduleUrl: string): boolean;
