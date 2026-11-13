// Reference cases frozen from the concept (concept/vibration-concept.html, v7).
// Each case is a set of overrides on the concept's default sidebar inputs.
export const CASES = {
  'a-default-office-corridor': {},
  'b-residential-single-bay': { layout: 'bay', LLd: 40, LLv: 6, fire: 0 },
  'c-2hr-fire-6-floors': { fire: 2, stories: 6 },
  'd-depth-and-crane-limits': { maxD: 42, maxPick: 5 },
  'e-forced-canadian-split-supply': { sup: '3', split: true },
};
