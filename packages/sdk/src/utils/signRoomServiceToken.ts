import fs from "fs";
import jwt from "jsonwebtoken";
import {RoomTokenType} from "../types";

export function signRoomServiceToken(
  privateKeyOrPath: string,
  passphrase?: string
) {
  let privateKey = privateKeyOrPath;
  try {
    if (fs.existsSync(privateKeyOrPath) && fs.lstatSync(privateKeyOrPath).isFile()) {
      privateKey = fs.readFileSync(privateKeyOrPath, "utf8");
    }
  } catch {
  }
  const keyForSign: string | { key: string; passphrase: string } =
    passphrase && passphrase.length > 0 ? {key: privateKey, passphrase} : privateKey;

  // perform signing
  return jwt.sign({
    issuer: 'room-service',
    type: RoomTokenType.ROOM_SERVICE,
  }, keyForSign as any, {
    algorithm: "RS256",
  });
}
