import { gzipSync } from "node:zlib";

/**
 * A minimal ustar writer, which is all `pack-docs` needs to emit its two tarballs.
 *
 * Written against `node:zlib` and nothing else, so the package that every repo installs stays
 * hermetic: no npm tar implementation, and no dependence on a `tar` binary being on PATH in whatever
 * environment a consumer's release job runs in. The member set is passed in explicitly rather than
 * derived from a directory walk here, because "what is in the archive" is the part of the artifact
 * contract a caller is graded on.
 */

/** Bytes per tar block. Headers are one block and bodies are padded to a whole number of them. */
const BLOCK = 512;

/** Width of the header's `name` field. A longer name is split across `prefix` and `name`. */
const NAME_FIELD = 100;

/** Width of the header's `prefix` field, which carries the leading directories of a long name. */
const PREFIX_FIELD = 155;

/**
 * Thrown when a member cannot be represented in the ustar format this writer emits.
 *
 * @example
 * new TarError("a/very/long/name", "too long for the ustar format").member; // => "a/very/long/name"
 */
export class TarError extends Error {
  /** The member name that could not be represented. */
  readonly member: string;

  /** What about it could not be represented, and the action available, without the member name. */
  readonly reason: string;

  /**
   * @param member - The member name that could not be represented.
   * @param reason - What about it could not be represented, and the action available.
   */
  constructor(member: string, reason: string) {
    super(`${member}: ${reason}`);
    this.name = "TarError";
    this.member = member;
    this.reason = reason;
  }
}

/** One member of the archive: the name it carries at the archive root, and its bytes. */
export interface TarMember {
  /** The member's name inside the archive, always with forward slashes. */
  readonly name: string;
  /** The member's bytes. */
  readonly content: Buffer;
  /** The permission bits, as a number. */
  readonly mode: number;
  /** Modification time, in whole seconds since the epoch. */
  readonly mtime: number;
}

/** A fixed-width octal field: `width - 1` digits, NUL terminated. @internal */
function octalField(value: number, width: number): string {
  return `${Math.trunc(value)
    .toString(8)
    .padStart(width - 1, "0")}\0`;
}

/** Split a member name into the ustar `prefix` and `name` fields. @internal */
function splitName(name: string): { prefix: string; tail: string } {
  if (Buffer.byteLength(name, "utf8") <= NAME_FIELD) {
    return { prefix: "", tail: name };
  }
  for (let cut = name.indexOf("/"); cut !== -1; cut = name.indexOf("/", cut + 1)) {
    const prefix = name.slice(0, cut);
    const tail = name.slice(cut + 1);
    if (
      Buffer.byteLength(prefix, "utf8") <= PREFIX_FIELD &&
      Buffer.byteLength(tail, "utf8") <= NAME_FIELD
    ) {
      return { prefix, tail };
    }
  }
  throw new TarError(
    name,
    `too long for the ustar format (${String(Buffer.byteLength(name, "utf8"))} bytes, and no ` +
      `directory boundary splits it into ${String(PREFIX_FIELD)} plus ${String(NAME_FIELD)}): ` +
      `shorten the path and run the command again`,
  );
}

/** The 512-byte ustar header for one member, checksum included. @internal */
function header(member: TarMember): Buffer {
  const { prefix, tail } = splitName(member.name);
  const block = Buffer.alloc(BLOCK);
  block.write(tail, 0, NAME_FIELD, "utf8");
  block.write(octalField(member.mode & 0o7777, 8), 100, 8, "utf8");
  block.write(octalField(0, 8), 108, 8, "utf8");
  block.write(octalField(0, 8), 116, 8, "utf8");
  block.write(octalField(member.content.length, 12), 124, 12, "utf8");
  block.write(octalField(member.mtime, 12), 136, 12, "utf8");
  // The checksum is computed over a header whose own checksum field reads as eight spaces.
  block.write("        ", 148, 8, "utf8");
  block.write("0", 156, 1, "utf8");
  block.write("ustar\0", 257, 6, "utf8");
  block.write("00", 263, 2, "utf8");
  block.write(octalField(0, 8), 329, 8, "utf8");
  block.write(octalField(0, 8), 337, 8, "utf8");
  block.write(prefix, 345, PREFIX_FIELD, "utf8");

  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  return block;
}

/** Zero padding that rounds a body up to a whole number of blocks. @internal */
function padding(length: number): Buffer {
  const remainder = length % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

/**
 * Build a gzipped ustar archive from an explicit member list.
 *
 * Members are emitted in the order given, so a caller that wants a reproducible archive sorts them
 * before calling. Directory entries are not emitted: every extractor creates the parent directories
 * a member name implies.
 *
 * @param members - The members, in the order they should appear.
 * @returns The gzipped archive.
 * @throws TarError When a member name cannot be represented in the ustar format.
 * @example
 * createTarGz([{ name: "a.txt", content: Buffer.from("a"), mode: 0o644, mtime: 0 }]).length > 0;
 */
export function createTarGz(members: readonly TarMember[]): Buffer {
  const parts: Buffer[] = [];
  for (const member of members) {
    parts.push(header(member), member.content, padding(member.content.length));
  }
  // Two zero blocks close a tar archive.
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}
