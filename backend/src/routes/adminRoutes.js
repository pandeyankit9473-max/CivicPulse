import { Router } from "express";
import { getAdminDashboard } from "../controllers/adminController.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

router.use(requireAdmin);
router.get("/dashboard", getAdminDashboard);

export default router;
