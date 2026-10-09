export interface ImportCheck {
  importerKind: string;
  specifier: string;
  importerPath?: string;
}
export function evaluateImport(input: ImportCheck): string[];
export function scanSourceText(path: string, text: string): string[];
export function checkManifestData(
  path: string,
  manifest: Record<string, Record<string, string>>,
): string[];
