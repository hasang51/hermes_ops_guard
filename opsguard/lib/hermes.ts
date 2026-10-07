import { spawn, type ChildProcess } from "node:child_process";

import { z } from "zod";

import { currentTemporalContext } from "@/lib/deadline";

const HERMES_TIMEOUT_MS = 100_000;
const HERMES_SEND_TIMEOUT_MS = 45_000;
const TELEGRAM_MESSAGE_LIMIT = 3_900;
const LOCAL_HERMES_BRIDGE = "/home/hermes/hermes-bridge.py";
const LOCAL_HERMES_BIN = "/home/hermes/.local/bin/hermes";

const REQUIRED_SSH_ENV = [
  "HERMES_SSH_HOST",
  "HERMES_SSH_USER",
  "HERMES_SSH_PORT",
  "HERMES_SSH_KEY",
  "HERMES_REMOTE_BRIDGE",
] as const;

const SAFE_REMOTE_ARG = /^[A-Za-z0-9_./:@#+-]+$/;
const TELEGRAM_TARGET = /^telegram(?::[A-Za-z0-9_#.@+-]+)*$/;

export const analyzeCommitmentInputSchema = z.object({
  source: z.string().trim().min(1),
  sender: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

export const analyzeCommitmentResultSchema = z.object({
  is_commitment: z.boolean(),
  title: z.string(),
  person: z.string(),
  deadline: z.union([z.string(), z.null()]),
  risk_score: z.number().int().min(0).max(100),
  risk_reason: z.string(),
  required_artifact: z.string(),
  suggested_action: z.string(),
});

const pingResultSchema = z.object({
  ok: z.literal(true),
});

const connectedResultSchema = z.object({
  connected: z.literal(true),
});

const commitmentSchemaHint = JSON.stringify({
  is_commitment: true,
  title: "...",
  person: "...",
  deadline: "ISO-8601 datetime with offset, or null",
  risk_score: 0,
  risk_reason: "...",
  required_artifact: "...",
  suggested_action: "...",
});

const preparedArtifactSchemaHint = JSON.stringify({
  artifact_name: "string",
  artifact_type: "markdown",
  content: "string",
  summary: "string",
});

export const preparedArtifactSchema = z.object({
  artifact_name: z.string().trim().min(1),
  artifact_type: z.literal("markdown"),
  content: z.string().min(1),
  summary: z.string().trim().min(1),
});

export type AnalyzeCommitmentInput = z.infer<typeof analyzeCommitmentInputSchema>;
export type AnalyzeCommitmentData = z.infer<typeof analyzeCommitmentResultSchema>;
export type PreparedArtifact = z.infer<typeof preparedArtifactSchema>;
export type PrepareArtifactCommitment = {
  title: string;
  person: string;
  deadline: string | null;
  risk_reason: string;
};

export type TelegramDeliveryInput = {
  target: string;
  commitment: { id: string; title: string; person: string };
  artifact: { id: string; name: string; content: string };
};

export type TelegramDeliveryData = {
  reference: string;
  platform: string;
  messageId: string | null;
  chatId: string | null;
};

export type HermesResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type SshConfig = {
  host: string;
  user: string;
  port: string;
  keyPath: string;
  remoteBridge: string;
};

type HermesTransport = "ssh" | "local";

class HermesTransportError extends Error {
  code: string | number | null;

  constructor(message: string, code: string | number | null = null) {
    super(message);
    this.name = "HermesTransportError";
    this.code = code;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new HermesTransportError(
      `Missing required environment variable: ${name}`,
      "HERMES_ENV",
    );
  }
  return value;
}

function getHermesTransport(): HermesTransport {
  const transport = process.env.HERMES_TRANSPORT?.trim().toLowerCase() || "ssh";
  if (transport !== "ssh" && transport !== "local") {
    throw new HermesTransportError(
      "HERMES_TRANSPORT must be either ssh or local.",
      "HERMES_ENV",
    );
  }
  return transport;
}

function getSshConfig(): SshConfig {
  const [host, user, port, keyPath, remoteBridge] = REQUIRED_SSH_ENV.map(requireEnv);

  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new HermesTransportError(
      "HERMES_SSH_PORT must be a valid TCP port.",
      "HERMES_ENV",
    );
  }

  return { host, user, port, keyPath, remoteBridge };
}

function assertSafeRemoteArg(value: string, label: string) {
  if (!SAFE_REMOTE_ARG.test(value) || value.length > 256) {
    throw new HermesTransportError(`Invalid ${label}.`, "HERMES_ENV");
  }
}

function quoteRemoteArg(value: string, label: string) {
  assertSafeRemoteArg(value, label);
  return `'${value}'`;
}

function getHermesRemoteBin(user: string) {
  const configured = process.env.HERMES_REMOTE_BIN?.trim();
  const bin = configured || `/home/${user}/.local/bin/hermes`;
  assertSafeRemoteArg(bin, "HERMES_REMOTE_BIN");
  return bin;
}

function spawnSsh(remoteArgv: readonly string[]): ChildProcess {
  const { host, user, port, keyPath } = getSshConfig();
  const remoteCommand = remoteArgv
    .map((token, index) => quoteRemoteArg(token, `remote argument ${index + 1}`))
    .join(" ");

  return spawn(
    /* turbopackIgnore: true */ "ssh",
    [
      "-i",
      keyPath,
      "-p",
      port,
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      `${user}@${host}`,
      remoteCommand,
    ],
    {
      shell: false,
      windowsHide: true,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function spawnLocal(executable: string, argv: readonly string[]): ChildProcess {
  return spawn(executable, [...argv], {
    shell: false,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function stripMarkdownFences(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseJson(text: string): unknown | null {
  const stripped = stripMarkdownFences(text);
  if (!stripped) return null;

  const candidates = [stripped];
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    candidates.push(stripped.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
  }

  return null;
}

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function runHermesProcess(
  spawnChild: () => ChildProcess,
  stdin: string,
  timeoutMs = HERMES_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnChild();
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill();
      settle(() =>
        reject(new HermesTransportError("Hermes timed out.", "HERMES_TIMEOUT")),
      );
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.stdin?.on("error", (error) => {
      settle(() => reject(error));
    });

    child.stdin?.write(stdin, "utf8");
    child.stdin?.end();

    child.on("error", (error) => {
      settle(() => reject(error));
    });

    child.on("close", (code) => {
      settle(() => resolve({ code, stdout, stderr }));
    });
  });
}

function runRemoteHermesCommand(
  remoteArgv: readonly string[],
  stdin: string,
  timeoutMs = HERMES_TIMEOUT_MS,
) {
  return runHermesProcess(() => spawnSsh(remoteArgv), stdin, timeoutMs);
}

function runLocalHermesCommand(
  executable: string,
  argv: readonly string[],
  stdin: string,
  timeoutMs = HERMES_TIMEOUT_MS,
) {
  return runHermesProcess(() => spawnLocal(executable, argv), stdin, timeoutMs);
}

export async function runHermesPrompt(prompt: string): Promise<string> {
  const transport = getHermesTransport();
  const result =
    transport === "local"
      ? await runLocalHermesCommand(LOCAL_HERMES_BRIDGE, [], prompt)
      : await runRemoteHermesCommand([getSshConfig().remoteBridge], prompt);

  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(0, 2000);
    throw new HermesTransportError(
      detail
        ? `${transport.toUpperCase()} Hermes transport exited with code ${result.code ?? "unknown"}: ${detail}`
        : `${transport.toUpperCase()} Hermes transport exited with code ${result.code ?? "unknown"}.`,
      result.code,
    );
  }
  return result.stdout;
}

function hermesError(error: unknown): HermesResult<never> {
  if (error instanceof HermesTransportError) {
    if (error.code === "HERMES_ENV") {
      return { ok: false, error: error.message };
    }
    if (error.code === "HERMES_TIMEOUT") {
      return { ok: false, error: "Hermes timed out." };
    }
    return { ok: false, error: error.message };
  }

  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        error:
          process.env.HERMES_TRANSPORT?.trim().toLowerCase() === "local"
            ? "The local Hermes bridge or binary was not found."
            : "ssh was not found. Install OpenSSH or ensure ssh is on PATH.",
      };
    }
    if (code === "HERMES_TIMEOUT") {
      return { ok: false, error: "Hermes timed out." };
    }
  }

  return { ok: false, error: "Hermes failed to run." };
}

async function collectStdout(prompt: string): Promise<HermesResult<string>> {
  try {
    const stdout = await runHermesPrompt(prompt);
    return { ok: true, data: stdout };
  } catch (error) {
    return hermesError(error);
  }
}

function buildAnalyzePrompt(input: AnalyzeCommitmentInput) {
  const clock = currentTemporalContext();

  return `You are the commitment detection engine for OpsGuard.

Analyze the incoming business communication.

A commitment is a promise, requested deliverable, deadline,
follow-up, meeting obligation, or action that somebody expects
to happen.

Return ONLY valid JSON.

Determine:

1. Whether a commitment exists.
2. Who expects the work.
3. What must be delivered.
4. The deadline if present.
5. Risk score from 0 to 100.
6. Why the commitment may be at risk.
7. Required artifact.
8. Safest next action.

Do not execute anything.
Do not send anything.
Do not invent missing facts.

CURRENT DATE AND TIME:
${clock.utcIso}

DEFAULT TIMEZONE:
${clock.timezone}

CURRENT LOCAL DATETIME:
${clock.localIso} (${clock.weekday})

Interpret relative expressions such as today, tomorrow, Friday,
next Friday, and this afternoon relative to that timestamp.

Incoming message:

SOURCE:
${input.source}

SENDER:
${input.sender}

MESSAGE:
${input.text}

The returned JSON MUST match this exact schema:

{
  "is_commitment": boolean,
  "title": string,
  "person": string,
  "deadline": string | null,
  "risk_score": number,
  "risk_reason": string,
  "required_artifact": string,
  "suggested_action": string
}

Important:
- If there is no commitment, is_commitment must be false.
- If no deadline is explicitly stated or reliably inferable, deadline must be null.
- When a deadline can be reliably resolved, deadline MUST be an ISO 8601 datetime with offset.
- Example format: 2026-09-01T14:00:00+03:00
- Use ${clock.timezone}. 2 PM means 14:00 in that timezone, not UTC.
- Resolve imprecise times as: morning = 09:00, afternoon = 15:00, evening = 19:00 local time.
- Never return phrases such as "Friday morning", "tomorrow", or "tomorrow by 2 PM".
- Do not wrap JSON in markdown.
- Do not return explanatory text before or after JSON.`;
}

function buildRepairPrompt(schemaHint: string, previousOutput: string) {
  return [
    "Your previous reply was not valid JSON matching the required schema.",
    "Return STRICT JSON only. No markdown. No commentary. No code fences.",
    schemaHint,
    "Previous output:",
    previousOutput,
  ].join("\n");
}

export async function pingHermes(): Promise<HermesResult<{ ok: true }>> {
  const first = await collectStdout('Reply with STRICT JSON only, no markdown: {"ok": true}');
  if (!first.ok) return first;

  let parsed = parseJson(first.data);
  if (parsed === null) {
    const retry = await collectStdout(buildRepairPrompt('{"ok": true}', first.data));
    if (!retry.ok) return retry;
    parsed = parseJson(retry.data);
  }

  const checked = pingResultSchema.safeParse(parsed);
  if (!checked.success) {
    return { ok: false, error: "Hermes connectivity check returned invalid JSON." };
  }

  return { ok: true, data: checked.data };
}

export async function testRemoteHermes(): Promise<HermesResult<{ connected: true }>> {
  const first = await collectStdout('Return only this JSON:\n{"connected":true}');
  if (!first.ok) return first;

  const parsed = parseJson(first.data);
  const checked = connectedResultSchema.safeParse(parsed);
  if (!checked.success) {
    return { ok: false, error: "Hermes connectivity check returned invalid JSON." };
  }

  return { ok: true, data: checked.data };
}

export async function analyzeCommitment(
  input: AnalyzeCommitmentInput,
): Promise<HermesResult<AnalyzeCommitmentData>> {
  const parsedInput = analyzeCommitmentInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: "Invalid analyzeCommitment input." };
  }

  const first = await collectStdout(buildAnalyzePrompt(parsedInput.data));
  if (!first.ok) return first;

  let parsed = parseJson(first.data);

  if (parsed === null || !analyzeCommitmentResultSchema.safeParse(parsed).success) {
    const retry = await collectStdout(buildRepairPrompt(commitmentSchemaHint, first.data));
    if (!retry.ok) return retry;
    parsed = parseJson(retry.data);
  }

  if (parsed === null) {
    return { ok: false, error: "Hermes did not return valid JSON." };
  }

  const checked = analyzeCommitmentResultSchema.safeParse(parsed);
  if (!checked.success) {
    return { ok: false, error: "Hermes returned JSON that did not match the schema." };
  }

  return { ok: true, data: checked.data };
}

function buildPrepareArtifactPrompt(commitment: PrepareArtifactCommitment) {
  return `You are OpsGuard's execution agent.

A business commitment is at risk.

Your task is to PREPARE the missing deliverable only.

You are NOT authorized to:
- send messages
- send emails
- publish content
- delete anything
- purchase anything
- perform irreversible external actions

Prepare a professional draft artifact that moves the commitment toward completion.

Commitment:
Title: ${commitment.title}
Person: ${commitment.person}
Deadline: ${commitment.deadline ?? "none"}
Risk reason: ${commitment.risk_reason}

Return ONLY valid JSON:

{
  "artifact_name": "string",
  "artifact_type": "markdown",
  "content": "string",
  "summary": "string"
}

No markdown fences.
No extra text.`;
}

export async function prepareCommitmentArtifact(
  commitment: PrepareArtifactCommitment,
): Promise<HermesResult<PreparedArtifact>> {
  const first = await collectStdout(buildPrepareArtifactPrompt(commitment));
  if (!first.ok) return first;

  let parsed = parseJson(first.data);

  if (parsed === null || !preparedArtifactSchema.safeParse(parsed).success) {
    const retry = await collectStdout(
      buildRepairPrompt(preparedArtifactSchemaHint, first.data),
    );
    if (!retry.ok) return retry;
    parsed = parseJson(retry.data);
  }

  if (parsed === null) {
    return { ok: false, error: "Hermes did not return valid JSON." };
  }

  const checked = preparedArtifactSchema.safeParse(parsed);
  if (!checked.success) {
    return { ok: false, error: "Hermes returned JSON that did not match the schema." };
  }

  return { ok: true, data: checked.data };
}

function asOptionalId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function buildTelegramMessage(
  commitment: TelegramDeliveryInput["commitment"],
  artifact: TelegramDeliveryInput["artifact"],
) {
  const header = [
    "OpsGuard resolved a commitment.",
    "",
    "Commitment:",
    commitment.title,
    "",
    "Prepared for:",
    commitment.person,
    "",
    "Artifact:",
    artifact.name,
    "",
  ].join("\n");

  const budget = TELEGRAM_MESSAGE_LIMIT - header.length;
  const body =
    budget <= 0
      ? ""
      : artifact.content.length > budget
        ? `${artifact.content.slice(0, Math.max(0, budget - 14))}\n\n[truncated]`
        : artifact.content;

  return `${header}${body}`;
}

function telegramSendFailure(stdout: string, stderr: string, code: number | null) {
  const parsed = parseJson(stdout);
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const error = (parsed as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) {
      return error.trim().slice(0, 500);
    }
  }

  const detail = stderr.trim() || stdout.trim();
  if (detail) {
    return `Telegram delivery failed: ${detail.slice(0, 500)}`;
  }

  return `Telegram delivery failed (exit ${code ?? "unknown"}).`;
}

export async function executeTelegramDelivery(
  input: TelegramDeliveryInput,
): Promise<HermesResult<TelegramDeliveryData>> {
  const target = input.target.trim();
  if (!target) {
    return {
      ok: false,
      error: "Missing required environment variable: OPSGUARD_TELEGRAM_TARGET",
    };
  }
  if (!TELEGRAM_TARGET.test(target) || !SAFE_REMOTE_ARG.test(target)) {
    return {
      ok: false,
      error: "OPSGUARD_TELEGRAM_TARGET is not a valid Telegram destination.",
    };
  }

  const message = buildTelegramMessage(input.commitment, input.artifact);
  let result: CommandResult;
  try {
    if (getHermesTransport() === "local") {
      result = await runLocalHermesCommand(
        LOCAL_HERMES_BIN,
        ["send", "--to", target, "--file", "-", "--json"],
        message,
        HERMES_SEND_TIMEOUT_MS,
      );
    } else {
      const user = getSshConfig().user;
      const bin = getHermesRemoteBin(user);
      result = await runRemoteHermesCommand(
        [bin, "send", "--to", target, "--file", "-", "--json"],
        message,
        HERMES_SEND_TIMEOUT_MS,
      );
    }
  } catch (error) {
    return hermesError(error);
  }

  const parsed = parseJson(result.stdout);
  const payload =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  if (result.code !== 0 || !payload || payload.success !== true || payload.error) {
    return {
      ok: false,
      error: telegramSendFailure(result.stdout, result.stderr, result.code),
    };
  }

  const messageId = asOptionalId(payload.message_id);
  const chatId = asOptionalId(payload.chat_id);
  const platform = typeof payload.platform === "string" ? payload.platform : "telegram";
  const reference = messageId ?? `telegram:${input.commitment.id}:${input.artifact.id}`;

  return {
    ok: true,
    data: {
      reference,
      platform,
      messageId,
      chatId,
    },
  };
}
