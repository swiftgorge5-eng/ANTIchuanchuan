/**
 * Browser composition for the existing D runner. Vite embeds the maintained
 * Markdown file at build time; no API/database, and no fetch to GitHub at runtime.
 * E can use runAnalysisWithRag with the same 3-argument signature as runAnalysis.
 */
import libraryText from "../../RAG/小区历史问题.md?raw";
import { createHistoricalRag } from "./retrieve.ts";
import { createAnalysisRunner } from "../core/orchestrator.ts";
import { createMockPorts } from "../core/adapters/mock.ts";
import type { CorePorts } from "../core/ports.ts";

const rag = createHistoricalRag(libraryText);
// Unknown observations are deliberate: real historical sources cannot validate fake photo facts.
const mockPhoto = createMockPorts({ scenario: "unknown" });

export const retrieveEvidence = rag.retrieveEvidence;
export const getConfirmedRagContext = rag.getConfirmedRecords;
export const ragRecordCount = rag.recordCount;

/** Offline demo: real historical citations, but NO risk score from synthetic photos. */
export const runAnalysisWithRag = createAnalysisRunner({
  mock: { observePhotos: mockPhoto.observePhotos, retrieveEvidence },
});

/**
 * When C ships a validated browser-capable observer, provide it here.
 * The real mode does not quietly fall back to the fake observer.
 */
export function createRagAnalysisRunner(realObserver: CorePorts["observePhotos"]) {
  return createAnalysisRunner({
    mock: { observePhotos: mockPhoto.observePhotos, retrieveEvidence },
    real: { observePhotos: realObserver, retrieveEvidence },
  });
}
