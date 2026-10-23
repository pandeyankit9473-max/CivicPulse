import jwt from "jsonwebtoken";

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  return typeof secret === "string" && Buffer.byteLength(secret) >= 32 ? secret : null;
}

export function createAuthToken(userId, secret) {
  return jwt.sign({}, secret, {
    subject: String(userId),
    issuer: "civicpulse",
    expiresIn: "7d"
  });
}
