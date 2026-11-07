/**
 * Types for `@cosyte/script-utils/claude-card`: the checker for the CLAUDE.md card every Cosyte
 * repository keeps. The spec is `documentation/claude-card.md` in cosyte/config.
 */

/** The most lines a card may have, counted as `wc -l` counts them. */
export declare const CARD_MAX_LINES: 60;

/** The most characters (code points) a line may have, code blocks included. */
export declare const CARD_MAX_LINE_LENGTH: 100;

/** The most bytes of UTF-8 a card may have. */
export declare const CARD_MAX_BYTES: 5120;

/** The three sections, in order. */
export declare const CARD_SECTIONS: readonly ["Gate", "Hazard", "Rules"];

/** The line that imports AGENTS.md into the card. */
export declare const AGENTS_IMPORT: "@AGENTS.md";

/** A rule id a finding can carry. */
export type CardRule =
  | "title"
  | "intro"
  | "section-missing"
  | "section-order"
  | "section-extra"
  | "section-empty"
  | "lines"
  | "width"
  | "bytes"
  | "agents-import";

/** Every rule id, with what it requires. */
export declare const CARD_RULES: Readonly<Record<CardRule, string>>;

/** One place a card departs from the spec. */
export interface CardFinding {
  rule: CardRule;
  /** 1-based line, or 0 when the finding is about the whole file. */
  line: number;
  message: string;
}

export interface CardContext {
  /** Whether an AGENTS.md sits beside the card. Left out, the import rule is not checked. */
  agentsMd?: boolean;
}

/** Check a CLAUDE.md card against the spec. Returns no findings when it follows it. */
export declare function checkClaudeCard(text: string, context?: CardContext): CardFinding[];

export interface ClaudeCardGateOptions {
  /** The repository root holding CLAUDE.md. Default: the working directory. */
  dir?: string;
  /** CLI arguments; only `--dir <path>` is accepted. */
  argv?: string[];
}

/**
 * Run the checker over one repository and return the exit code: 0 the card follows the spec, 1 at
 * least one finding, 2 CLAUDE.md could not be read. It never exits the process.
 */
export declare function runClaudeCardGate(options?: ClaudeCardGateOptions): 0 | 1 | 2;
