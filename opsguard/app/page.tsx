import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  MailCheck,
  MessageSquareText,
  Radio,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  UserRoundCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { CommitmentActions } from "@/components/commitment-actions";
import { DashboardRefresher } from "@/components/dashboard-refresher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TestEventButton } from "@/components/test-event-button";
import { readArtifactMarkdown } from "@/lib/artifacts";
import { parseDeadline } from "@/lib/deadline";
import {
  loadDashboard,
  type ArtifactRow,
  type CommitmentRow,
  type EvidenceRow,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_LABEL: Record<
  string,
  "At risk" | "In motion" | "On track" | "Detected" | "Needs approval" | "Resolved"
> = {
  at_risk: "At risk",
  in_motion: "In motion",
  on_track: "On track",
  detected: "Detected",
  needs_approval: "Needs approval",
  resolved: "Resolved",
};

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  analyze: ScanSearch,
  document: FileCheck2,
  message: MessageSquareText,
  ingest: MessageSquareText,
  deadline: Timer,
  calendar: CheckCircle2,
  MESSAGE_RECEIVED: MessageSquareText,
  HERMES_ANALYSIS_COMPLETED: ScanSearch,
  COMMITMENT_DETECTED: Target,
  COMMITMENT_CREATED: CheckCircle2,
  RESCUE_STARTED: Zap,
  ARTIFACT_CREATED: FileCheck2,
  APPROVAL_REQUESTED: ShieldCheck,
  APPROVAL_GRANTED: UserRoundCheck,
  EXECUTION_STARTED: Zap,
  TELEGRAM_DELIVERED: MailCheck,
  COMMITMENT_RESOLVED: CheckCircle2,
  EXECUTION_FAILED: CircleAlert,
  RESCUE_FAILED: CircleAlert,
};

const EVIDENCE_ICONS: Record<string, LucideIcon> = {
  document_created: FileCheck2,
  message_sent: MailCheck,
  deadline_detected: Timer,
  approval_received: UserRoundCheck,
  TELEGRAM_DELIVERY: MailCheck,
};

const EVIDENCE_LABELS: Record<string, string> = {
  document_created: "Document created",
  message_sent: "Message sent",
  deadline_detected: "Deadline detected",
  approval_received: "Approval received",
  TELEGRAM_DELIVERY: "Telegram delivery",
};

function initials(person: string) {
  const words = person
    .replace(/[·,]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !/^(and|&|of|the|corp|inc|llc)$/i.test(word));

  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

function formatDeadline(iso: string | null, now: number) {
  if (!iso) return "No deadline";
  const date = parseDeadline(iso);
  if (!date) return "Deadline unavailable";
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOf(date) - startOf(new Date(now))) / 86_400_000);

  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Tomorrow, ${time}`;
  if (diffDays === -1) return `Yesterday, ${time}`;

  return `${date.toLocaleDateString("en-US", { month: "short", day: "2-digit" })}, ${time}`;
}

function remainingLabel(iso: string | null, now: number) {
  if (!iso) return "none";
  const date = parseDeadline(iso);
  if (!date) return "unavailable";
  const ms = date.getTime() - now;
  if (!Number.isFinite(ms)) return "unavailable";
  if (ms <= 0) return "overdue";

  const minutes = Math.round(ms / 60_000);
  if (!Number.isFinite(minutes)) return "unavailable";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  return `${Math.floor(hours / 24)}d`;
}

function remainingCaption(remaining: string) {
  if (remaining === "overdue") return "overdue";
  if (remaining === "none") return "no deadline";
  if (remaining === "unavailable") return "deadline unavailable";
  return `${remaining} remaining`;
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatEvidenceTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

function SectionHeading({
  title,
  count,
  description,
}: {
  title: string;
  count?: number;
  description: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        <h2 className="font-mono text-[11px] font-semibold tracking-[0.2em] text-zinc-100">
          {title}
        </h2>
        {count !== undefined && (
          <span className="flex size-5 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] font-mono text-[10px] text-zinc-400">
            {count}
          </span>
        )}
      </div>
      <p className="hidden text-[11px] text-zinc-600 sm:block">{description}</p>
    </div>
  );
}

function RiskIndicator({ value }: { value: number }) {
  const color =
    value >= 75 ? "bg-rose-400" : value >= 45 ? "bg-amber-300" : "bg-emerald-400";

  return (
    <div className="min-w-24">
      <div className="mb-1.5 flex items-center justify-between font-mono text-[10px]">
        <span className="text-zinc-600">RISK</span>
        <span
          className={
            value >= 75 ? "text-rose-300" : value >= 45 ? "text-amber-200" : "text-emerald-300"
          }
        >
          {value}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function activityTitle(type: string) {
  if (type === "analyze") return "Analyzing options";
  if (type === "document") return "Drafted document";
  if (type === "message") return "Sent follow-up";
  if (type === "deadline") return "Deadline detected";
  if (type === "calendar") return "Calendar update";
  if (type === "ingest") return "Inbound message";
  if (type === "MESSAGE_RECEIVED") return "Message received";
  if (type === "HERMES_ANALYSIS_COMPLETED") return "Hermes analysis completed";
  if (type === "COMMITMENT_DETECTED") return "Commitment detected";
  if (type === "COMMITMENT_CREATED") return "Commitment created";
  if (type === "RESCUE_STARTED") return "Rescue started";
  if (type === "ARTIFACT_CREATED") return "Artifact created";
  if (type === "APPROVAL_REQUESTED") return "Approval requested";
  if (type === "APPROVAL_GRANTED") return "Approval granted";
  if (type === "EXECUTION_STARTED") return "Execution started";
  if (type === "TELEGRAM_DELIVERED") return "Telegram delivered";
  if (type === "COMMITMENT_RESOLVED") return "Commitment resolved";
  if (type === "EXECUTION_FAILED") return "Execution failed";
  if (type === "RESCUE_FAILED") return "Rescue failed";
  return type.replace(/_/g, " ");
}

export default function Home() {
  const {
    commitments,
    pendingApprovals,
    activities,
    evidence,
    evidenceCount,
    resolvedCount,
    autonomousResolvedCount,
    artifacts,
    now,
  } = loadDashboard();

  const latestArtifactByCommitment = new Map<string, ArtifactRow>();
  for (const artifact of artifacts) {
    if (!latestArtifactByCommitment.has(artifact.commitment_id)) {
      latestArtifactByCommitment.set(artifact.commitment_id, artifact);
    }
  }

  const pendingCount = pendingApprovals.length;
  const autonomyScore =
    resolvedCount < 2
      ? null
      : Math.round((autonomousResolvedCount / resolvedCount) * 100);
  const autonomyTicks = autonomyScore === null ? 0 : Math.round(autonomyScore / 10);
  const workstreams = new Set(activities.map((item) => item.commitment_id)).size;
  const latestActivity = activities[0];
  const autopilotActive =
    latestActivity !== undefined &&
    now - new Date(latestActivity.created_at).getTime() < 30 * 60_000;
  const insight = pendingApprovals[0]
    ? `${pendingApprovals[0].commitment_title} is the only commitment requiring your direct intervention.`
    : "No human gates are open. Hermes is containing every tracked commitment.";

  return (
    <main className="mission-grid relative min-h-screen overflow-hidden bg-[#050706] text-zinc-100">
      <DashboardRefresher />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_72%_-20%,rgba(64,255,190,0.12),transparent_45%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1560px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
        <header className="mb-4 flex flex-col gap-4 border-b border-white/[0.08] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="relative grid size-10 place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_30px_rgba(52,211,153,0.08)]">
              <Target className="size-5 text-emerald-300" strokeWidth={1.8} />
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-[#050706] bg-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-semibold tracking-[0.18em] text-white">OPSGUARD</h1>
                <Badge
                  variant="outline"
                  className="h-4 rounded-sm border-white/10 bg-white/[0.03] px-1.5 font-mono text-[8px] tracking-[0.14em] text-zinc-500"
                >
                  HERMES
                </Badge>
              </div>
              <p className="text-xs tracking-wide text-zinc-500">Autonomous Chief of Staff</p>
            </div>
            {process.env.NODE_ENV === "development" ? <TestEventButton /> : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-7 gap-y-3 sm:justify-end">
            <div className="flex items-center gap-3 border-r border-white/[0.08] pr-7">
              <span className="relative flex size-2">
                {autopilotActive && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-50" />
                )}
                <span
                  className={`relative inline-flex size-2 rounded-full ${autopilotActive ? "bg-emerald-300" : "bg-zinc-600"}`}
                />
              </span>
              <div>
                <p className="font-mono text-[9px] tracking-[0.16em] text-zinc-600">SYSTEM STATUS</p>
                <p
                  className={`mt-0.5 font-mono text-[11px] font-semibold tracking-[0.08em] ${
                    autopilotActive ? "text-emerald-300" : "text-zinc-500"
                  }`}
                >
                  {autopilotActive ? "AUTOPILOT ACTIVE" : "STANDBY"}
                </p>
              </div>
            </div>
            <div className="min-w-40">
              <div className="mb-1.5 flex items-end justify-between">
                <div>
                  <p className="font-mono text-[9px] tracking-[0.16em] text-zinc-600">AUTONOMY SCORE</p>
                  <p className="font-mono text-[10px] text-zinc-500">
                    {pendingCount === 0 ? "No open gates" : `${pendingCount} open gate${pendingCount === 1 ? "" : "s"}`}
                  </p>
                </div>
                <span className="font-mono text-xl font-medium text-white">
                  {autonomyScore === null ? (
                    "—"
                  ) : (
                    <>
                      {autonomyScore}
                      <span className="text-xs text-zinc-500">%</span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex h-1 gap-1">
                {Array.from({ length: 10 }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-full flex-1 rounded-full ${
                      index < autonomyTicks
                        ? "bg-emerald-300"
                        : index === autonomyTicks
                          ? "bg-emerald-300/40"
                          : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.72fr)_minmax(340px,0.72fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <section>
              <SectionHeading
                title="NEEDS YOU"
                count={pendingCount}
                description="Only decisions that cannot be delegated"
              />
              <div
                className={`mt-2.5 grid gap-2.5 ${pendingCount > 1 ? "lg:grid-cols-2" : ""}`}
              >
                {pendingApprovals.length === 0 ? (
                  <div className="rounded-lg border border-white/[0.08] bg-[#090c0b]/85 px-4 py-5">
                    <p className="font-mono text-[10px] tracking-[0.14em] text-emerald-300">CLEAR</p>
                    <p className="mt-1 text-sm text-zinc-400">No human gates are open.</p>
                  </div>
                ) : (
                  pendingApprovals.map((item) => {
                    const deadline = parseDeadline(item.deadline);
                    const overdue = deadline !== null && deadline.getTime() <= now;
                    const isRed = overdue || item.risk_score >= 80;
                    const Icon = overdue ? Clock3 : ShieldCheck;

                    return (
                      <Card
                        key={item.id}
                        className={`group relative gap-0 overflow-hidden rounded-lg border py-0 ring-0 transition-colors ${
                          isRed
                            ? "border-rose-400/20 bg-rose-400/[0.045] hover:border-rose-400/35"
                            : "border-amber-300/20 bg-amber-300/[0.045] hover:border-amber-300/35"
                        }`}
                      >
                        <div className={`absolute inset-y-0 left-0 w-px ${isRed ? "bg-rose-400" : "bg-amber-300"}`} />
                        <CardContent className="flex h-full items-start gap-3 p-3.5">
                          <div
                            className={`grid size-8 shrink-0 place-items-center rounded-md border ${
                              isRed
                                ? "border-rose-400/20 bg-rose-400/10 text-rose-300"
                                : "border-amber-300/20 bg-amber-300/10 text-amber-200"
                            }`}
                          >
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`font-mono text-[9px] uppercase tracking-[0.15em] ${
                                isRed ? "text-rose-300" : "text-amber-200"
                              }`}
                            >
                              Approval required
                            </p>
                            <h3 className="mt-1 truncate text-sm font-medium text-zinc-100">
                              {item.action}
                            </h3>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">
                              {item.risk_reason}. {item.commitment_title}.
                            </p>
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <span className="font-mono text-[9px] text-zinc-600">
                                {item.person} · {remainingCaption(remainingLabel(item.deadline, now))}
                              </span>
                              <Button
                                size="xs"
                                className={`rounded-md border px-2.5 font-mono text-[9px] ${
                                  isRed
                                    ? "border-rose-300/20 bg-rose-300 text-[#160809] hover:bg-rose-200"
                                    : "border-amber-200/20 bg-amber-200 text-[#171307] hover:bg-amber-100"
                                }`}
                              >
                                Review
                                <ChevronRight data-icon="inline-end" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </section>

            <section className="min-h-0 flex-1">
              <SectionHeading
                title="COMMITMENTS"
                count={commitments.length}
                description="Promises monitored across every channel"
              />
              <div className="mt-2.5 overflow-hidden rounded-lg border border-white/[0.08] bg-[#090c0b]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
                <div className="hidden grid-cols-[minmax(200px,1.5fr)_minmax(120px,0.8fr)_90px_105px_minmax(110px,0.7fr)_minmax(160px,0.9fr)] gap-4 border-b border-white/[0.06] bg-white/[0.018] px-4 py-2 font-mono text-[8px] uppercase tracking-[0.16em] text-zinc-600 md:grid">
                  <span>Commitment</span>
                  <span>Deadline</span>
                  <span>Risk score</span>
                  <span>Status</span>
                  <span>Blocker</span>
                  <span>Action</span>
                </div>
                <div className="divide-y divide-white/[0.055]">
                  {commitments.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-600">NO COMMITMENTS</p>
                      <p className="mt-2 text-[12px] text-zinc-500">Run npm run seed to load development data.</p>
                    </div>
                  ) : (
                    commitments.map((commitment: CommitmentRow) => {
                      const status = statusLabel(commitment.status);
                      const remaining = remainingLabel(commitment.deadline, now);
                      const latestArtifact = latestArtifactByCommitment.get(commitment.id);
                      const artifactView =
                        commitment.status === "needs_approval" && latestArtifact
                          ? {
                              name: latestArtifact.name,
                              content: readArtifactMarkdown(latestArtifact.path) ?? "",
                            }
                          : null;

                      return (
                        <div
                          key={commitment.id}
                          className="group grid gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025] md:grid-cols-[minmax(200px,1.5fr)_minmax(120px,0.8fr)_90px_105px_minmax(110px,0.7fr)_minmax(160px,0.9fr)] md:items-center md:gap-4"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="grid size-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.035] font-mono text-[9px] text-zinc-400">
                              {initials(commitment.person)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-zinc-200 group-hover:text-white">
                                {commitment.title}
                              </p>
                              <p className="mt-0.5 truncate text-[10px] text-zinc-600">
                                {commitment.person}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between md:block">
                            <span className="font-mono text-[9px] uppercase text-zinc-600 md:hidden">
                              Deadline
                            </span>
                            <div>
                              <p className="font-mono text-[10px] text-zinc-300">
                                {formatDeadline(commitment.deadline, now)}
                              </p>
                              <p
                                className={`mt-0.5 font-mono text-[9px] ${
                                  commitment.risk_score >= 75 || remaining === "overdue"
                                    ? "text-rose-300"
                                    : "text-zinc-600"
                                }`}
                              >
                                {remainingCaption(remaining)}
                              </p>
                            </div>
                          </div>
                          <RiskIndicator value={commitment.risk_score} />
                          <div>
                            <Badge
                              variant="outline"
                              className={`h-5 rounded-sm px-2 font-mono text-[9px] ${
                                status === "At risk"
                                  ? "border-rose-400/20 bg-rose-400/[0.08] text-rose-300"
                                  :                                 status === "Needs approval"
                                    ? "border-amber-300/20 bg-amber-300/[0.08] text-amber-200"
                                    : status === "Resolved" || status === "On track"
                                      ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
                                      : "border-sky-400/20 bg-sky-400/[0.08] text-sky-300"
                              }`}
                            >
                              <span className="size-1 rounded-full bg-current" />
                              {status}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`truncate text-[10px] ${commitment.risk_reason ? "text-zinc-400" : "text-zinc-600"}`}
                            >
                              {commitment.risk_reason || "None"}
                            </span>
                            {commitment.risk_reason ? (
                              <CircleAlert className="size-3 shrink-0 text-zinc-600" />
                            ) : null}
                          </div>
                          <CommitmentActions
                            commitmentId={commitment.id}
                            status={commitment.status}
                            artifact={artifactView}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          </div>

          <section className="flex min-h-0 flex-col rounded-lg border border-white/[0.08] bg-[#090c0b]/85 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Radio className="size-3.5 text-emerald-300" />
                  <h2 className="font-mono text-[11px] font-semibold tracking-[0.2em] text-zinc-100">
                    AUTOPILOT
                  </h2>
                </div>
                <p className="mt-1.5 text-[10px] text-zinc-600">
                  {workstreams === 0
                    ? "Waiting for Hermes"
                    : `Hermes is operating across ${workstreams} workstream${workstreams === 1 ? "" : "s"}`}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`h-5 rounded-sm font-mono text-[8px] tracking-[0.1em] ${
                  autopilotActive
                    ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-300"
                    : "border-white/10 bg-white/[0.03] text-zinc-500"
                }`}
              >
                <span
                  className={`size-1 rounded-full ${autopilotActive ? "animate-pulse bg-emerald-300" : "bg-zinc-600"}`}
                />
                {autopilotActive ? "LIVE" : "IDLE"}
              </Badge>
            </div>

            <div className="relative mt-5 flex-1">
              {activities.length === 0 ? (
                <p className="py-8 text-center text-[11px] text-zinc-600">No recent Hermes activity.</p>
              ) : (
                <>
                  <div className="absolute bottom-3 left-[15px] top-3 w-px bg-gradient-to-b from-emerald-300/40 via-white/10 to-transparent" />
                  <div className="space-y-5">
                    {activities.map((item, index) => {
                      const Icon = ACTIVITY_ICONS[item.type] ?? ScanSearch;
                      const active = index === 0 && autopilotActive;

                      return (
                        <div key={item.id} className="relative flex gap-3">
                          <div
                            className={`relative z-10 grid size-[31px] shrink-0 place-items-center rounded-full border ${
                              active
                                ? "border-emerald-300/25 bg-emerald-300/[0.09] text-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.08)]"
                                : "border-white/[0.08] bg-[#0d100f] text-zinc-600"
                            }`}
                          >
                            <Icon className={`size-3.5 ${index === 0 && autopilotActive ? "animate-pulse" : ""}`} />
                          </div>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="flex items-start justify-between gap-3">
                              <p className={`text-[11px] font-medium ${active ? "text-zinc-200" : "text-zinc-400"}`}>
                                {activityTitle(item.type)}
                              </p>
                              <span className="shrink-0 font-mono text-[8px] text-zinc-700">
                                {formatClock(item.created_at)}
                              </span>
                            </div>
                            <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">{item.message}</p>
                            {index === 0 && autopilotActive && (
                              <div className="mt-2.5 h-0.5 overflow-hidden rounded-full bg-white/[0.05]">
                                <div className="activity-scan h-full w-1/2 rounded-full bg-emerald-300" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 rounded-md border border-emerald-300/10 bg-emerald-300/[0.035] p-3">
              <div className="flex items-center gap-2">
                <Bot className="size-3.5 text-emerald-300" />
                <p className="font-mono text-[9px] tracking-[0.12em] text-emerald-300">HERMES INSIGHT</p>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">{insight}</p>
            </div>
          </section>
        </div>

        <section className="mt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-mono text-[11px] font-semibold tracking-[0.2em] text-zinc-100">
                PROOF / EVIDENCE
              </h2>
              <span className="font-mono text-[9px] text-emerald-300">
                {evidenceCount} outcome{evidenceCount === 1 ? "" : "s"} recorded
              </span>
            </div>
            <div className="hidden items-center gap-1.5 font-mono text-[9px] text-zinc-700 sm:flex">
              <Check className="size-3 text-emerald-400" />
              All actions auditable
            </div>
          </div>
          <div className="grid overflow-hidden rounded-lg border border-white/[0.08] bg-[#090c0b]/85 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-white/[0.06]">
            {evidence.length === 0 ? (
              <div className="px-4 py-8 text-center sm:col-span-2 xl:col-span-4">
                <p className="text-[12px] text-zinc-500">No outcomes recorded yet.</p>
              </div>
            ) : (
              evidence.map((item: EvidenceRow) => {
                const Icon = EVIDENCE_ICONS[item.type] ?? FileCheck2;

                return (
                  <div
                    key={item.id}
                    className="group flex items-center gap-3 border-b border-white/[0.06] p-3 transition-colors last:border-b-0 hover:bg-white/[0.025] sm:odd:border-r sm:odd:border-white/[0.06] xl:border-b-0 xl:odd:border-r-0"
                  >
                    <div className="grid size-8 shrink-0 place-items-center rounded-md border border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-300">
                      <Icon className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="size-2.5 text-emerald-300/60" />
                        <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
                          {EVIDENCE_LABELS[item.type] ?? item.type.replace(/_/g, " ")}
                        </p>
                      </div>
                      <p className="mt-1 truncate text-[11px] font-medium text-zinc-300 group-hover:text-white">
                        {item.description}
                      </p>
                      <p className="mt-0.5 font-mono text-[8px] text-zinc-700">
                        {formatEvidenceTime(item.created_at)}
                        {item.reference ? ` · ${item.reference}` : ""}
                      </p>
                    </div>
                    <Zap className="size-3 text-zinc-800 transition-colors group-hover:text-emerald-300/50" />
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
