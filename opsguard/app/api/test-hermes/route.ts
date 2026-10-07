import { NextResponse } from "next/server";

import { testRemoteHermes } from "@/lib/hermes";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await testRemoteHermes();
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    result: result.data,
  });
}
