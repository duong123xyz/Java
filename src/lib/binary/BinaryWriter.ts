/**
 * BinaryWriter: Big-Endian binary serializer for JVM class files.
 * Handles dynamic buffer growth, strict bounds-checking for u1/u2/u4, and endianness.
 */
export class BinaryWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset: number;

  constructor(initialCapacity = 8192) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
    this.offset = 0;
  }

  private ensureCapacity(neededBytes: number): void {
    const required = this.offset + neededBytes;
    if (required <= this.buffer.length) {
      return;
    }

    let newCap = this.buffer.length * 2;
    while (newCap < required) {
      newCap *= 2;
    }

    const newBuffer = new Uint8Array(newCap);
    newBuffer.set(this.buffer.subarray(0, this.offset));
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer.buffer);
  }

  public getLength(): number {
    return this.offset;
  }

  public getOffset(): number {
    return this.offset;
  }

  public setOffset(newOffset: number): void {
    if (newOffset < 0 || newOffset > this.offset) {
      throw new Error(`Invalid offset: ${newOffset}, current length: ${this.offset}`);
    }
    this.offset = newOffset;
  }

  public writeU1(value: number): void {
    if (value < 0 || value > 0xff || !Number.isInteger(value)) {
      throw new Error(`writeU1 value out of bounds [0..255]: ${value}`);
    }
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  public writeU2(value: number): void {
    if (value < 0 || value > 0xffff || !Number.isInteger(value)) {
      throw new Error(`writeU2 value out of bounds [0..65535]: ${value}`);
    }
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, false); // Big-Endian
    this.offset += 2;
  }

  public writeU4(value: number): void {
    if (value < 0 || value > 0xffffffff || !Number.isInteger(value)) {
      throw new Error(`writeU4 value out of bounds [0..4294967295]: ${value}`);
    }
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, false); // Big-Endian
    this.offset += 4;
  }

  public writeI4(value: number): void {
    if (value < -0x80000000 || value > 0x7fffffff || !Number.isInteger(value)) {
      throw new Error(`writeI4 value out of signed 32-bit bounds: ${value}`);
    }
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, value, false); // Big-Endian
    this.offset += 4;
  }

  public writeF4(value: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this.offset, value, false); // Big-Endian
    this.offset += 4;
  }

  public writeF8(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, value, false); // Big-Endian
    this.offset += 8;
  }

  public writeBytes(bytes: Uint8Array | ArrayBuffer | number[]): void {
    let uint8: Uint8Array;
    if (bytes instanceof Uint8Array) {
      uint8 = bytes;
    } else if (bytes instanceof ArrayBuffer) {
      uint8 = new Uint8Array(bytes);
    } else {
      uint8 = new Uint8Array(bytes);
    }

    if (uint8.length === 0) return;

    this.ensureCapacity(uint8.length);
    this.buffer.set(uint8, this.offset);
    this.offset += uint8.length;
  }

  public toUint8Array(): Uint8Array {
    return this.buffer.slice(0, this.offset);
  }

  public toArrayBuffer(): ArrayBuffer {
    const copy = new Uint8Array(this.offset);
    copy.set(this.buffer.subarray(0, this.offset));
    return copy.buffer;
  }
}
