/**
 * Types for `@cosyte/script-utils/agent-notes`: the checker for a repository's agent notes, one
 * file at `documentation/agent-notes.md` that CLAUDE.md points into as
 * `documentation/agent-notes.md#<anchor>` (RD4).
 *
 * Deprecated (D62): the agent notes were removed from every Cosyte repository. A repository with no
 * notes file passes `runAgentNotesCheck` with one line, and one that still has the file is checked
 * as before. This entry point stays until a minor release removes it.
 */

/**
 * The one place the notes live.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export declare const NOTES_PATH: "documentation/agent-notes.md";

/**
 * A rule id a finding can carry.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export type AgentNotesRule =
  | "layout"
  | "pointer-form"
  | "dangling"
  | "notes-missing"
  | "no-pointer"
  | "blank"
  | "empty-section"
  | "stale-citation";

/**
 * Every rule id, with what it requires.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export declare const AGENT_NOTES_RULES: Readonly<Record<AgentNotesRule, string>>;

/**
 * Raised when the check cannot run; the CLI turns it into exit 2.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export declare class AgentNotesRefusal extends Error {}

/**
 * GitHub's heading slug, as github-slugger writes it.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export declare function slugify(text: string): string;

/**
 * A slugger that suffixes repeats as GitHub does: the second `Setup` is `setup-1`.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export declare function makeSlugger(): (text: string) => string;

/**
 * One heading of the notes.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export interface NotesHeading {
  level: number;
  text: string;
  /** 0-based line. */
  line: number;
  slug: string;
  /** Nothing under it, and not a container followed by a deeper heading. */
  empty: boolean;
}

/**
 * The anchors a notes file offers (heading slugs and explicit `<a id>` or `<a name>` targets) and
 * its headings.
 *
 * @throws {AgentNotesRefusal} On an HTML comment that never closes.
 * @deprecated Retired with the agent notes (D62).
 */
export declare function readNotes(text: string): { targets: Set<string>; headings: NotesHeading[] };

/**
 * One place the notes or a pointer depart from RD4.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export interface AgentNotesFinding {
  rule: AgentNotesRule;
  file: string;
  /** 1-based line, or 0 for the whole file. */
  line: number;
  message: string;
}

/**
 * What `checkAgentNotes` reads.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export interface AgentNotesInput {
  /** CLAUDE.md's contents, or `null` when the repository has none. */
  claude: string | null;
  /** The notes' contents, or `null` when the repository has none. */
  notes: string | null;
  /** Every other tracked text file, scanned for pointers. */
  files: { path: string; text: string }[];
  /** Whether a `documentation/agent-notes/` directory is tracked. */
  notesDirectory?: boolean;
  /** Whether the repository has its own `documentation/decisions/0023-*`. */
  localDecision0023?: boolean;
}

/**
 * Check the notes and every pointer into them.
 *
 * @throws {AgentNotesRefusal} When the notes cannot be read to the end.
 * @deprecated Retired with the agent notes (D62).
 */
export declare function checkAgentNotes(input: AgentNotesInput): AgentNotesFinding[];

/**
 * What `runAgentNotesCheck` takes.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export interface AgentNotesCheckOptions {
  /** The repository root. Default: the working directory. */
  dir?: string;
  /** CLI arguments; only `--dir <path>` is accepted. */
  argv?: string[];
}

/**
 * Run the checker over one repository's tracked files and return the exit code: 0 clean, 1 at
 * least one finding, 2 the check could not run. A repository with no notes file is clean: it gets
 * one line, `agent notes: OK, no agent notes (retired, D62)`. It never exits the process.
 *
 * @deprecated Retired with the agent notes (D62).
 */
export declare function runAgentNotesCheck(options?: AgentNotesCheckOptions): 0 | 1 | 2;
