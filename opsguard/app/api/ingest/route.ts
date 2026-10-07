import { NextResponse } from "next/server";

import { ingestMessage, ingestSchema } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await ingestMessage(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  if (!result.commitmentDetected) {
    return NextResponse.json({
      success: true,
      commitmentDetected: false,
    });
  }

  return NextResponse.json({
    success: true,
    commitmentDetected: true,
    commitment: result.commitment,
  });
}
