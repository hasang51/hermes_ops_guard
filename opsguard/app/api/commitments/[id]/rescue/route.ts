import { NextResponse } from "next/server";

import { readArtifactMarkdown } from "@/lib/artifacts";
import { rescueCommitment } from "@/lib/rescue";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Commitment not found." }, { status: 404 });
  }

  const result = await rescueCommitment(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    commitment: result.commitment,
    artifact: {
      ...result.artifact,
      content: readArtifactMarkdown(result.artifact.path) ?? "",
    },
  });
}
