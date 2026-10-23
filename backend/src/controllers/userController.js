import Issue from "../models/Issue.js";

export async function getMyCivicScore(req, res, next) {
  try {
    const [summary] = await Issue.aggregate([
      { $match: { submittedBy: req.user._id } },
      {
        $group: {
          _id: null,
          totalScore: { $sum: { $ifNull: ["$pointsAwarded", 0] } },
          reportsCount: { $sum: 1 }
        }
      }
    ]);

    return res.json({
      success: true,
      data: {
        totalScore: summary?.totalScore ?? 0,
        reportsCount: summary?.reportsCount ?? 0,
        pointsPerReport: 10
      }
    });
  } catch (error) {
    return next(error);
  }
}
