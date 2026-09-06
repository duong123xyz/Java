export class BinaryReader {
  private view: DataView;
  private offset: number;
  private readonly length: number;
  private readonly buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer, offset = 0, length = buffer.byteLength) {
    this.buffer = buffer;
    this.offset = offset;
    this.length = length;
    this.view = new DataView(buffer, 0, length);
  }

  public getOffset(): number {
    return this.offset;
  }

  public setOffset(offset: number): void {
    if (offset < 0 || offset > this.length) {
      throw new Error(`Offset out of bounds: ${offset}, total length: ${this.length}`);
    }
    this.offset = offset;
  }

  public remaining(): number {
    return this.length - this.offset;
  }

  public getByteLength(): number {
    return this.length;
  }

  private checkBounds(bytesNeeded: number): void {
    if (this.offset + bytesNeeded > this.length) {
      throw new Error(
        `Unexpected EOF: attempted to read ${bytesNeeded} byte(s) at offset ${this.offset} of ${this.length}`
      );
    }
  }

  public readU1(): number {
    this.checkBounds(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  public readU2(): number {
    this.checkBounds(2);
    const value = this.view.getUint16(this.offset, false); // Big-Endian
    this.offset += 2;
    return value;
  }

  public readU4(): number {
    this.checkBounds(4);
    const value = this.view.getUint32(this.offset, false); // Big-Endian
    this.offset += 4;
    return value;
  }

  public readI4(): number {
    this.checkBounds(4);
    const value = this.view.getInt32(this.offset, false); // Big-Endian
    this.offset += 4;
    return value;
  }

  public readF4(): number {
    this.checkBounds(4);
    const value = this.view.getFloat32(this.offset, false); // Big-Endian
    this.offset += 4;
    return value;
  }

  public readF8(): number {
    this.checkBounds(8);
    const value = this.view.getFloat64(this.offset, false); // Big-Endian
    this.offset += 8;
    return value;
  }

  public readBytes(length: number): Uint8Array {
    this.checkBounds(length);
    const bytes = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    // Return a copy so underlying buffer offset isn't shared/corrupted
    return new Uint8Array(bytes);
  }

  public skip(length: number): void {
    this.checkBounds(length);
    this.offset += length;
  }
}
