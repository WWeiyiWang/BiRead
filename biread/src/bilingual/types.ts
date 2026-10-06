export type Rect = [number, number, number, number];
export interface Glyph {
  text: string;
  rect: Rect;
  index: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
}
export interface Anchor {
  start: number;
  end: number;
  pageIndex: number;
  charIndex: number;
  rect: Rect;
}
export interface Segment {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  source: string;
  translation?: string;
  translationStart?: number;
  translationEnd?: number;
}
export type BlockKind =
  | "table-cell"
  | "title"
  | "heading"
  | "abstract"
  | "paragraph"
  | "list"
  | "caption"
  | "equation"
  | "reference"
  | "footnote";
export interface Block {
  id: string;
  kind: BlockKind;
  headingLevel?: number;
  sectionID?: string;
  sectionPath?: string[];
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  pageIndex: number;
  pageLabel: string;
  pageHeight: number;
  pageBox?: Rect;
  table?: {
    id: string;
    captionID: string;
    rect: Rect;
    columns: number[];
    row: number;
    column: number;
    colSpan: number;
    header: boolean;
    rows: number;
  };
  source: string;
  anchors: Anchor[];
  segments: Segment[];
  translation?: string;
  error?: string;
}
export interface PageFurniture {
  pageIndex: number;
  box: Rect;
  glyphs: Glyph[];
  rules: Rect[];
}
export const DOCUMENT_PARSER_VERSION = 2;
export interface DocumentData {
  version: 1;
  parserVersion?: number;
  identity: string;
  fingerprint: string;
  blocks: Block[];
  emptyPages: number[];
  furniture?: PageFurniture[];
}
export interface TranslationContext {
  provider: string;
  model: string;
  endpoint: string;
  mode: "academic" | "standard";
  glossary: Record<string, string>;
}
export interface LinkedAnnotation {
  logicalAnnotationID: string;
  type?: "highlight" | "underline";
  zoteroAnnotationKey: string;
  blockID: string;
  color: string;
  comment: string;
  source: { startOffset: number; endOffset: number; text: string };
  translation: { startOffset: number; endOffset: number; text: string };
}
