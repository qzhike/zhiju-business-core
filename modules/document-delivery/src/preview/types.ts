import type { SourceRef } from '../domain/types.js';
import type { PREVIEW_PROFILE, PreviewReason } from './profile.js';

export interface PreviewCell {
  readonly text: string;
  readonly column: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}
export type PreviewSections =
  | { readonly format: 'MARKDOWN'; readonly source: string }
  | {
      readonly format: 'DOCX';
      readonly paragraphs: readonly {
        readonly position: number;
        readonly text: string;
        readonly style?: string;
      }[];
      readonly tables: readonly {
        readonly position: number;
        readonly rows: readonly { readonly cells: readonly PreviewCell[] }[];
      }[];
      readonly headersFooters: readonly { readonly part: string; readonly text: string }[];
      readonly comments: readonly {
        readonly id: string;
        readonly text: string;
        readonly paragraphs: readonly number[];
      }[];
      readonly revisions: readonly {
        readonly kind: 'ins' | 'del' | 'moveFrom' | 'moveTo';
        readonly id: string;
        readonly text: string;
      }[];
      readonly fields: readonly { readonly part: string; readonly text: string }[];
    };
export interface SourcePreview {
  readonly sourceRef: SourceRef;
  readonly manifestId: string;
  readonly fileName: string;
  readonly profileId: typeof PREVIEW_PROFILE;
  readonly status: 'AVAILABLE' | 'LIMITED' | 'UNSUPPORTED' | 'UNAVAILABLE';
  readonly limitations: readonly PreviewReason[];
  readonly sections?: PreviewSections;
}
export interface PreviewSource {
  readonly sourceRef: SourceRef;
  readonly manifestId: string;
  readonly fileName: string;
  readonly reasonCodes: readonly string[];
}
