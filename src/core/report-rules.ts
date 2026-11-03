/** V0.1 PROTOTYPE PARAMETERS, not learned/calibrated probabilities. A must review. */
export const REPORT_RULES = Object.freeze({
  weights: Object.freeze({ renovation_trace: 35, partition_trace: 40, moisture_trace: 25, daylight_cue: 0 }),
  labels: Object.freeze({ renovation_trace: "装修迹象", partition_trace: "分隔迹象", moisture_trace: "潮湿迹象", daylight_cue: "采光线索" }),
  mediumAt: 0.35,
  highAt: 0.65,
  maxObservations: 200,
  maxEvidenceItems: 100,
  maxReasons: 20,
  maxTextLength: 1000,
});
export const REPORT_CATEGORIES = Object.freeze([
  "renovation_trace", "partition_trace", "moisture_trace", "daylight_cue",
] as const);
