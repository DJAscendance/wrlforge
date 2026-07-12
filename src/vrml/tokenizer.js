'use strict';
// VRML97 tokenizer (Phase 7A).
//
// Char stream -> token stream. Token-driven by design: the parser consumes THESE
// tokens, it does not re-scan text with regexes. Small regexes appear only inside
// single-character lexical helpers (digit/id classification), never as the
// parsing architecture.
//
// Every token carries an exact source span:
//   range.start / range.end = { offset (0-based), line (1-based), column (1-based) }
// plus the original `lexeme`. Trivia (whitespace, VRML's comma-as-whitespace, and
// comments) is preserved as `leadingTrivia` on the following token so a future
// formatter can round-trip, and comments are also collected in a flat list.
//
// LF and CRLF are both handled: a CRLF pair (and a lone CR) advances the line
// counter once and the raw lexeme still slices correctly from the source.
//
// Pure: text in, { tokens, comments, diagnostics } out. No fs, no Electron.

const { CODE, error } = require('./diagnostics');

// Token kinds. Keywords/booleans are split out from bare identifiers so the
// parser (and future syntax highlighter) can treat them as distinct classes.
const TT = Object.freeze({
  HEADER: 'header',
  COMMENT: 'comment', // only appears as trivia, never in the main token stream
  ID: 'id',
  KEYWORD: 'keyword',
  BOOL: 'bool',
  STRING: 'string',
  NUMBER: 'number',
  LBRACE: 'lbrace',
  RBRACE: 'rbrace',
  LBRACKET: 'lbracket',
  RBRACKET: 'rbracket',
  PERIOD: 'period',
  EOF: 'eof',
});

// Reserved words that tokenize as KEYWORD (TRUE/FALSE are BOOL instead). These
// cannot be used as node or field identifiers in VRML97.
const KEYWORDS = new Set([
  'DEF', 'USE', 'PROTO', 'EXTERNPROTO', 'IS', 'ROUTE', 'TO', 'NULL',
  'eventIn', 'eventOut', 'exposedField', 'field',
]);

// Characters that terminate an identifier / cannot appear inside one.
const ID_DELIM = new Set(['{', '}', '[', ']', '"', '#', ',', '.', '\\', "'"]);

function isWhitespace(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}
function isDigit(c) {
  return c >= '0' && c <= '9';
}
function isHexDigit(c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}
// An identifier may start with anything that isn't whitespace, a delimiter, a
// digit, or a leading sign (which begin numbers). VRML97 is permissive about the
// rest of the character set (incl. non-ASCII), so we classify by exclusion.
// VRML97 forbids control characters (0x00-0x20) and DEL in identifiers.
function isControl(c) {
  const code = c.charCodeAt(0);
  return code <= 0x20 || code === 0x7f;
}
// VRML97 identifier grammar (ISO/IEC 14772-1 § 4.6.3 / grammar): the FIRST char
// may not be a digit or `+`/`-` (those begin numbers); but `+` and `-` ARE valid
// as NON-first characters -- real Cybertown corpora use hyphenated DEF/event names
// like `phb_left-COORD` and `house3mini-ROT-INTERP`. So the two predicates differ
// only in whether `+`/`-`/digits may lead.
function isIdStart(c) {
  return c != null && !isControl(c) && !ID_DELIM.has(c) && !isDigit(c) && c !== '+' && c !== '-';
}
function isIdPart(c) {
  return c != null && !isControl(c) && !ID_DELIM.has(c);
}

function tokenize(source) {
  const src = String(source == null ? '' : source);
  const n = src.length;
  const tokens = [];
  const comments = [];
  const diagnostics = [];

  let i = 0;
  let line = 1;
  let col = 1;

  const pos = () => ({ offset: i, line, column: col });

  // Advance one source position, normalizing CRLF / lone CR to a single line
  // break for the counters (raw lexemes still slice by offset, keeping the CR).
  function advance() {
    const c = src[i];
    if (c === '\r') {
      i += 1;
      if (src[i] === '\n') i += 1;
      line += 1;
      col = 1;
      return;
    }
    if (c === '\n') {
      i += 1;
      line += 1;
      col = 1;
      return;
    }
    i += 1;
    col += 1;
  }

  const peek = (k = 0) => src[i + k];
  const spanFrom = (start) => ({ start, end: pos() });
  const lexeme = (startOffset) => src.slice(startOffset, i);

  // --- header (optional leading whitespace, then a `#VRML ...` first line) ---
    function tryHeader() {
    const save = { i, line, col };
    // Allow leading whitespace/blank lines before the header (lenient) -- but NOT
    // comments, since the header itself is a `#...` line we must not consume as one.
    const leading = [];
    while (i < n && isWhitespace(peek())) {
      const start = pos();
      const startOffset = i;
      while (i < n && isWhitespace(peek())) advance();
      leading.push({ kind: 'whitespace', lexeme: lexeme(startOffset), range: spanFrom(start) });
    }
    if (peek() === '#' && /^#VRML/i.test(src.slice(i))) {
      const start = pos();
      const startOffset = i;
      while (i < n && peek() !== '\n' && peek() !== '\r') advance();
      const text = lexeme(startOffset);
      const range = spanFrom(start);
      // #VRML V2.0 utf8  -> version "V2.0", encoding "utf8"
      const m = /^#VRML\s+(\S+)\s+(\S+)/.exec(text);
      const tok = {
        type: TT.HEADER,
        lexeme: text,
        version: m ? m[1] : null,
        encoding: m ? m[2] : null,
        range,
        leadingTrivia: leading,
      };
      tokens.push(tok);
      return true;
    }
    // Not a header -- rewind so the trivia we consumed re-attaches to token 1.
    i = save.i; line = save.line; col = save.col;
    return false;
  }

  // Collect whitespace, commas (VRML treats `,` as whitespace), and comments as
  // trivia. Comments are also pushed to the flat `comments` list.
  function readTrivia() {
    const trivia = [];
    while (i < n) {
      const c = peek();
      if (isWhitespace(c)) {
        const start = pos();
        const startOffset = i;
        while (i < n && isWhitespace(peek())) advance();
        trivia.push({ kind: 'whitespace', lexeme: lexeme(startOffset), range: spanFrom(start) });
      } else if (c === ',') {
        const start = pos();
        const startOffset = i;
        advance();
        trivia.push({ kind: 'comma', lexeme: lexeme(startOffset), range: spanFrom(start) });
      } else if (c === '#') {
        const start = pos();
        const startOffset = i;
        while (i < n && peek() !== '\n' && peek() !== '\r') advance();
        const t = { kind: 'comment', lexeme: lexeme(startOffset), range: spanFrom(start) };
        trivia.push(t);
        comments.push(t);
      } else {
        break;
      }
    }
    return trivia;
  }

  function readString() {
    const start = pos();
    const startOffset = i;
    advance(); // opening quote
    let value = '';
    let terminated = false;
    while (i < n) {
      const c = peek();
      if (c === '\\') {
        const next = peek(1);
        if (next === '"' || next === '\\') {
          value += next;
          advance();
          advance();
          continue;
        }
        // Unknown escape: keep the backslash literally (lenient).
        value += c;
        advance();
        continue;
      }
      if (c === '"') {
        advance();
        terminated = true;
        break;
      }
      // VRML97 quoted strings MAY span multiple lines (notably inline Script source
      // under `vrmlscript:`/`javascript:`). Newlines (LF, CRLF, lone CR) are kept in
      // the string; the decoded value normalizes every line break to '\n' while the
      // exact lexeme (which preserves CR) is sliced from the source. advance()
      // handles the CRLF/CR counter bookkeeping, so line/column stay exact.
      if (c === '\r' || c === '\n') {
        value += '\n';
        advance();
        continue;
      }
      value += c;
      advance();
    }
    const range = spanFrom(start);
    if (!terminated) {
      diagnostics.push(error(CODE.UNTERMINATED_STRING, 'Unterminated string literal', range,
        { expected: '"' }));
    }
    return { type: TT.STRING, lexeme: lexeme(startOffset), value, terminated, range };
  }

  function readNumber() {
    const start = pos();
    const startOffset = i;
    let valid = true;
    let numeric = 'int';

    if (peek() === '+' || peek() === '-') advance();

    if (peek() === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
      numeric = 'hex';
      advance(); // 0
      advance(); // x
      let any = false;
      while (i < n && isHexDigit(peek())) { advance(); any = true; }
      if (!any) valid = false;
    } else {
      let intDigits = 0;
      while (i < n && isDigit(peek())) { advance(); intDigits += 1; }
      if (peek() === '.') {
        numeric = 'float';
        advance();
        while (i < n && isDigit(peek())) advance();
      }
      if (peek() === 'e' || peek() === 'E') {
        numeric = 'float';
        advance();
        if (peek() === '+' || peek() === '-') advance();
        let expDigits = 0;
        while (i < n && isDigit(peek())) { advance(); expDigits += 1; }
        if (expDigits === 0) valid = false;
      }
      // A bare `.` or `+`/`-` with no digits at all is not a number.
      if (intDigits === 0 && numeric !== 'float') valid = false;
      if (numeric === 'float' && intDigits === 0 && !/\d/.test(lexeme(startOffset))) valid = false;
    }

    // If a NON-sign identifier character immediately follows (e.g. `12abc`, `0x`),
    // the lexeme is a malformed number rather than two tokens. `+`/`-` are excluded
    // here: `1-2` is two valid numbers (VRML has no operators), and a hyphen after a
    // number begins a new signed literal or a separator, never number-identifier glue.
    if (isIdPart(peek()) && peek() !== '.' && peek() !== '-' && peek() !== '+') {
      valid = false;
      while (i < n && isIdPart(peek()) && peek() !== '-' && peek() !== '+') advance();
    }

    const text = lexeme(startOffset);
    const range = spanFrom(start);
    let value;
    if (numeric === 'hex') value = parseInt(text.replace(/^[+-]?0x/i, (text[0] === '-' ? '-' : '')), 16);
    else value = numeric === 'float' ? parseFloat(text) : parseInt(text, 10);
    if (!Number.isFinite(value)) valid = false;
    if (!valid) {
      diagnostics.push(error(CODE.INVALID_NUMBER, `Invalid number literal '${text}'`, range));
    }
    return { type: TT.NUMBER, lexeme: text, value, numeric, valid, range };
  }

  function readIdentifier() {
    const start = pos();
    const startOffset = i;
    advance();
    while (i < n && isIdPart(peek())) advance();
    const text = lexeme(startOffset);
    const range = spanFrom(start);
    if (text === 'TRUE' || text === 'FALSE') {
      return { type: TT.BOOL, lexeme: text, value: text === 'TRUE', range };
    }
    if (KEYWORDS.has(text)) {
      return { type: TT.KEYWORD, lexeme: text, keyword: text, range };
    }
    return { type: TT.ID, lexeme: text, name: text, range };
  }

  function punct(kind) {
    const start = pos();
    const startOffset = i;
    advance();
    return { type: kind, lexeme: lexeme(startOffset), range: spanFrom(start) };
  }

  // --- main loop ---
  tryHeader();
  for (;;) {
    const trivia = readTrivia();
    if (i >= n) {
      tokens.push({ type: TT.EOF, lexeme: '', range: spanFrom(pos()), leadingTrivia: trivia });
      break;
    }
    const c = peek();
    let tok;
    if (c === '{') tok = punct(TT.LBRACE);
    else if (c === '}') tok = punct(TT.RBRACE);
    else if (c === '[') tok = punct(TT.LBRACKET);
    else if (c === ']') tok = punct(TT.RBRACKET);
    else if (c === '"') tok = readString();
    else if (c === '.') {
      if (isDigit(peek(1))) tok = readNumber();
      else tok = punct(TT.PERIOD);
    } else if (isDigit(c)) tok = readNumber();
    else if ((c === '+' || c === '-') && (isDigit(peek(1)) || (peek(1) === '.' && isDigit(peek(2))))) {
      tok = readNumber();
    } else if (isIdStart(c)) tok = readIdentifier();
    else {
      // Unknown character: emit a diagnostic and skip exactly one char so the
      // stream always makes progress (no infinite loop on garbage input).
      const start = pos();
      const startOffset = i;
      advance();
      diagnostics.push(error(CODE.UNEXPECTED_CHAR, `Unexpected character ${JSON.stringify(src[startOffset])}`,
        spanFrom(start)));
      continue;
    }
    tok.leadingTrivia = trivia;
    tokens.push(tok);
  }

  return { tokens, comments, diagnostics };
}

module.exports = { tokenize, TT, KEYWORDS };
