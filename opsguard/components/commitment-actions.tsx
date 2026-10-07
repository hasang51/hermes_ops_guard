"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type CommitmentArtifactView = {
  name: string;
  content: string;
};

export function CommitmentActions({
  commitmentId,
  status,
  artifact,
}: {
  commitmentId: string;
  status: string;
  artifact: CommitmentArtifactView | null;
}) {
  const router = useRouter();
  const [rescuing, setRescuing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  async function rescue() {
    setRescuing(true);
    setError(null);
    try {
      const response = await fetch(`/api/commitments/${commitmentId}/rescue`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Rescue failed.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rescue failed.");
    } finally {
      setRescuing(false);
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commitments/${commitmentId}/approve`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Telegram delivery failed.");
      }
      setDelivered(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram delivery failed.");
    } finally {
      setApproving(false);
    }
  }

  if (status === "at_risk") {
    return (
      <div className="flex flex-col items-start gap-1 md:items-end">
        <Button
          type="button"
          size="xs"
          onClick={rescue}
          disabled={rescuing}
          className="rounded-md border border-rose-300/20 bg-rose-300 px-2.5 font-mono text-[9px] tracking-[0.12em] text-[#160809] hover:bg-rose-200"
        >
          {rescuing ? "RESCUING..." : "RESCUE"}
        </Button>
        {error ? (
          <p className="max-w-40 text-right font-mono text-[8px] leading-relaxed text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (status === "resolved" || delivered) {
    return (
      <div className="flex flex-col items-start gap-1 md:items-end">
        <p className="font-mono text-[8px] tracking-[0.14em] text-emerald-300">
          Delivered via Telegram
        </p>
      </div>
    );
  }

  if (status === "needs_approval" && artifact) {
    return (
      <div className="flex min-w-0 flex-col items-start gap-1.5 md:items-end">
        <p className="font-mono text-[8px] tracking-[0.14em] text-amber-200">
          Artifact ready
        </p>
        <p className="max-w-44 truncate text-[10px] text-zinc-300">{artifact.name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setReviewOpen(true)}
            disabled={approving}
            className="rounded-md border-white/10 bg-white/[0.03] font-mono text-[9px] tracking-[0.12em] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-100"
          >
            Review
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={approve}
            disabled={approving}
            className="rounded-md border border-amber-200/20 bg-amber-200 px-2.5 font-mono text-[9px] tracking-[0.12em] text-[#171307] hover:bg-amber-100"
          >
            {approving ? "SENDING..." : "Approve"}
          </Button>
        </div>
        {error ? (
          <p className="max-w-44 text-right font-mono text-[8px] leading-relaxed text-rose-300">
            {error}
          </p>
        ) : null}
        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent className="max-h-[85vh] overflow-hidden border-white/10 bg-[#0d100f] sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-zinc-100">{artifact.name}</DialogTitle>
              <DialogDescription>
                Prepared artifact. Nothing has been sent or executed.
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-white/[0.08] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
              {artifact.content || "Artifact file could not be read."}
            </pre>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return null;
}
