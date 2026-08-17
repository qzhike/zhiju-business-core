import { validate as validateUuid, v7 as uuidv7, version as uuidVersion } from 'uuid';

declare const uuidV7Brand: unique symbol;

export type UuidV7 = string & { readonly [uuidV7Brand]: true };

export function isUuidV7(value: string): value is UuidV7 {
  return validateUuid(value) && uuidVersion(value) === 7;
}

export function parseUuidV7(value: string): UuidV7 {
  if (!isUuidV7(value)) {
    throw new TypeError('expected an RFC 9562 UUID version 7 string');
  }
  return value;
}

export function newUuidV7(): UuidV7 {
  return parseUuidV7(uuidv7());
}
