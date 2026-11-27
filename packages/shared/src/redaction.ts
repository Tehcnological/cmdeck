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
  /(\b(?:proxy-)?authorization["']?[ \t]*[:=][ \t]*["']?(?:(?:basic|bearer|token|digest)[ \t]+)?)[^\r\n"']+/gi,
  /(\b(?:set-)?cookie["']?[ \t]*[:=][ \t]*["']?)[^\r\n"']+/gi,
  /(\b[Bb]earer[ \t]+)[A-Za-z0-9._~+/-]{16,}=*/g,
  // `name=value`, `name: value`, `"name": "value"` where the name ends in a secret word.
  // `max_tokens: 4096` and `tokenCount=3` do not end in one.
  // A quoted value runs to its own closing quote (`"`, `'`, or the backtick Node's inspect uses),
  // skipping escaped characters, or to the end of the line when it never closes.
  new RegExp(
    String.raw`((?<![\w.-])[\w.-]*?${LABEL_NAME}["']?[ \t]*[:=][ \t]*(["'\x60]?))` +
      String.raw`(?!(?:null|undefined|true|false)\b|<redacted>)` +
      String.raw`(?:(?<=["'\x60])(?:\\.|(?!\2)[^\\\r\n])+|(?<!["'\x60])[^\s"'\x60,;&]{3,})`,
    "gi",
  ),
];

const PRIVATE_KEY_END = /-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;
// Long enough to keep a split END line, such as `-----END ENCRYPTED PRIVATE KEY BLOCK-----`.
const PRIVATE_KEY_END_MAX_LENGTH = 64;
const UNTERMINATED_PRIVATE_KEY =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?![\s\S]*-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----)/;

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

const applySpans = (text: string, spans: ReadonlyArray<Span>, upTo = text.length) => {
  let result = "";
  let at = 0;
  for (const span of spans) {
    if (span.start >= upTo) break;
    result += `${text.slice(at, span.keepEnd)}${REDACTED}`;
    at = span.end;
  }
  return result + text.slice(at, upTo);
};

/** Replaces every secret `SECRET_PATTERNS` finds with `[redacted]`, keeping its label. */
export const redactSecrets = (text: string): string => applySpans(text, secretSpans(text));

/**
 * Redacts a stream whose chunks may split a secret. `push` returns what is safe to emit and holds
 * back the unfinished last line plus any match that might still grow (such as an unterminated
 * private key), up to `maxHold` characters; `end` releases the rest.
 */
export const makeSecretRedactionStream = (maxHold = 16_384) => {
  let pending = "";
  // Set when a private key outgrew the hold and was flushed as `[redacted]`: what follows is still
  // key material until its END line, which may arrive split across chunks.
  let insideKey = false;
  return {
    push(chunk: string): string {
      pending += chunk;
      if (insideKey) {
        const end = PRIVATE_KEY_END.exec(pending);
        if (end === null) {
          pending = pending.slice(-PRIVATE_KEY_END_MAX_LENGTH);
          return "";
        }
        insideKey = false;
        pending = pending.slice(end.index + end[0].length);
      }
      const spans = secretSpans(pending);
      let cut = pending.lastIndexOf("\n") + 1;
      // A line that never ends cannot be held forever; keep a tail long enough for one token.
      if (pending.length > maxHold) cut = Math.max(cut, pending.length - 1024);
      for (const span of spans) {
        if (span.start < cut && (span.end > cut || span.end === pending.length)) cut = span.start;
      }
      if (pending.length - cut > maxHold) {
        cut = pending.length;
        insideKey = UNTERMINATED_PRIVATE_KEY.test(pending);
      }
      const out = applySpans(pending, spans, cut);
      pending = pending.slice(cut);
      return out;
    },
    end(): string {
      const out = insideKey ? "" : redactSecrets(pending);
      pending = "";
      insideKey = false;
      return out;
    },
  };
};
