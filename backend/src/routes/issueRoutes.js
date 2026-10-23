import { Router } from "express";
import {
  getIssues,
  getIssueSummary,
  getIssueById,
  createIssue,
  updateIssueStatus,
  getMySupportedIssues,
  setIssueSupport
} from "../controllers/issueController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const router = Router();

router.get("/", getIssues);
router.get("/summary", getIssueSummary);
router.get("/support/me", requireAuth, getMySupportedIssues);
router.put("/:id/support", requireAuth, setIssueSupport);
router.patch("/:id/status", requireAdmin, updateIssueStatus);
router.get("/:id", getIssueById);
router.post("/", requireAuth, createIssue);

export default router;
