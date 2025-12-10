import {RoomTokenType} from "../types";

/**
 * Base64url encode a Uint8Array or string
 */
function base64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Parse PEM private key and import it as CryptoKey
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and whitespace
  const pemContents = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  // Decode base64 to binary
  const binaryString = atob(pemContents);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Import as PKCS8 key
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}

/**
 * Signs a RS256 JWT for room service authentication using Web Crypto API.
 * Works in both browser and Node.js environments.
 *
 * @param privateKeyPem - raw PEM string of the private key (PKCS8 format)
 * @returns Promise resolving to signed JWT string
 *
 * @note File path reading is not supported in browser environments.
 *       Pass the PEM content directly as a string.
 * @note Encrypted private keys (with passphrase) are not supported.
 *       Use an unencrypted PKCS8 PEM key.
 */
export async function signRoomServiceToken(
  privateKeyPem: string
): Promise<string> {
  // Build JWT payload
  const payload = {
    issuer: 'room-service',
    type: RoomTokenType.ROOM_SERVICE,
    exp: Math.floor(Date.now() / 1000) + 99999 * 24 * 3600,
  };

  // Build JWT header
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  // Encode header and payload
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Import the private key and sign
  const cryptoKey = await importPrivateKey(privateKeyPem);
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  // Encode signature
  const encodedSignature = base64urlEncode(new Uint8Array(signatureBuffer));

  return `${signingInput}.${encodedSignature}`;
}
