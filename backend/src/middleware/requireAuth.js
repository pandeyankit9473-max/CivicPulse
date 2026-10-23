import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { getJwtSecret } from "../services/authToken.js";

export function requireAuth(req, res, next) {
  const secret = getJwtSecret();
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: "Authentication is not configured. Set a JWT_SECRET of at least 32 bytes."
    });
  }

  const authorization = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return res.status(401).json({ success: false, message: "Sign in to continue" });
  }

  try {
    const payload = jwt.verify(match[1], secret, { issuer: "civicpulse" });
    if (typeof payload !== "object" || typeof payload.sub !== "string"
      || !mongoose.isValidObjectId(payload.sub)) {
      return res.status(401).json({ success: false, message: "Invalid or expired sign-in session" });
    }

    req.user = { _id: new mongoose.Types.ObjectId(payload.sub) };
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired sign-in session" });
  }
}
