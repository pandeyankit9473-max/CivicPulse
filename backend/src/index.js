import "dotenv/config";
import app from "./app.js";
import { connectDB } from "./config/db.js";
import { connectRedis } from "./config/redis.js";

const PORT = Number(process.env.PORT || 8000);

async function start() {
  try {
    await connectDB();
    await connectRedis(); // Redis is optional; API can run without it.
    app.listen(PORT, () => {
      console.log(`CivicPulse API running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

start();
