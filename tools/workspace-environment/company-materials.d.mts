export declare function bytesHash(bytes: Uint8Array): string;
export declare function locateTemplate(
  bytes: Buffer,
  locator: string,
): { locator: string; offset: number; byteLength: number };
