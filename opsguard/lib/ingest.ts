import { z } from "zod";

import { normalizeDeadline, withUnparsedDeadlineReason } from "@/lib/deadline";
import {
  getDb,
  insertActivity,
  insertCommitment,
  type CommitmentRow,
} from "@/lib/db";
import { analyzeCommitment } from "@/lib/hermes";

export const ingestSchema = z.object({
  source: z.string().trim().min(1),
  sender: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

export type IngestPayload = z.infer<typeof ingestSchema>;

export type IngestResult =
  | { ok: true; success: true; commitmentDetected: false }
  | { ok: true; success: true; commitmentDetected: true; commitment: CommitmentRow }
  | { ok: false; error: string };

function commitmentStatus(riskScore: number) {
  return riskScore >= 70 ? "at_risk" : "detected";
}

export async function ingestMessage(payload: IngestPayload): Promise<IngestResult> {
  insertActivity({
    type: "MESSAGE_RECEIVED",
    message: `${payload.sender} via ${payload.source}: ${payload.text}`,
  });

  const analysis = await analyzeCommitment({
    source: payload.source,
    sender: payload.sender,
    text: payload.text,
  });

  if (!analysis.ok) {
    return { ok: false, error: analysis.error };
  }

  const result = analysis.data;

  if (!result.is_commitment) {
    insertActivity({
      type: "HERMES_ANALYSIS_COMPLETED",
      message: "Hermes completed analysis. No commitment detected.",
    });

    return { ok: true, success: true, commitmentDetected: false };
  }

  const deadline = normalizeDeadline(result.deadline);
  const riskReason = withUnparsedDeadlineReason(
    result.risk_reason,
    result.deadline,
    deadline,
  );

  const commitment = getDb().transaction(() => {
    const created = insertCommitment({
      title: result.title,
      source: payload.source,
      source_ref: null,
      person: result.person,
      deadline,
      status: commitmentStatus(result.risk_score),
      risk_score: result.risk_score,
      risk_reason: riskReason,
    });

    insertActivity({
      commitment_id: created.id,
      type: "HERMES_ANALYSIS_COMPLETED",
      message: `Hermes completed analysis for "${created.title}".`,
    });
    insertActivity({
      commitment_id: created.id,
      type: "COMMITMENT_DETECTED",
      message: `Commitment detected: ${created.title}`,
    });
    insertActivity({
      commitment_id: created.id,
      type: "COMMITMENT_CREATED",
      message: `Commitment created and tracked (${created.status}, risk ${created.risk_score}).`,
    });

    return created;
  })();

  return {
    ok: true,
    success: true,
    commitmentDetected: true,
    commitment,
  };
}
