import { stat } from "node:fs/promises";
import { parseFileToText } from "@yiioffice/file-parse";

/** larger files are indexed by name and folder only */
export const MAX_EXTRACT_BYTES = 64 * 1024 * 1024;
/** body text kept for snippets and indexed; longer files are cut */
export const MAX_BODY_CHARS = 1_000_000;

export type Extracted =
  | { kind: "text"; text: string }
  | { kind: "name-only" }
  | { kind: "error"; error: string };

export async function extractText(path: string): Promise<Extracted> {
  try {
    const st = await stat(path);
    if (st.size > MAX_EXTRACT_BYTES) return { kind: "name-only" };
    const parsed = await parseFileToText(path);
    if (parsed.kind === "unsupported") return { kind: "name-only" };
    if (!parsed.ok || parsed.kind !== "text")
      return { kind: "error", error: parsed.error ?? "parse failed" };
    return { kind: "text", text: (parsed.text ?? "").slice(0, MAX_BODY_CHARS) };
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
