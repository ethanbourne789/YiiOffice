/// The one XML escaper/decoder and the one A1 column-number conversion for the
/// whole gateway. Before this file the package carried 13 hand-written copies of
/// `escapeXml*` and 12 of the column arithmetic; the copies had already drifted
/// (some escaped quotes, some did not), which is exactly how a stray `"` in a
/// chart title or a comment author ends up producing a file Excel has to repair.

/**
 * Text *content* (`<t>…</t>`, `<f>…</f>`, `<definedName>…</definedName>`):
 * only `&`, `<` and `>` are markup-significant there. Quote characters are
 * legal verbatim, and escaping them would leave `&quot;` visible to anyone
 * reading the sheet XML by hand.
 */
export function escapeXmlText(input: string): string {
  return input.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Attribute *values*. On top of the text rules, `"` is escaped (every writer
 * here emits double-quoted attributes) and the three whitespace characters the
 * XML attribute-value normalization pass would otherwise fold into spaces — a
 * newline that must survive a round trip has to ride as `&#10;`.
 *
 * `'` is deliberately left literal: double-quoted attributes are legal with it,
 * Excel writes it that way, and escaping it would dirty every quoted sheet name
 * (`'Re"port'!$A$5`) in the file for no parsing benefit.
 */
export function escapeXmlAttribute(input: string): string {
  return escapeXmlText(input)
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\t', '&#9;')
}

const XML_NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&',
}

/**
 * Single-pass decode of the five XML named entities plus numeric character
 * references (`&#dd;` / `&#xhh;`), which some producers use for non-ASCII text.
 * Single-pass matters: sequential `replaceAll` decoding turns a literal
 * `&amp;lt;` into `<` instead of `&lt;`.
 */
export function unescapeXml(input: string): string {
  if (!input.includes('&')) return input
  return input.replace(
    /&(?:#x([0-9A-Fa-f]+)|#([0-9]+)|(quot|apos|lt|gt|amp));/g,
    (match, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
      if (named !== undefined) return XML_NAMED_ENTITIES[named] ?? match
      const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec)
      return code <= 0x10ffff ? String.fromCodePoint(code) : match
    },
  )
}

/** 0-based column index → A1 letters: `0 → "A"`, `25 → "Z"`, `26 → "AA"`. */
export function columnToLetters(column: number): string {
  let letters = ''
  let remaining = column + 1
  while (remaining > 0) {
    remaining -= 1
    letters = String.fromCharCode(65 + (remaining % 26)) + letters
    remaining = Math.floor(remaining / 26)
  }
  return letters
}

/** A1 letters → 0-based column index: `"A" → 0`, `"AA" → 26`. */
export function lettersToColumn(letters: string): number {
  let column = 0
  for (const character of letters) column = column * 26 + character.charCodeAt(0) - 64
  return column - 1
}

/** 0-based row/column → A1 reference: `toA1(0, 0) → "A1"`. */
export function toA1(row: number, column: number): string {
  return `${columnToLetters(column)}${row + 1}`
}
