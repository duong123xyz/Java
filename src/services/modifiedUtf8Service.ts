/**
 * Java Modified UTF-8 length calculator and encoder.
 * According to JVM Specification (§4.4.7):
 * - Characters in '\u0001' to '\u007F' are encoded in 1 byte.
 * - Null character '\u0000' and characters in '\u0080' to '\u07FF' are encoded in 2 bytes.
 * - Characters in '\u0800' to '\uFFFF' are encoded in 3 bytes.
 * - Supplementary characters (codepoints > 0xFFFF, represented by surrogate pairs in JS/Java)
 *   are encoded in 6 bytes (two 3-byte surrogate halves).
 */

export function getModifiedUtf8ByteLength(str: string): number {
  let length = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x0001 && code <= 0x007f) {
      length += 1;
    } else if (code === 0x0000 || (code >= 0x0080 && code <= 0x07ff)) {
      length += 2;
    } else {
      length += 3;
    }
  }
  return length;
}

export function encodeModifiedUtf8(str: string): Uint8Array {
  const byteLen = getModifiedUtf8ByteLength(str);
  const out = new Uint8Array(byteLen);
  let ptr = 0;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x0001 && code <= 0x007f) {
      out[ptr++] = code;
    } else if (code === 0x0000 || (code >= 0x0080 && code <= 0x07ff)) {
      out[ptr++] = 0xc0 | ((code >> 6) & 0x1f);
      out[ptr++] = 0x80 | (code & 0x3f);
    } else {
      out[ptr++] = 0xe0 | ((code >> 12) & 0x0f);
      out[ptr++] = 0x80 | ((code >> 6) & 0x3f);
      out[ptr++] = 0x80 | (code & 0x3f);
    }
  }

  return out;
}
