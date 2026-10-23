import { timingSafeEqual } from "node:crypto";

function matchesSecret(provided, expected) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function requireAdmin(req, res, next) {
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (!adminApiKey) {
    return res.status(503).json({
      success: false,
      message: "Administrator access is not configured. Set ADMIN_API_KEY on the backend."
    });
  }

  const authorization = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match || !matchesSecret(match[1], adminApiKey)) {
    return res.status(401).json({ success: false, message: "Valid admin credentials are required" });
  }

  return next();
}
