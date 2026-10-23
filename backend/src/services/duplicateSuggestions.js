const MAX_DISTANCE_METERS = 500;

function words(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 1 || /^\d+$/.test(word))
  );
}

function overlapRatio(first, second) {
  const left = words(first);
  const right = words(second);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) {
    if (right.has(word)) overlap += 1;
  }
  return overlap / Math.min(left.size, right.size);
}

function coordinateDistanceMeters(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latDifference = radians(second.lat - first.lat);
  const lngDifference = radians(second.lng - first.lng);
  const haversine = Math.sin(latDifference / 2) ** 2
    + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat))
    * Math.sin(lngDifference / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isNearby(candidate, location, exactTitle) {
  const candidateHasCoordinates = Number.isFinite(candidate.location?.lat)
    && Number.isFinite(candidate.location?.lng);
  const reportHasCoordinates = Number.isFinite(location.lat) && Number.isFinite(location.lng);
  if (candidateHasCoordinates && reportHasCoordinates) {
    return coordinateDistanceMeters(candidate.location, location) <= MAX_DISTANCE_METERS;
  }

  const candidateAddress = candidate.location?.address?.trim();
  const reportAddress = location.address?.trim();
  if (candidateAddress && reportAddress) {
    return overlapRatio(candidateAddress, reportAddress) >= 0.6;
  }

  return exactTitle && !candidateAddress && !reportAddress
    && !candidateHasCoordinates && !reportHasCoordinates;
}

export async function findPossibleDuplicate(Issue, report, normalizedTitle) {
  const candidates = await Issue.find({
    category: report.category,
    status: { $nin: ["Resolved", "Rejected"] }
  })
    .select("_id trackingId title category status createdAt location priority")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const exactTitle = (candidateTitle) => candidateTitle.trim().toLowerCase() === normalizedTitle.toLowerCase();
  return candidates.find((candidate) => {
    const isExactTitle = exactTitle(candidate.title);
    const titleSimilarity = overlapRatio(candidate.title, normalizedTitle);
    if (!isExactTitle && titleSimilarity < 0.75) return false;
    return isNearby(candidate, report.location, isExactTitle);
  }) || null;
}
