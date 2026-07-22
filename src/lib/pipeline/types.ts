export type BlockType = "heading" | "paragraph" | "list_item" | "table" | "footnote";

export interface DocumentBlock {
  order: number;
  type: BlockType;
  text: string;
  page: number;
  heading_level?: number;
  heading_path: string[];
  char_start: number;
  char_end: number;
}

export interface DocumentLayout {
  parser_version: string;
  page_count: number;
  blocks: DocumentBlock[];
  full_text: string;
}
