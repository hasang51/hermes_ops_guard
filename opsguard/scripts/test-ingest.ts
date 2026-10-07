import {
  addCalendarDays,
  parseDeadline,
  zonedWallTime,
} from "../lib/deadline";

const BASE_URL = process.env.OPSGUARD_BASE_URL ?? "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 120_000;

type IngestResponse = {
  success?: boolean;
  commitmentDetected?: boolean;
  commitment?: {
    title?: string;
    person?: string;
    deadline?: string | null;
    risk_score?: number;
  };
  error?: string;
};

type DeadlineExpect = "none" | "parseable" | "tomorrow-14-istanbul" | "ignored";

const cases: {
  sender: string;
  text: string;
  expectDetected: boolean;
  expectDeadline: DeadlineExpect;
}[] = [
  {
    sender: "Alice",
    text: "Can you send the pricing proposal tomorrow by 2 PM?",
    expectDetected: true,
    expectDeadline: "tomorrow-14-istanbul",
  },
  {
    sender: "Bob",
    text: "Thanks, looks great.",
    expectDetected: false,
    expectDeadline: "ignored",
  },
  {
    sender: "David",
    text: "I'll call the supplier Friday morning.",
    expectDetected: true,
    expectDeadline: "parseable",
  },
  {
    sender: "Emma",
    text: "Please prepare the monthly performance report.",
    expectDetected: true,
    expectDeadline: "none",
  },
  {
    sender: "Chris",
    text: "Nice work!",
    expectDetected: false,
    expectDeadline: "ignored",
  },
];

function isTomorrowAt14Istanbul(value: string | null | undefined) {
  const date = parseDeadline(value ?? null);
  if (!date) return false;

  const nowParts = zonedWallTime(new Date());
  const tomorrow = addCalendarDays(
    {
      year: Number(nowParts.year),
      month: Number(nowParts.month),
      day: Number(nowParts.day),
    },
    1,
  );
  const actual = zonedWallTime(date);

  return (
    Number(actual.year) === tomorrow.year &&
    Number(actual.month) === tomorrow.month &&
    Number(actual.day) === tomorrow.day &&
    Number(actual.hour) === 14 &&
    Number(actual.minute) === 0
  );
}

function deadlinePasses(value: string | null | undefined, expect: DeadlineExpect) {
  if (expect === "ignored") return true;
  if (expect === "none") return value == null;
  if (expect === "parseable") return parseDeadline(value ?? null) !== null;
  return isTomorrowAt14Istanbul(value);
}

async function ingest(sender: string, text: string): Promise<IngestResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "dashboard", sender, text }),
      signal: controller.signal,
    });

    const body = (await response.json()) as IngestResponse;
    if (!response.ok) {
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let passed = 0;

  for (const test of cases) {
    const input = `${test.sender}: ${test.text}`;
    let detected = false;
    let title = "";
    let person = "";
    let deadline = "";
    let risk = "";
    let verdict = "FAIL";

    try {
      const result = await ingest(test.sender, test.text);
      detected = result.commitmentDetected === true;
      title = result.commitment?.title ?? "";
      person = result.commitment?.person ?? "";
      deadline =
        result.commitment?.deadline === undefined || result.commitment.deadline === null
          ? "null"
          : result.commitment.deadline;
      risk =
        result.commitment?.risk_score === undefined
          ? ""
          : String(result.commitment.risk_score);

      const storedDeadline = detected ? (result.commitment?.deadline ?? null) : null;

      if (!detected) {
        title = "";
        person = "";
        deadline = "";
        risk = "";
      }

      const detectionOk = detected === test.expectDetected;
      const deadlineOk = deadlinePasses(storedDeadline, test.expectDeadline);
      verdict = detectionOk && deadlineOk ? "PASS" : "FAIL";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      title = "";
      person = "";
      deadline = "";
      risk = message;
      verdict = "FAIL";
    }

    if (verdict === "PASS") passed += 1;

    console.log("INPUT");
    console.log(input);
    console.log(`DETECTED ${detected}`);
    console.log(`TITLE ${title}`);
    console.log(`PERSON ${person}`);
    console.log(`DEADLINE ${deadline}`);
    console.log(`RISK ${risk}`);
    console.log(verdict);
    console.log("");
  }

  console.log(`${passed}/${cases.length} passed`);
  if (passed !== cases.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
