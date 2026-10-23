import Issue, { ISSUE_STATUSES } from "../models/Issue.js";
import {
  readIssueListCache,
  writeIssueListCache,
  invalidateIssueListCache
} from "../services/issueCache.js";
import { scoreIssue } from "../services/priorityScoring.js";
import { createTrackingId } from "../services/trackingId.js";
import { findPossibleDuplicate } from "../services/duplicateSuggestions.js";

const MAX_PHOTO_DATA_LENGTH = 1_450_000;
const MAX_TOTAL_PHOTO_DATA_LENGTH = 5_800_000;

function isImageDataUrl(value) {
  return typeof value === "string"
    && value.length <= MAX_PHOTO_DATA_LENGTH
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export async function getIssues(req, res, next) {
  try {
    const cached = await readIssueListCache();
    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json({ success: true, source: "redis", data: cached });
    }

    const issues = await Issue.find()
      .select("-photos -supporters -submittedBy -statusHistory")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    await writeIssueListCache(issues);
    res.set("X-Cache", "MISS");
    return res.json({ success: true, source: "mongodb", data: issues });
  } catch (error) {
    next(error);
  }
}

export async function getIssueSummary(_req, res, next) {
  try {
    const [result] = await Issue.aggregate([
      {
        $facet: {
          totals: [{ $count: "total" }],
          byStatus: [
            {
              $project: {
                status: {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$status", "Open"] }, then: "New" },
                      { case: { $eq: ["$status", "Assigned"] }, then: "Acknowledged" }
                    ],
                    default: { $ifNull: ["$status", "New"] }
                  }
                }
              }
            },
            { $group: { _id: "$status", count: { $sum: 1 } } }
          ],
          highPriorityUnresolved: [
            { $match: { priority: "High", status: { $ne: "Resolved" } } },
            { $count: "count" }
          ],
          communitySupports: [
            { $group: { _id: null, total: { $sum: { $ifNull: ["$supportCount", 0] } } } }
          ]
        }
      }
    ]);

    const counts = Object.fromEntries(result.byStatus.map(({ _id, count }) => [_id, count]));
    return res.json({
      success: true,
      data: {
        totalReports: result.totals[0]?.total ?? 0,
        pendingReports: (counts.New ?? 0) + (counts.Acknowledged ?? 0),
        inProgressReports: counts["In Progress"] ?? 0,
        resolvedReports: counts.Resolved ?? 0,
        highPriorityUnresolved: result.highPriorityUnresolved[0]?.count ?? 0,
        communitySupports: result.communitySupports[0]?.total ?? 0
      }
    });
  } catch (error) {
    return next(error);
  }
}

export async function getIssueById(req, res, next) {
  try {
    const issue = await Issue.findById(req.params.id).select("-supporters -submittedBy").lean();
    if (!issue) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    return res.json({ success: true, data: issue });
  } catch (error) {
    next(error);
  }
}

export async function updateIssueStatus(req, res, next) {
  try {
    const { status } = req.body ?? {};
    if (!ISSUE_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${ISSUE_STATUSES.join(", ")}`
      });
    }

    const changedAt = new Date();
    const issue = await Issue.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: status } },
      {
        $set: { status },
        $push: { statusHistory: { status, changedAt, changedBy: "Administrator" } }
      },
      { new: true, runValidators: true }
    ).select("-photos -supporters -submittedBy");

    if (!issue) {
      const existing = await Issue.findById(req.params.id).select("-photos -supporters -submittedBy");
      if (!existing) {
        return res.status(404).json({ success: false, message: "Report not found" });
      }
      return res.json({ success: true, message: "Report already has this status", data: existing });
    }

    await invalidateIssueListCache();
    return res.json({ success: true, message: "Report status updated", data: issue });
  } catch (error) {
    next(error);
  }
}

export async function createIssue(req, res, next) {
  try {
    const { title, description, category, address, lat, lng, photos = [], allowDuplicate = false } = req.body ?? {};

    if (typeof title !== "string" || !title.trim()
      || typeof description !== "string" || !description.trim()
      || typeof category !== "string" || !category) {
      return res.status(400).json({
        success: false,
        message: "title, description, and category are required"
      });
    }

    if (typeof allowDuplicate !== "boolean") {
      return res.status(400).json({ success: false, message: "allowDuplicate must be a boolean" });
    }

    if (!Array.isArray(photos) || photos.length > 4 || !photos.every(isImageDataUrl)
      || photos.reduce((total, photo) => total + photo.length, 0) > MAX_TOTAL_PHOTO_DATA_LENGTH) {
      return res.status(400).json({
        success: false,
        message: "Add up to 4 JPEG, PNG, or WebP photos, each no larger than 1 MB"
      });
    }

    const normalizedTitle = title.trim().replace(/\s+/g, " ");
    const normalizedDescription = description.trim();
    const hasLat = lat !== undefined && lat !== null && lat !== "";
    const hasLng = lng !== undefined && lng !== null && lng !== "";
    if (hasLat !== hasLng) {
      return res.status(400).json({ success: false, message: "Provide both latitude and longitude" });
    }
    if (hasLat && (!Number.isFinite(Number(lat)) || Number(lat) < -90 || Number(lat) > 90
      || !Number.isFinite(Number(lng)) || Number(lng) < -180 || Number(lng) > 180)) {
      return res.status(400).json({ success: false, message: "Provide valid latitude and longitude coordinates" });
    }

    const location = {
      address: typeof address === "string" ? address.trim() : "",
      ...(hasLat ? { lat: Number(lat) } : {}),
      ...(hasLng ? { lng: Number(lng) } : {})
    };

    if (!allowDuplicate) {
      const duplicate = await findPossibleDuplicate(Issue, { category, location }, normalizedTitle);
      if (duplicate) {
        return res.status(409).json({
          success: false,
          code: "POSSIBLE_DUPLICATE",
          message: "A similar unresolved report may already exist. Review it before continuing.",
          data: duplicate
        });
      }
    }

    const scoring = scoreIssue({ category, title: normalizedTitle, description: normalizedDescription });
    const submittedAt = new Date();
    const issue = await Issue.create({
      title: normalizedTitle,
      description: normalizedDescription,
      category,
      location,
      photos,
      submittedBy: req.user._id,
      pointsAwarded: 10,
      trackingId: await createTrackingId(submittedAt),
      status: "New",
      statusHistory: [{ status: "New", changedAt: submittedAt, changedBy: "Report submitted" }],
      ...scoring
    });

    await invalidateIssueListCache();
    const publicIssue = issue.toObject();
    delete publicIssue.supporters;
    delete publicIssue.submittedBy;
    return res.status(201).json({
      success: true,
      message: "Issue reported successfully",
      data: publicIssue
    });
  } catch (error) {
    next(error);
  }
}

export async function getMySupportedIssues(req, res, next) {
  try {
    const issues = await Issue.find({ supporters: req.user._id }).select("_id").lean();
    return res.json({ success: true, data: issues.map((issue) => String(issue._id)) });
  } catch (error) {
    return next(error);
  }
}

export async function setIssueSupport(req, res, next) {
  try {
    const { supported } = req.body ?? {};
    if (typeof supported !== "boolean") {
      return res.status(400).json({ success: false, message: "supported must be a boolean" });
    }

    const filter = supported
      ? { _id: req.params.id, supporters: { $ne: req.user._id } }
      : { _id: req.params.id, supporters: req.user._id };
    const update = supported
      ? { $addToSet: { supporters: req.user._id }, $inc: { supportCount: 1 } }
      : { $pull: { supporters: req.user._id }, $inc: { supportCount: -1 } };
    let issue = await Issue.findOneAndUpdate(filter, update, { new: true })
      .select("_id supporters supportCount")
      .lean();

    if (!issue) {
      issue = await Issue.findById(req.params.id).select("_id supporters supportCount").lean();
    }
    if (!issue) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    await invalidateIssueListCache();
    return res.json({
      success: true,
      data: {
        supported: (issue.supporters || []).some((id) => String(id) === String(req.user._id)),
        supportCount: issue.supportCount ?? 0
      }
    });
  } catch (error) {
    return next(error);
  }
}
