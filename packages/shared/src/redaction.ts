// Best effort: catches well-known credential formats and explicitly labelled values only. An
// unlabelled secret in an unfamiliar format passes through; there is no entropy guessing, so
// hashes, ids and ordinary base64 stay readable. Apply at egress (logs, exports, outbound
// messages), never to stored transcripts.

const REDACTED = "[redacted]";

const LABEL_NAME =
  /(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)/.source;

/**
 * Every rule's whole match is the secret. A rule's first capture group, when present, is a
 * leading label `redactSecrets` keeps visible (`password=`, `Bearer `, `https://user:`).
 */
export const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // PEM private keys; an unterminated block runs to the end of the text.
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bxapp-\d-[A-Za-z0-9-]{10,}/g,
  /(\bhttps:\/\/hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g,
  /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
  // Anthropic (`sk-ant-`) and OpenAI (`sk-`, `sk-proj-`, `sk-svcacct-`) API keys.
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{36}|hf_[A-Za-z0-9]{30,}|AIza[A-Za-z0-9_-]{35}|[rs]k_(?:live|test)_[A-Za-z0-9]{16,})/g,
  // A JWT's header and payload are both base64url JSON objects.
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  // The scheme starts only where a run of scheme characters starts and is capped, so a long run
  // like `a-a-a-…` is scanned once rather than from every word boundary.
  /((?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/?#@:]*:)[^\s/?#]+(?=@[^\s/?#@])/gi,
  // A header serialized inside quotes ends at its own closing quote (an empty one matches nothing);
  // a bare header runs to the end of the line, quotes and all (`session="…"`, Digest's `response="…"`).
  /(\b(?:proxy-)?authorization["']?[ \t]*[:=][ \t]*(["'])(?:(?:basic|bearer|token|digest)[ \t]+)?)(?:\\.|(?!\2)[^\\\r\n])+/gi,
  /(\b(?:proxy-)?authorization["']?[ \t]*[:=][ \t]*(?!["'])(?:(?:basic|bearer|token|digest)[ \t]+)?)[^\r\n]+/gi,
  /(\b(?:set-)?cookie["']?[ \t]*[:=][ \t]*(["']))(?:\\.|(?!\2)[^\\\r\n])+/gi,
  /(\b(?:set-)?cookie["']?[ \t]*[:=][ \t]*(?!["']))[^\r\n]+/gi,
  /(\b[Bb]earer[ \t]+)[A-Za-z0-9._~+/-]{16,}=*/g,
  // `name=value` / `"name": "value"` where the name ends in a secret word (not `max_tokens`).
  // A quoted value runs to its own closing quote (Node's inspect may use a backtick), past escapes.
  // Only a whole unquoted `null`/`undefined`/`true`/`false` is exempt, never `true-horse-…`.
  new RegExp(
    String.raw`((?<![\w.-])[\w.-]*?${LABEL_NAME}["']?[ \t]*[:=][ \t]*(["'\x60]?))(?!<redacted>)` +
      String.raw`(?:(?<=["'\x60])(?:\\.|(?!\2)[^\\\r\n])+|(?<!["'\x60])` +
      String.raw`(?!(?:null|undefined|true|false)(?![^\s"'\x60,;&]))[^\s"'\x60,;&]{3,})`,
    "gi",
  ),
];

interface Span {
  readonly start: number;
  keepEnd: number;
  end: number;
}

const secretSpans = (text: string): Array<Span> => {
  const spans = SECRET_PATTERNS.flatMap((pattern) =>
    Array.from(text.matchAll(pattern), (match) => ({
      start: match.index,
      keepEnd: match.index + (match[1]?.length ?? 0),
      end: match.index + match[0].length,
    })),
  ).sort((a, b) => a.start - b.start);
  // Overlapping matches redact as one; a kept label never extends into another match's secret.
  const merged: Array<Span> = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
      last.keepEnd = Math.min(last.keepEnd, span.keepEnd);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
};

/** Replaces every secret `SECRET_PATTERNS` finds with `[redacted]`, keeping its label. */
export const redactSecrets = (text: string): string => {
  let result = "";
  let at = 0;
  for (const span of secretSpans(text)) {
    result += `${text.slice(at, span.keepEnd)}${REDACTED}`;
    at = span.end;
  }
  return result + text.slice(at);
};
