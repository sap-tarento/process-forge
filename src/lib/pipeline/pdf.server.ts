import { extractText, getDocumentProxy } from "unpdf";
import type { DocumentBlock, DocumentLayout } from "./types";
import { PARSER_VERSION } from "./version";

interface RawTextBlock {
  text: string;
  page: number;
}

async function extractPagesFromPdf(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: false });
  return Array.isArray(text) ? text : [text];
}

// Heuristic heading detection for plain text and PDF page text.
function looksLikeHeading(line: string): { isHeading: boolean; level: number } {
  const trimmed = line.trim();
  if (!trimmed) return { isHeading: false, level: 0 };
  // Markdown
  const md = trimmed.match(/^(#{1,6})\s+/);
  if (md) return { isHeading: true, level: md[1].length };
  // Numbered: "1.", "1.1", "1.2.3", "7.2 Medical Equipment"
  const numbered = trimmed.match(/^(\d+(\.\d+)*\.?)\s+\S/);
  if (numbered && trimmed.length < 140) {
    const level = Math.min(numbered[1].split(".").filter(Boolean).length, 6);
    return { isHeading: true, level };
  }
  // ALL CAPS short line
  if (trimmed.length < 90 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && !/[.!?]$/.test(trimmed)) {
    return { isHeading: true, level: 2 };
  }
  return { isHeading: false, level: 0 };
}

function looksLikeListItem(line: string): boolean {
  return /^\s*(?:[-*•·]|\d+[.)]|[a-z][.)])\s+/.test(line);
}

function blocksFromLines(rawBlocks: RawTextBlock[]): DocumentLayout {
  const blocks: DocumentBlock[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let order = 0;
  let cursor = 0;
  let fullText = "";

  for (const rb of rawBlocks) {
    // Split page text into paragraphs on blank lines; fall back to line-by-line
    const paragraphs = rb.text
      .replace(/\r\n/g, "\n")
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    for (const para of paragraphs) {
      const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
      // If the paragraph is a single line that looks like a heading, treat it as one
      if (lines.length === 1) {
        const l = lines[0];
        const h = looksLikeHeading(l);
        if (h.isHeading) {
          while (headingStack.length && headingStack[headingStack.length - 1].level >= h.level) headingStack.pop();
          headingStack.push({ level: h.level, text: l.replace(/^#{1,6}\s+/, "") });
          const start = cursor;
          const end = cursor + l.length;
          blocks.push({
            order: order++,
            type: "heading",
            text: l.replace(/^#{1,6}\s+/, ""),
            page: rb.page,
            heading_level: h.level,
            heading_path: headingStack.map((h) => h.text),
            char_start: start,
            char_end: end,
          });
          fullText += l + "\n\n";
          cursor = fullText.length;
          continue;
        }
        if (looksLikeListItem(l)) {
          const start = cursor;
          const end = cursor + l.length;
          blocks.push({
            order: order++,
            type: "list_item",
            text: l,
            page: rb.page,
            heading_path: headingStack.map((h) => h.text),
            char_start: start,
            char_end: end,
          });
          fullText += l + "\n\n";
          cursor = fullText.length;
          continue;
        }
      }
      // Multi-line: check each line for list items, otherwise treat the whole paragraph
      const allListItems = lines.every(looksLikeListItem);
      if (allListItems && lines.length > 1) {
        for (const li of lines) {
          const start = cursor;
          const end = cursor + li.length;
          blocks.push({
            order: order++,
            type: "list_item",
            text: li,
            page: rb.page,
            heading_path: headingStack.map((h) => h.text),
            char_start: start,
            char_end: end,
          });
          fullText += li + "\n";
          cursor = fullText.length;
        }
        fullText += "\n";
        cursor = fullText.length;
      } else {
        const joined = lines.join(" ");
        const start = cursor;
        const end = cursor + joined.length;
        blocks.push({
          order: order++,
          type: "paragraph",
          text: joined,
          page: rb.page,
          heading_path: headingStack.map((h) => h.text),
          char_start: start,
          char_end: end,
        });
        fullText += joined + "\n\n";
        cursor = fullText.length;
      }
    }
  }

  return {
    parser_version: PARSER_VERSION,
    page_count: rawBlocks.length,
    blocks,
    full_text: fullText,
  };
}

export async function parsePdfBytes(bytes: Uint8Array): Promise<DocumentLayout> {
  const pages = await extractPagesFromPdf(bytes);
  return blocksFromLines(pages.map((text, i) => ({ text, page: i + 1 })));
}

export function parsePlainText(text: string): DocumentLayout {
  return blocksFromLines([{ text, page: 1 }]);
}
