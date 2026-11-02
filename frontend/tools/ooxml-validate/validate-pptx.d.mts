/**
 * Types for `tools/ooxml-validate/validate-pptx.mjs`.
 *
 * The validator is a plain ESM script (no build step), so it ships no declarations.
 * The pptx schema test suites import it directly; this file is what makes those
 * imports typecheck.
 */

/** One OOXML schema problem found in a single part. */
export interface OoxmlProblem {
  /** zip entry name, e.g. `ppt/slides/slide1.xml` */
  part: string
  /** validator message */
  message: string
}

/** True when `xmllint` and its OOXML schema set are installed. */
export function xmllintAvailable(): boolean

/**
 * Validates every XML/rels part of a .pptx.
 * Resolves to `[]` when the toolchain is missing (no fabricated failures).
 */
export function validatePptx(bytes: Uint8Array | ArrayBuffer): Promise<OoxmlProblem[]>

/** Problems introduced by an edit: present in `after` but not in `before`. */
export function newProblems(before: OoxmlProblem[], after: OoxmlProblem[]): OoxmlProblem[]
