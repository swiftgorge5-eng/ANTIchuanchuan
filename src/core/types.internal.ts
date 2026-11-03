/** TRANSITIONAL D-local copies of docs/interfaces.md. Replace with A's contracts.
 * Do not treat this file as the team's public contracts or rename their fields.
 */
export interface PreparedPhoto { id: string; mimeType: string; data: string }
export interface LocationQuery { city?: string; district?: string; communityName?: string; addressHint?: string }
export interface EvidenceItem {
  id: string;
  communityName: string;
  sourceType: "public" | "synthetic";
  title: string;
  publisher: string;
  url: string | null;
  date: string | null;
  summary: string;
  matchStatus: "confirmed" | "possible";
}
export interface EvidenceResult {
  status: "matched" | "ambiguous" | "no_match";
  query: LocationQuery;
  items: EvidenceItem[];
}
export interface PhotoInput { photos: PreparedPhoto[]; apiKey: string; provider: "gemini"; signal: AbortSignal }
export interface PhotoObservation {
  photoId: string;
  category: "renovation_trace" | "partition_trace" | "moisture_trace" | "daylight_cue";
  state: "present" | "absent" | "unknown";
  evidence: string[];
}
export interface PhotoObservationResult { schema_version: 1; observations: PhotoObservation[] }
export interface RiskAssessment {
  score: number | null;
  level: "low" | "medium" | "high" | "insufficient";
  calibrated: false;
  explanation: string;
}
export interface FinalReport {
  status: "success";
  risk: RiskAssessment;
  observations: PhotoObservation[];
  evidence: EvidenceResult;
  limitations: string[];
  rentalMode: "whole" | "shared" | "unknown";
}
