// Ported from kirodotdev/KiroCrew@b75544f0dbef43b7340800819b36ae6cf9fbc2bd
// src/kiro_crew/knowledge/chunker.py (Apache-2.0): the token estimate and recursive separator split.
// Changes: TypeScript; no overlap between chunks; a document past the chunk cap keeps its first
// chunks instead of merging neighbours; each chunk records only its first line.

const CHUNK_TOKEN_SIZE = 800;
const MAX_CHUNKS_PER_FILE = 50;
const SEPARATORS = ["\n\n", "\n", " "];

// Scripts written without spaces between words; each character counts as a token. Hangul is left
// out: Korean separates its words with spaces.
const UNSPACED = /[฀-໿က-႟ក-៿　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/gu;
const isUnspaced = (char: string) => new RegExp(UNSPACED.source, "u").test(char);

const charTokens = (char: string) => (isUnspaced(char) ? 1 : /\s/u.test(char) ? 0 : 0.25);

/** About 1.3 tokens a word; a run holding unspaced script is priced per character. */
const wordCount = (text: string): number => {
  let words = 0;
  let extra = 0;
  for (const run of text.split(/\s+/u)) {
    if (run === "") continue;
    const unspaced = run.match(UNSPACED)?.length ?? 0;
    if (unspaced > 0) extra += unspaced + (run.length - unspaced) / 4;
    else words += 1;
  }
  return Math.floor(words * 1.3 + extra);
};

/** One separator-free run cut into slices under the target. */
const cutRun = (run: string, target: number): Array<string> => {
  const pieces: Array<string> = [];
  let start = 0;
  let cost = 0;
  const chars = [...run];
  chars.forEach((char, index) => {
    const step = charTokens(char);
    if (cost + step > target && index > start) {
      pieces.push(chars.slice(start, index).join(""));
      start = index;
      cost = 0;
    }
    cost += step;
  });
  pieces.push(chars.slice(start).join(""));
  return pieces;
};

const recursiveSplit = (
  text: string,
  separators: ReadonlyArray<string>,
  target: number,
): Array<string> => {
  if (wordCount(text) <= target) return text.trim() === "" ? [] : [text.trim()];
  if (separators.length === 0) {
    const targetWords = Math.max(1, Math.floor(target / 1.3));
    const chunks: Array<string> = [];
    let group: Array<string> = [];
    for (const run of text.split(/\s+/u)) {
      if (run === "") continue;
      if (wordCount(run) > target) {
        if (group.length > 0) chunks.push(group.join(" "));
        group = [];
        chunks.push(...cutRun(run, target));
        continue;
      }
      if (
        group.length > 0 &&
        (group.length >= targetWords || wordCount([...group, run].join(" ")) > target)
      ) {
        chunks.push(group.join(" "));
        group = [];
      }
      group.push(run);
    }
    if (group.length > 0) chunks.push(group.join(" "));
    return chunks;
  }
  const [separator, ...rest] = separators as [string, ...Array<string>];
  const chunks: Array<string> = [];
  let current = "";
  for (const piece of text.split(separator)) {
    const candidate = current === "" ? piece : current + separator + piece;
    if (wordCount(candidate) <= target) {
      current = candidate;
      continue;
    }
    if (current.trim() !== "") chunks.push(current.trim());
    if (wordCount(piece) > target) {
      chunks.push(...recursiveSplit(piece, rest, target));
      current = "";
    } else {
      current = piece;
    }
  }
  if (current.trim() !== "") chunks.push(current.trim());
  return chunks;
};

export interface Chunk {
  readonly lineStart: number;
  readonly content: string;
}

/** Splits text into chunks of about `target` tokens, each with the line it starts on (1-based). */
export const chunkText = (text: string, target = CHUNK_TOKEN_SIZE): ReadonlyArray<Chunk> => {
  // shortcut: a document past the cap keeps only its first chunks; merge neighbours (as Kiro Crew
  // does) if long documents turn out to matter.
  const pieces = recursiveSplit(text, SEPARATORS, target).slice(0, MAX_CHUNKS_PER_FILE);
  let cursor = 0;
  let line = 1;
  return pieces.map((content) => {
    const first = content.split(/\s/u, 1)[0] ?? "";
    const at = text.indexOf(first, cursor);
    if (at >= cursor) {
      for (let index = cursor; index < at; index++) if (text.charCodeAt(index) === 10) line++;
      cursor = at;
    }
    return { lineStart: line, content };
  });
};
