import Issue from "../models/Issue.js";

const RESOLVED = "Resolved";
const PENDING_STATUSES = new Set(["New", "Acknowledged", "Open", "Assigned"]);

export async function getAdminDashboard(_req, res, next) {
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
            { $group: { _id: "$status", count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
          ],
          byCategory: [
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } }
          ],
          highPriorityUnresolved: [
            { $match: { priority: "High", status: { $ne: RESOLVED } } },
            { $count: "count" }
          ],
          recentReports: [
            { $sort: { createdAt: -1 } },
            { $limit: 30 },
            {
              $project: {
                title: 1,
                description: 1,
                category: 1,
                status: 1,
                priority: 1,
                priorityScore: 1,
                trackingId: 1,
                createdAt: 1,
                location: 1,
                statusHistory: 1,
                supportCount: { $ifNull: ["$supportCount", 0] }
              }
            }
          ]
        }
      }
    ]);

    const totalReports = result.totals[0]?.total ?? 0;
    const counts = Object.fromEntries(result.byStatus.map(({ _id, count }) => [_id, count]));
    const resolvedReports = counts[RESOLVED] ?? 0;
    const pendingReports = [...PENDING_STATUSES].reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    return res.json({
      success: true,
      data: {
        summary: {
          totalReports,
          pendingReports,
          inProgressReports: counts["In Progress"] ?? 0,
          resolvedReports,
          highPriorityUnresolved: result.highPriorityUnresolved[0]?.count ?? 0,
          resolutionRate: totalReports === 0 ? 0 : Number(((resolvedReports / totalReports) * 100).toFixed(1))
        },
        reportsByStatus: result.byStatus.map(({ _id, count }) => ({ status: _id, count })),
        reportsByCategory: result.byCategory.map(({ _id, count }) => ({ category: _id || "Other", count })),
        recentReports: result.recentReports
      }
    });
  } catch (error) {
    return next(error);
  }
}
