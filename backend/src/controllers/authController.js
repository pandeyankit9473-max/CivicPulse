import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import User from "../models/User.js";
import { createAuthToken, getJwtSecret } from "../services/authToken.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_BYTES = 72;

function publicUser(user) {
  return {
    id: String(user._id),
    displayName: user.displayName,
    email: user.email
  };
}

function isValidPassword(password) {
  return typeof password === "string"
    && password.length >= MIN_PASSWORD_LENGTH
    && Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES;
}

export async function register(req, res, next) {
  try {
    const { displayName, email, password } = req.body ?? {};
    if (typeof displayName !== "string" || displayName.trim().length < 2
      || displayName.trim().length > 60) {
      return res.status(400).json({
        success: false,
        message: "Display name must be between 2 and 60 characters"
      });
    }
    if (typeof email !== "string" || email.length > 254 || !EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and no more than ${MAX_PASSWORD_BYTES} UTF-8 bytes`
      });
    }

    const secret = getJwtSecret();
    if (!secret) {
      return res.status(503).json({
        success: false,
        message: "Authentication is not configured. Set a JWT_SECRET of at least 32 bytes."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.exists({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const user = await User.create({
      displayName: displayName.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12)
    });

    return res.status(201).json({
      success: true,
      data: {
        user: publicUser(user),
        token: createAuthToken(user._id, secret)
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const secret = getJwtSecret();
    if (!secret) {
      return res.status(503).json({
        success: false,
        message: "Authentication is not configured. Set a JWT_SECRET of at least 32 bytes."
      });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: "Email or password is incorrect" });
    }

    return res.json({
      success: true,
      data: {
        user: publicUser(user),
        token: createAuthToken(user._id, secret)
      }
    });
  } catch (error) {
    return next(error);
  }
}

export async function requestPasswordReset(req, res, next) {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== "string" || email.length > 254 || !EMAIL_PATTERN.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Enter a valid email address" });
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;
    if (!smtpHost || !smtpUser || !smtpPassword || !smtpFrom) {
      return res.status(503).json({
        success: false,
        message: "Password reset email is not configured. Add the Gmail SMTP settings to backend/.env and restart the backend."
      });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.json({
        success: true,
        message: "If an account exists for that email, a password reset link will be sent."
      });
    }

    const resetToken = randomBytes(32).toString("hex");
    const resetTokenHash = createHash("sha256").update(resetToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordResetTokenHash: resetTokenHash, passwordResetExpiresAt: expiresAt } }
    );

    const resetUrl = new URL("/", process.env.FRONTEND_ORIGIN || "http://localhost:5173");
    resetUrl.searchParams.set("resetToken", resetToken);

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: smtpUser, pass: smtpPassword }
      });
      await transporter.sendMail({
        from: smtpFrom,
        to: user.email,
        subject: "Reset your CivicPulse password",
        text: `Hello ${user.displayName},\n\nUse this link within one hour to reset your CivicPulse password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`
      });
    } catch (error) {
      await User.updateOne(
        { _id: user._id, passwordResetTokenHash: resetTokenHash },
        { $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" } }
      );
      return next(error);
    }

    return res.json({
      success: true,
      message: "If an account exists for that email, a password reset link will be sent."
    });
  } catch (error) {
    return next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body ?? {};
    if (typeof token !== "string" || !/^[a-f\d]{64}$/i.test(token)) {
      return res.status(400).json({ success: false, message: "This password reset link is invalid or expired." });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and no more than ${MAX_PASSWORD_BYTES} UTF-8 bytes`
      });
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.findOneAndUpdate(
      { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } },
      {
        $set: { passwordHash },
        $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" }
      },
      { new: true }
    );
    if (!user) {
      return res.status(400).json({ success: false, message: "This password reset link is invalid or expired." });
    }

    return res.json({ success: true, message: "Password updated. Sign in with your new password." });
  } catch (error) {
    return next(error);
  }
}

export async function getCurrentUser(req, res, next) {
  try {
    const user = await User.findById(req.user._id).lean();
    if (!user) {
      return res.status(401).json({ success: false, message: "Account no longer exists" });
    }
    return res.json({ success: true, data: publicUser(user) });
  } catch (error) {
    return next(error);
  }
}
