export interface PhysicalLine {
  number: number;
  text: string;
  ending: 'LF' | 'CRLF' | 'NONE';
  raw: string;
}

/** LF is the only physical separator. Keep BOM, CR, whitespace and final terminators. */
export function physicalLines(text: string): PhysicalLine[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (text.endsWith('\n')) parts.pop();
  return parts.map((value, index) => {
    const terminated = index < parts.length - 1 || text.endsWith('\n');
    const crlf = terminated && value.endsWith('\r');
    return {
      number: index + 1,
      text: crlf ? value.slice(0, -1) : value,
      ending: terminated ? (crlf ? 'CRLF' : 'LF') : 'NONE',
      raw: value + (terminated ? '\n' : ''),
    };
  });
}
