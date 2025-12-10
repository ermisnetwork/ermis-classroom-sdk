import {ParticipantPermissions, RoomTokenType} from "../types";

export interface TypedPayload {
  sub: string;
  fullName: string;
  exp?: number;
  room_id: string;
  issuer?: string;
  permissions: ParticipantPermissions;
}

export interface SignOptions {
  issuer?: string;
  audience?: string;
}

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
 * Signs a RS256 JWT with a typed payload using Web Crypto API.
 * Works in both browser and Node.js environments.
 *
 * @param payload - typed payload object
 * @param privateKeyPem - raw PEM string of the private key (PKCS8 format)
 * @param signOptions - optional sign options (issuer/audience...)
 * @returns Promise resolving to signed JWT string
 *
 * @note File path reading is not supported in browser environments.
 *       Pass the PEM content directly as a string.
 * @note Encrypted private keys (with passphrase) are not supported.
 *       Use an unencrypted PKCS8 PEM key.
 */
export async function signParticipantToken(
  payload: TypedPayload,
  privateKeyPem: string,
  signOptions: SignOptions = {}
): Promise<string> {
  // Build JWT payload
  const payloadCopy: Record<string, unknown> = {
    ...payload,
    type: RoomTokenType.PARTICIPANT,
  };

  // Add optional claims
  if (signOptions.issuer) {
    payloadCopy.iss = signOptions.issuer;
  }
  if (signOptions.audience) {
    payloadCopy.aud = signOptions.audience;
  }

  // Normalize exp to seconds if provided in milliseconds
  if (payloadCopy.exp && typeof payloadCopy.exp === "number") {
    if (payloadCopy.exp > 1e10) {
      payloadCopy.exp = Math.floor(payloadCopy.exp / 1000);
    }
  }

  // Build JWT header
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  // Encode header and payload
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payloadCopy));
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
