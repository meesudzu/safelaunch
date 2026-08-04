const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // excludes O, I, L, 0, 1
const PAYLOAD_LENGTH = 8;
const PREFIX = "SL-";

// Safe alphabet excludes ambiguous chars O, I, L, 0, 1.
export const REDEEM_CODE_PATTERN = /^SL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

export const isValidRedeemCodeShape = (input: string): boolean =>
  REDEEM_CODE_PATTERN.test(input.trim());

export const generateRedeemCode = (): string => {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  crypto.getRandomValues(bytes);
  let payload = "";
  for (let i = 0; i < PAYLOAD_LENGTH; i++) {
    payload += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${PREFIX}${payload.slice(0, 4)}-${payload.slice(4, 8)}`;
};

const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input.trim()),
  );
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
};

export const hashRedeemCode = (plaintext: string): Promise<string> => sha256Hex(plaintext);
