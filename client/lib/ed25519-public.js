const P = 2n ** 255n - 19n;

function mod(value) {
  const remainder = value % P;
  return remainder >= 0n ? remainder : remainder + P;
}

function modPow(base, exponent) {
  let result = 1n;
  let value = mod(base);
  let exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * value);
    value = mod(value * value);
    exp >>= 1n;
  }
  return result;
}

const invert = (value) => modPow(value, P - 2n);
const D = mod(-121665n * invert(121666n));

function add(left, right) {
  const a = mod((left.Y - left.X) * (right.Y - right.X));
  const b = mod((left.Y + left.X) * (right.Y + right.X));
  const c = mod(2n * left.T * right.T * D);
  const d = mod(2n * left.Z * right.Z);
  const e = mod(b - a);
  const f = mod(d - c);
  const g = mod(d + c);
  const h = mod(b + a);
  return { X: mod(e * f), Y: mod(g * h), Z: mod(f * g), T: mod(e * h) };
}

function multiply(scalar, point) {
  let result = { X: 0n, Y: 1n, Z: 1n, T: 0n };
  let base = point;
  let remaining = scalar;
  while (remaining > 0n) {
    if (remaining & 1n) result = add(result, base);
    base = add(base, base);
    remaining >>= 1n;
  }
  return result;
}

function recoverX(y, sign) {
  const y2 = mod(y * y);
  const xx = mod((y2 - 1n) * invert(mod(D * y2 + 1n)));
  let x = modPow(xx, (P + 3n) / 8n);
  if (mod(x * x - xx) !== 0n) x = mod(x * modPow(2n, (P - 1n) / 4n));
  if ((x & 1n) !== sign) x = mod(-x);
  return x;
}

const baseY = mod(4n * invert(5n));
const baseX = recoverX(baseY, 0n);
const basePoint = { X: baseX, Y: baseY, Z: 1n, T: mod(baseX * baseY) };

function encodePoint(point) {
  const inverseZ = invert(point.Z);
  const x = mod(point.X * inverseZ);
  const y = mod(point.Y * inverseZ);
  let encoded = y;
  if (x & 1n) encoded |= 1n << 255n;
  const out = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    out[index] = Number(encoded & 255n);
    encoded >>= 8n;
  }
  return out;
}

async function sha512(seed) {
  const digest = await crypto.subtle.digest('SHA-512', seed);
  return new Uint8Array(digest);
}

export async function publicKeyFromSeed(seed) {
  if (seed.length !== 32) throw new Error('That key could not be read.');
  const hash = await sha512(seed);
  const scalarBytes = hash.slice(0, 32);
  scalarBytes[0] &= 248;
  scalarBytes[31] &= 127;
  scalarBytes[31] |= 64;
  let scalar = 0n;
  for (let index = 0; index < 32; index += 1) {
    scalar |= BigInt(scalarBytes[index]) << (8n * BigInt(index));
  }
  return encodePoint(multiply(scalar, basePoint));
}
