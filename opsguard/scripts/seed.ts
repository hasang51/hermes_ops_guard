import { getDb } from "../lib/db";

const COMMITMENT_ID = "cmt_acme_enterprise_proposal";

function isoMinutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function todayAt(hours: number, minutes: number) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString();
}

function seed() {
  const db = getDb();
  const now = new Date().toISOString();
  const deadline = todayAt(17, 0);

  db.transaction(() => {
    db.prepare("DELETE FROM evidence WHERE commitment_id = ?").run(COMMITMENT_ID);
    db.prepare("DELETE FROM approvals WHERE commitment_id = ?").run(COMMITMENT_ID);
    db.prepare("DELETE FROM artifacts WHERE commitment_id = ?").run(COMMITMENT_ID);
    db.prepare("DELETE FROM activities WHERE commitment_id = ?").run(COMMITMENT_ID);
    db.prepare("DELETE FROM commitments WHERE id = ?").run(COMMITMENT_ID);

    db.prepare(
      `INSERT INTO commitments (
         id, title, source, source_ref, person, deadline, status,
         risk_score, risk_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      COMMITMENT_ID,
      "Send Acme Corp enterprise proposal",
      "gmail",
      "msg_acme_proposal_thread",
      "Maya Chen, Acme Corp",
      deadline,
      "at_risk",
      86,
      "Legal has not cleared the 18% discount language",
      isoMinutesFromNow(-3 * 24 * 60),
      now,
    );

    const activities = [
      [
        "act_acme_analyze",
        "analyze",
        "Comparing discount options against Acme's procurement deadline",
        isoMinutesFromNow(-2),
      ],
      [
        "act_acme_document",
        "document",
        "Drafted Acme Enterprise Proposal v3 with revised commercial terms",
        isoMinutesFromNow(-12),
      ],
      [
        "act_acme_message",
        "message",
        "Messaged legal with a 2 PM response target on discount language",
        isoMinutesFromNow(-28),
      ],
      [
        "act_acme_deadline",
        "deadline",
        "Detected send-or-lose deadline in Maya Chen's email thread",
        isoMinutesFromNow(-51),
      ],
    ] as const;

    const insertActivity = db.prepare(
      `INSERT INTO activities (id, commitment_id, type, message, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [id, type, message, createdAt] of activities) {
      insertActivity.run(id, COMMITMENT_ID, type, message, createdAt);
    }

    db.prepare(
      `INSERT INTO artifacts (id, commitment_id, name, path, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "art_acme_proposal_v3",
      COMMITMENT_ID,
      "Acme Enterprise Proposal v3",
      "data/artifacts/acme-enterprise-proposal-v3.md",
      "document",
      isoMinutesFromNow(-12),
    );

    db.prepare(
      `INSERT INTO approvals (
         id, commitment_id, action, status, created_at, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "appr_acme_pricing_floor",
      COMMITMENT_ID,
      "Confirm internal pricing floor of 18%",
      "approved",
      isoMinutesFromNow(-90),
      isoMinutesFromNow(-46),
    );

    db.prepare(
      `INSERT INTO approvals (
         id, commitment_id, action, status, created_at, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "appr_acme_send_proposal",
      COMMITMENT_ID,
      "Approve sending the Acme proposal with 18% discount",
      "pending",
      isoMinutesFromNow(-11),
      null,
    );

    const evidence = [
      [
        "ev_acme_document",
        "document_created",
        "Acme Enterprise Proposal v3",
        "6 pages · data/artifacts/acme-enterprise-proposal-v3.md",
        isoMinutesFromNow(-12),
      ],
      [
        "ev_acme_message",
        "message_sent",
        "Legal follow-up on discount language",
        "Gmail · Maya Chen thread",
        isoMinutesFromNow(-28),
      ],
      [
        "ev_acme_deadline",
        "deadline_detected",
        "Proposal must leave today at 5:00 PM",
        "From Maya Chen · procurement window",
        isoMinutesFromNow(-51),
      ],
      [
        "ev_acme_approval",
        "approval_received",
        "Internal pricing floor of 18%",
        "From Finance · Alex",
        isoMinutesFromNow(-46),
      ],
    ] as const;

    const insertEvidence = db.prepare(
      `INSERT INTO evidence (id, commitment_id, type, description, reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const [id, type, description, reference, createdAt] of evidence) {
      insertEvidence.run(id, COMMITMENT_ID, type, description, reference, createdAt);
    }
  })();

  console.log("Seeded at-risk commitment: Send Acme Corp enterprise proposal");
}

seed();
