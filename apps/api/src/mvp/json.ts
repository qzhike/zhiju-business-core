/**
 * Bounded strict JSON for MVP01: strict UTF-8, exactly one JSON value, no
 * duplicate object keys, no control characters in strings and no excessive
 * nesting. `JSON.parse` runs only after this scan so the accepted value cannot
 * differ from the validated token stream.
 */
export class StrictJsonError extends Error {
  constructor() {
    super('INVALID_REQUEST');
    this.name = 'StrictJsonError';
  }
}

const MAX_DEPTH = 64;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

class Scanner {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  #fail(): never {
    throw new StrictJsonError();
  }

  #skip(): void {
    while (this.#index < this.#text.length) {
      const ch = this.#text[this.#index];
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
      this.#index++;
    }
  }

  #peek(): string | undefined {
    return this.#text[this.#index];
  }

  #string(): string {
    if (this.#peek() !== '"') this.#fail();
    this.#index++;
    let value = '';
    for (;;) {
      const ch = this.#text[this.#index];
      if (ch === undefined) this.#fail();
      this.#index++;
      if (ch === '"') return value;
      if (ch === '\\') {
        const escape = this.#text[this.#index];
        if (escape === undefined) this.#fail();
        this.#index++;
        if (escape === 'u') {
          const hex = this.#text.slice(this.#index, this.#index + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) this.#fail();
          this.#index += 4;
          continue;
        }
        if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) this.#fail();
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) this.#fail();
      value += ch;
    }
  }

  #number(): void {
    const rest = this.#text.slice(this.#index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(rest);
    if (match === null || match[0].length === 0) this.#fail();
    this.#index += match[0].length;
  }

  #literal(value: string): void {
    if (this.#text.slice(this.#index, this.#index + value.length) !== value) this.#fail();
    this.#index += value.length;
  }

  #value(depth: number): void {
    if (depth > MAX_DEPTH) this.#fail();
    this.#skip();
    const ch = this.#peek();
    if (ch === '{') {
      this.#object(depth);
      return;
    }
    if (ch === '[') {
      this.#array(depth);
      return;
    }
    if (ch === '"') {
      this.#string();
      return;
    }
    if (ch === 't') {
      this.#literal('true');
      return;
    }
    if (ch === 'f') {
      this.#literal('false');
      return;
    }
    if (ch === 'n') {
      this.#literal('null');
      return;
    }
    this.#number();
  }

  #object(depth: number): void {
    this.#index++;
    this.#skip();
    if (this.#peek() === '}') {
      this.#index++;
      return;
    }
    const keys = new Set<string>();
    for (;;) {
      this.#skip();
      const key = this.#string();
      if (keys.has(key)) this.#fail();
      keys.add(key);
      this.#skip();
      if (this.#peek() !== ':') this.#fail();
      this.#index++;
      this.#value(depth + 1);
      this.#skip();
      const delimiter = this.#peek();
      if (delimiter === ',') {
        this.#index++;
        continue;
      }
      if (delimiter === '}') {
        this.#index++;
        return;
      }
      this.#fail();
    }
  }

  #array(depth: number): void {
    this.#index++;
    this.#skip();
    if (this.#peek() === ']') {
      this.#index++;
      return;
    }
    for (;;) {
      this.#value(depth + 1);
      this.#skip();
      const delimiter = this.#peek();
      if (delimiter === ',') {
        this.#index++;
        continue;
      }
      if (delimiter === ']') {
        this.#index++;
        return;
      }
      this.#fail();
    }
  }

  scan(): void {
    this.#value(0);
    this.#skip();
    if (this.#index !== this.#text.length) this.#fail();
  }
}

export function parseStrictJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new StrictJsonError();
  }
  new Scanner(text).scan();
  return JSON.parse(text) as unknown;
}
