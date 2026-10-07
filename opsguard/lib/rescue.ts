import { saveArtifactMarkdown } from "@/lib/artifacts";
import {
  getCommitmentById,
  getDb,
  insertActivity,
  insertArtifact,
  listArtifactsByCommitmentId,
  updateCommitmentStatus,
  type ArtifactRow,
  type CommitmentRow,
} from "@/lib/db";
import { prepareCommitmentArtifact } from "@/lib/hermes";

export type RescueResult =
  | { ok: true; commitment: CommitmentRow; artifact: ArtifactRow }
  | { ok: false; error: string; status: number };

class DuplicateRescueError extends Error {
  constructor() {
    super("Rescue already completed.");
    this.name = "DuplicateRescueError";
  }
}

function failRescue(commitment: CommitmentRow, error: string, status: number): RescueResult {
  insertActivity({
    commitment_id: commitment.id,
    type: "RESCUE_FAILED",
    message: `Rescue failed for "${commitment.title}": ${error}`,
  });

  return { ok: false, error, status };
}

export async function rescueCommitment(id: string): Promise<RescueResult> {
  const commitment = getCommitmentById(id);
  if (!commitment) {
    return { ok: false, error: "Commitment not found.", status: 404 };
  }

  const existingArtifacts = listArtifactsByCommitmentId(id);
  if (commitment.status === "needs_approval" && existingArtifacts.length > 0) {
    return {
      ok: false,
      error: "Rescue already completed. Artifact is waiting for approval.",
      status: 409,
    };
  }

  if (commitment.status !== "at_risk") {
    return {
      ok: false,
      error: "Rescue is only available for at-risk commitments.",
      status: 400,
    };
  }

  insertActivity({
    commitment_id: commitment.id,
    type: "RESCUE_STARTED",
    message: `Rescue started for "${commitment.title}".`,
  });

  const prepared = await prepareCommitmentArtifact(commitment);
  if (!prepared.ok) {
    return failRescue(commitment, prepared.error, 502);
  }

  let relativePath: string;
  try {
    relativePath = saveArtifactMarkdown(
      commitment.id,
      prepared.data.artifact_name,
      prepared.data.content,
    );
  } catch {
    return failRescue(commitment, "Could not save artifact.", 500);
  }

  try {
    const saved = getDb().transaction(() => {
      const current = getCommitmentById(id);
      if (!current) {
        throw new Error("Commitment not found.");
      }

      const artifacts = listArtifactsByCommitmentId(id);
      if (current.status === "needs_approval" && artifacts.length > 0) {
        throw new DuplicateRescueError();
      }

      const artifact = insertArtifact({
        commitment_id: id,
        name: prepared.data.artifact_name,
        path: relativePath,
        type: prepared.data.artifact_type,
      });

      const updated = updateCommitmentStatus(id, "needs_approval");

      insertActivity({
        commitment_id: id,
        type: "ARTIFACT_CREATED",
        message: `Prepared artifact "${artifact.name}" for "${updated.title}". ${prepared.data.summary}`,
      });
      insertActivity({
        commitment_id: id,
        type: "APPROVAL_REQUESTED",
        message: `Approval requested for artifact "${artifact.name}" on "${updated.title}".`,
      });

      return { commitment: updated, artifact };
    })();

    return { ok: true, ...saved };
  } catch (error) {
    if (error instanceof DuplicateRescueError) {
      return {
        ok: false,
        error: "Rescue already completed. Artifact is waiting for approval.",
        status: 409,
      };
    }

    return failRescue(commitment, "Could not record artifact.", 500);
  }
}
