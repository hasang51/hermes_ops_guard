"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";

const TEST_EVENT = {
  source: "dashboard",
  sender: "operator",
  text: "Can you send the AI automation proposal tomorrow by 3 PM?",
};

export function TestEventButton() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function sendTestEvent() {
    setStatus("sending");
    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TEST_EVENT),
      });
      if (!response.ok) throw new Error("Ingest failed");
      setStatus("sent");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={sendTestEvent}
      disabled={status === "sending"}
      className="rounded-md border-white/10 bg-white/[0.03] font-mono text-[9px] tracking-[0.12em] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
    >
      <FlaskConical data-icon="inline-start" />
      {status === "sending"
        ? "SENDING"
        : status === "sent"
          ? "SENT"
          : status === "error"
            ? "FAILED"
            : "TEST EVENT"}
    </Button>
  );
}
