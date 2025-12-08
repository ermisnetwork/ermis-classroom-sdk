// signTypedRs256.ts
import fs from "fs";
import jwt from "jsonwebtoken";
import {ParticipantPermissions, RoomTokenType} from "../types";


export interface TypedPayload {
  sub: string;
  fullName: string;
  exp?: number;
  room_id: string;
  permissions: ParticipantPermissions;
}

export interface SignOptions {
  issuer?: string;
  audience?: string;
}

/**
 * Signs a RS256 JWT with a typed payload.
 *
 * @param payload - typed payload object
 * @param privateKeyOrPath - raw PEM string or a file path to the private PEM
 * @param passphrase - optional passphrase if the PEM is encrypted
 * @param signOptions - optional sign options (issuer/audience...)
 * @returns signed JWT string
 */
export function signParticipantToken(
  payload: TypedPayload,
  privateKeyOrPath: string,
  passphrase?: string,
  signOptions: SignOptions = {}
): string {
  let privateKey = privateKeyOrPath;
  try {
    if (fs.existsSync(privateKeyOrPath) && fs.lstatSync(privateKeyOrPath).isFile()) {
      privateKey = fs.readFileSync(privateKeyOrPath, "utf8");
    }
  } catch {
    // if an error occurs reading path, assume it's raw key string and continue
  }
  const payloadCopy: Record<string, any> = {
    ...payload,
    type: RoomTokenType.PARTICIPANT,
  };

  if (payloadCopy.exp && typeof payloadCopy.exp === "number") {
    if (payloadCopy.exp > 1e10) {
      payloadCopy.exp = Math.floor(payloadCopy.exp / 1000);
    }
  }
  const keyForSign: string | { key: string; passphrase: string } =
    passphrase && passphrase.length > 0 ? {key: privateKey, passphrase} : privateKey;

  // perform signing
  return jwt.sign(payloadCopy, keyForSign as any, {
    algorithm: "RS256",
    issuer: signOptions.issuer,
    audience: signOptions.audience,
    // Do not set 'expiresIn' here if exp already supplied in payload; jwt will use payload.exp
  });
}
