// 압축 없이(저장 방식) 묶는 최소 ZIP 작성기. Word(.docx)는 XML 파일 몇 개를 ZIP으로 묶은 것이라, 외부 라이브러리 없이 .docx를 만들 때만 쓴다.
// 파일 이름은 UTF-8(플래그 0x0800)로 적는다. 읽기(풀기)는 하지 않는다.
const enc = new TextEncoder();

let crcTable: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export interface ZipEntry { name: string; data: Uint8Array | string }

export function zipStore(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const { time, date } = dosDateTime(now);
  const prepared = entries.map(e => {
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    return { name: enc.encode(e.name), data, crc: crc32(data) };
  });
  const localSize = prepared.reduce((s, p) => s + 30 + p.name.length + p.data.length, 0);
  const centralSize = prepared.reduce((s, p) => s + 46 + p.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];
  for (const p of prepared) {
    offsets.push(o);
    v.setUint32(o, 0x04034b50, true);       // local file header
    v.setUint16(o + 4, 20, true);           // version needed
    v.setUint16(o + 6, 0x0800, true);       // flags: UTF-8 names
    v.setUint16(o + 8, 0, true);            // method: stored
    v.setUint16(o + 10, time, true);
    v.setUint16(o + 12, date, true);
    v.setUint32(o + 14, p.crc, true);
    v.setUint32(o + 18, p.data.length, true);
    v.setUint32(o + 22, p.data.length, true);
    v.setUint16(o + 26, p.name.length, true);
    v.setUint16(o + 28, 0, true);           // extra length
    out.set(p.name, o + 30);
    out.set(p.data, o + 30 + p.name.length);
    o += 30 + p.name.length + p.data.length;
  }
  const centralStart = o;
  prepared.forEach((p, i) => {
    v.setUint32(o, 0x02014b50, true);       // central directory header
    v.setUint16(o + 4, 20, true);           // version made by
    v.setUint16(o + 6, 20, true);           // version needed
    v.setUint16(o + 8, 0x0800, true);
    v.setUint16(o + 10, 0, true);
    v.setUint16(o + 12, time, true);
    v.setUint16(o + 14, date, true);
    v.setUint32(o + 16, p.crc, true);
    v.setUint32(o + 20, p.data.length, true);
    v.setUint32(o + 24, p.data.length, true);
    v.setUint16(o + 28, p.name.length, true);
    // extra(30) · comment(32) · disk(34) · internal attr(36) · external attr(38)는 0
    v.setUint32(o + 42, offsets[i], true);  // local header offset
    out.set(p.name, o + 46);
    o += 46 + p.name.length;
  });
  v.setUint32(o, 0x06054b50, true);         // end of central directory
  v.setUint16(o + 8, prepared.length, true);
  v.setUint16(o + 10, prepared.length, true);
  v.setUint32(o + 12, o - centralStart, true);
  v.setUint32(o + 16, centralStart, true);
  return out;
}
