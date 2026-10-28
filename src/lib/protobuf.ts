// Lecteur/écrivain protobuf minimal, juste ce qu'il faut pour les réglages
// utilisateur de Discord (PreloadedUserSettings).

export class ProtoReader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get eof() {
    return this.pos >= this.buf.length;
  }

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    while (this.pos < this.buf.length) {
      const b = this.buf[this.pos++];
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7n;
    }
    return result;
  }

  tag(): [field: number, wireType: number] {
    const t = Number(this.varint());
    return [t >>> 3, t & 7];
  }

  bytes(): Uint8Array {
    const len = Number(this.varint());
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  string(): string {
    return new TextDecoder().decode(this.bytes());
  }

  fixed64(): bigint {
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(this.buf[this.pos + i]);
    this.pos += 8;
    return v;
  }

  skip(wireType: number) {
    switch (wireType) {
      case 0: this.varint(); break;
      case 1: this.pos += 8; break;
      case 2: this.pos += Number(this.varint()); break;
      case 5: this.pos += 4; break;
      default: throw new Error(`unsupported wire type ${wireType}`);
    }
  }

  /** fixed64 répétés, encodés « packed » (wire type 2) ou non (wire type 1). */
  repeatedFixed64(wireType: number, into: bigint[]) {
    if (wireType === 1) {
      into.push(this.fixed64());
      return;
    }
    const sub = new ProtoReader(this.bytes());
    while (!sub.eof) into.push(sub.fixed64());
  }
}

export class ProtoWriter {
  private parts: number[] = [];

  private varint(v: number) {
    while (v > 0x7f) {
      this.parts.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.parts.push(v);
  }

  bytes(field: number, data: Uint8Array) {
    this.varint((field << 3) | 2);
    this.varint(data.length);
    for (const b of data) this.parts.push(b);
    return this;
  }

  string(field: number, s: string) {
    return this.bytes(field, new TextEncoder().encode(s));
  }

  message(field: number, build: (w: ProtoWriter) => void) {
    const w = new ProtoWriter();
    build(w);
    return this.bytes(field, w.finish());
  }

  finish() {
    return Uint8Array.from(this.parts);
  }
}

export function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
