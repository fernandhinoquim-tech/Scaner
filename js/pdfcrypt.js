// Cifrado estándar de PDF con contraseña: AES de 256 bits (revisión 6 de ISO 32000-2, la que usan
// Adobe Acrobat y qpdf). Se hace con WebCrypto, dentro del teléfono.
const subtle = crypto.subtle;
const enc = new TextEncoder();

const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const sha = async (alg, data) => new Uint8Array(await subtle.digest(alg, data));

// AES-CBC sin relleno (data ya mide un múltiplo de 16): WebCrypto siempre agrega un bloque de
// relleno al final, que simplemente se quita.
async function aesNoPad(keyBytes, iv, data) {
  const key = await subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key, data)).subarray(0, data.length);
}

// Algoritmo 2.B (hash de la contraseña para la revisión 6).
async function hash2B(password, salt, udata) {
  let k = await sha('SHA-256', concat(password, salt, udata));
  let e = new Uint8Array([0]);
  for (let i = 0; i < 64 || e[e.length - 1] > i - 32; i++) {
    const block = concat(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let j = 0; j < 64; j++) k1.set(block, j * block.length);
    e = await aesNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    // Los primeros 16 bytes como número grande, módulo 3 (= suma de los bytes módulo 3).
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j];
    k = await sha(['SHA-256', 'SHA-384', 'SHA-512'][sum % 3], e);
  }
  return k.subarray(0, 32);
}

// Contraseña en UTF-8 y de hasta 127 bytes. Se usa tal como se escribió (NFC): la app no admite los
// símbolos que la norma transformaría (º, ª, ²…), así la abren igual todos los lectores de PDF.
function passwordBytes(pw) {
  let b = enc.encode(String(pw).normalize('NFC'));
  if (b.length > 127) b = b.subarray(0, 127);
  return b;
}

// Prepara el cifrado. Devuelve las funciones para cifrar cadenas y flujos, el diccionario
// /Encrypt y el /ID del documento.
export async function pdfEncryption(password) {
  const pw = passwordBytes(password);
  const fileKey = random(32);
  const zero = new Uint8Array(16);

  // Contraseña de usuario (la que se pide para abrir). La de propietario es la misma.
  const uSalt = random(8), uKeySalt = random(8);
  const U = concat(await hash2B(pw, uSalt, new Uint8Array(0)), uSalt, uKeySalt);
  const UE = await aesNoPad(await hash2B(pw, uKeySalt, new Uint8Array(0)), zero, fileKey);
  const oSalt = random(8), oKeySalt = random(8);
  const O = concat(await hash2B(pw, oSalt, U), oSalt, oKeySalt);
  const OE = await aesNoPad(await hash2B(pw, oKeySalt, U), zero, fileKey);

  // Permisos: todos (imprimir, copiar...). -4 = 0xFFFFFFFC.
  const P = -4;
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, P, true);
  perms.set([0xFF, 0xFF, 0xFF, 0xFF, 0x54 /* T: metadatos cifrados */, 0x61, 0x64, 0x62], 4);
  perms.set(random(4), 12);
  const Perms = await aesNoPad(fileKey, zero, perms);

  const key = await subtle.importKey('raw', fileKey, 'AES-CBC', false, ['encrypt']);
  // Cada cadena o flujo: vector aleatorio de 16 bytes + AES-256-CBC con relleno estándar.
  const encrypt = async (bytes) => {
    const iv = random(16);
    return concat(iv, new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key, bytes)));
  };

  return {
    encrypt,
    dict: `<< /Filter /Standard /V 5 /R 6 /Length 256 ` +
      `/CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF ` +
      `/O <${hex(O)}> /U <${hex(U)}> /OE <${hex(OE)}> /UE <${hex(UE)}> /P ${P} /Perms <${hex(Perms)}> ` +
      `/EncryptMetadata true >>`,
    id: hex(random(16)),
  };
}
