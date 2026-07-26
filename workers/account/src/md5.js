// MD5 — Yostar SDK(yostarplat) 요청 서명에 필요하다. Cloudflare Workers의 WebCrypto는
// MD5를 지원하지 않으므로(SHA 계열만) 순수 JS로 구현한다. HMAC-SHA1은 crypto.subtle 사용.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

/** UTF-8 문자열(또는 바이트열)의 MD5 소문자 hex. */
export function md5Hex(input) {
  const msg = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const size = (((msg.length + 8) >> 6) + 1) << 6; // 패딩 후 64바이트 배수
  const buf = new Uint8Array(size);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = msg.length * 8;
  view.setUint32(size - 8, bits >>> 0, true);
  view.setUint32(size - 4, Math.floor(bits / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let chunk = 0; chunk < size; chunk += 64) {
    for (let i = 0; i < 16; i += 1) M[i] = view.getUint32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i += 1) {
      let f, g;
      if (i < 16) { f = (B & C) | (~B & D); g = i; }
      else if (i < 32) { f = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { f = C ^ (B | ~D); g = (7 * i) % 16; }
      f = (f + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((f << S[i]) | (f >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
  let hex = "";
  for (const byte of out) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
