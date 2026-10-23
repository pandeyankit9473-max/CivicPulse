import { Router } from "express";
import { getMyCivicScore } from "../controllers/userController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.get("/me/score", requireAuth, getMyCivicScore);

export default router;
