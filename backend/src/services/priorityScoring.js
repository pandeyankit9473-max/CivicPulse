const categoryWeights = {
  Pothole: 12,
  Garbage: 4,
  Streetlight: 8,
  "Road Damage": 15,
  Water: 18,
  Other: 0
};

const urgencySignals = [
  { pattern: /\b(danger|dangerous|accident|injury|injured|emergency)\b/i, label: "Safety risk mentioned" },
  { pattern: /\b(flood|flooding|leak|leaking|burst pipe|water overflow|overflowing water)\b/i, label: "Active water hazard mentioned" },
  { pattern: /\b(school|hospital|crossing|wheelchair|accessible|children)\b/i, label: "High-impact public access mentioned" }
];

export function scoreIssue({ category, title, description }) {
  const reasons = ["Every report starts with a baseline score of 30"];
  let score = 30;
  const categoryWeight = categoryWeights[category] ?? 0;

  if (categoryWeight) {
    score += categoryWeight;
    reasons.push(`${category} category adds ${categoryWeight} points`);
  }

  const text = `${title} ${description}`;
  for (const signal of urgencySignals) {
    if (signal.pattern.test(text)) {
      score += 22;
      reasons.push(`${signal.label} adds 22 points`);
    }
  }

  score = Math.min(score, 100);
  const priority = score >= 70 ? "High" : score >= 45 ? "Medium" : "Low";
  reasons.push(`${priority} priority is assigned for scores ${priority === "High" ? "70–100" : priority === "Medium" ? "45–69" : "0–44"}`);

  return { priority, priorityScore: score, priorityReasons: reasons };
}
