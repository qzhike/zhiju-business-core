/** A rejected package carries only paths from the validated outer ZIP. */
export class NestedArchiveError extends Error {
  readonly code = 'NESTED_ARCHIVE_NOT_ALLOWED' as const;

  constructor(readonly paths: readonly string[]) {
    super('NESTED_ARCHIVE_NOT_ALLOWED');
    this.name = 'NestedArchiveError';
  }
}

const ARCHIVE_EXTENSION =
  /\.(?:zipx?|rar|r\d{2,3}|z\d{2}|7z|tar|gz|tgz|bz2|tbz2?|xz|txz|zst|tzst|lz|lzma|lz4|z|cab|arj|ace|lzh|lha)(?:\.\d{3})?$/iu;

export function hasZipSignature(bytes: Buffer): boolean {
  return ['504b0304', '504b0506', '504b0708'].some((signature) =>
    bytes.subarray(0, 4).equals(Buffer.from(signature, 'hex')),
  );
}

function hasOtherArchiveSignature(bytes: Buffer): boolean {
  const signatures = [
    '526172211a0700', // RAR 4
    '526172211a070100', // RAR 5
    '377abcaf271c', // 7z
    '1f8b', // gzip
    '425a68', // bzip2
    'fd377a585a00', // xz
    '28b52ffd', // zstd
    '4d534346', // CAB
  ];
  return (
    signatures.some((signature) => {
      const magic = Buffer.from(signature, 'hex');
      return bytes.subarray(0, magic.length).equals(magic);
    }) || bytes.subarray(257, 262).equals(Buffer.from('ustar'))
  );
}

/** OOXML ZIPs require structural identification by the document classifier. */
export function isArchiveFile(name: string, bytes: Buffer): boolean {
  return (
    ARCHIVE_EXTENSION.test(name) ||
    hasOtherArchiveSignature(bytes) ||
    (hasZipSignature(bytes) && !/\.(?:docx|xlsx)$/iu.test(name))
  );
}
