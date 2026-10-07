import { readArtifactMarkdown } from "@/lib/artifacts";
import {
  getCommitmentById,
  getDb,
  insertActivity,
  insertEvidence,
  listArtifactsByCommitmentId,
  resolvePendingApprovals,
  updateCommitmentStatus,
  type CommitmentRow,
  type EvidenceRow,
} from "@/lib/db";
import { executeTelegramDelivery } from "@/lib/hermes";

export type ApproveResult =
  | { ok: true; commitment: CommitmentRow; evidence: EvidenceRow }
  | { ok: false; error: string; status: number };

const inFlight = new Set<string>();

function getTelegramTarget() {
  return process.env.OPSGUARD_TELEGRAM_TARGET?.trim() ?? "";
}

function failExecution(commitment: CommitmentRow, error: string, status: number): ApproveResult {
  insertActivity({
    commitment_id: commitment.id,
    type: "EXECUTION_FAILED",
    message: `Execution failed for "${commitment.title}": ${error}`,
  });

  return { ok: false, error, status };
}

export async function approveCommitment(id: string): Promise<ApproveResult> {
  if (inFlight.has(id)) {
    return { ok: false, error: "Execution already in progress.", status: 409 };
  }

  const commitment = getCommitmentById(id);
  if (!commitment) {
    return { ok: false, error: "Commitment not found.", status: 404 };
  }

  if (commitment.status === "resolved") {
    return { ok: false, error: "Commitment already resolved.", status: 409 };
  }

  if (commitment.status !== "needs_approval") {
    return {
      ok: false,
      error: "Approval is only available for commitments waiting on a human gate.",
      status: 400,
    };
  }

  const artifact = listArtifactsByCommitmentId(id)[0];
  if (!artifact) {
    return { ok: false, error: "Artifact not found.", status: 404 };
  }

  const content = readArtifactMarkdown(artifact.path);
  if (content === null || !content.trim()) {
    return { ok: false, error: "Artifact not found.", status: 404 };
  }

  const target = getTelegramTarget();
  if (!target) {
    return {
      ok: false,
      error: "Missing required environment variable: OPSGUARD_TELEGRAM_TARGET",
      status: 500,
    };
  }

  inFlight.add(id);

  try {
    insertActivity({
      commitment_id: id,
      type: "APPROVAL_GRANTED",
      message: `Approval granted for "${commitment.title}".`,
    });
    insertActivity({
      commitment_id: id,
      type: "EXECUTION_STARTED",
      message: `Telegram delivery started for "${artifact.name}".`,
    });

    const delivery = await executeTelegramDelivery({
      target,
      commitment,
      artifact: {
        id: artifact.id,
        name: artifact.name,
        content,
      },
    });

    if (!delivery.ok) {
      return failExecution(commitment, delivery.error, 502);
    }

    const saved = getDb().transaction(() => {
      const current = getCommitmentById(id);
      if (!current) {
        throw new Error("Commitment not found.");
      }
      if (current.status === "resolved") {
        throw new Error("duplicate");
      }

      const evidence = insertEvidence({
        commitment_id: id,
        type: "TELEGRAM_DELIVERY",
        description: `${current.title} delivered`,
        reference: delivery.data.reference,
      });

      const updated = updateCommitmentStatus(id, "resolved");
      resolvePendingApprovals(id);

      insertActivity({
        commitment_id: id,
        type: "TELEGRAM_DELIVERED",
        message: `Artifact delivered via Telegram (${evidence.reference}).`,
      });
      insertActivity({
        commitment_id: id,
        type: "COMMITMENT_RESOLVED",
        message: `Commitment resolved: "${updated.title}".`,
      });

      return { commitment: updated, evidence };
    })();

    return { ok: true, ...saved };
  } catch (error) {
    if (error instanceof Error && error.message === "duplicate") {
      return { ok: false, error: "Commitment already resolved.", status: 409 };
    }

    return failExecution(commitment, "Could not record delivery evidence.", 500);
  } finally {
    inFlight.delete(id);
  }
}
