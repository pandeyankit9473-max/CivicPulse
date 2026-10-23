import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import issueRoutes from "./routes/issueRoutes.js";
import userRoutes from "./routes/userRoutes.js";

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173"
}));
app.use(express.json({ limit: "7mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ success: true, service: "CivicPulse API", status: "ok" });
});

// Starter in-memory limiter. For multi-instance production deployment,
// configure a Redis-backed rate-limit store.
app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Try again shortly." }
}));

app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: (req) => req.method !== "POST",
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many sign-in attempts. Try again in 15 minutes." }
}));
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/issues", issueRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.name === "ValidationError" || err.name === "CastError") {
    return res.status(400).json({ success: false, message: err.message });
  }
  return res.status(500).json({ success: false, message: "Internal server error" });
});

export default app;
