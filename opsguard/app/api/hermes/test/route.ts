import { NextResponse } from "next/server";

import {
  analyzeCommitment,
  analyzeCommitmentInputSchema,
  pingHermes,
} from "@/lib/hermes";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const result = await pingHermes();
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json({ ok: true, hermes: result.data });
}

export async function POST(request: Request) {
  let body: unknown = {
    source: "test",
    sender: "operator",
    text: "Can you send the AI automation proposal tomorrow by 3 PM?",
  };

  try {
    const json: unknown = await request.json();
    if (json && typeof json === "object") body = json;
  } catch {
    // empty body uses the canned test message
  }

  const parsed = analyzeCommitmentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await analyzeCommitment(parsed.data);
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
