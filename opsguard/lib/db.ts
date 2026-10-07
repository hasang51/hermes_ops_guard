import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DB_PATH =
  process.env.OPSGUARD_DB ?? path.join(process.cwd(), "data", "opsguard.db");

export type CommitmentRow = {
  id: string;
  title: string;
  source: string;
  source_ref: string | null;
  person: string;
  deadline: string | null;
  status: string;
  risk_score: number;
  risk_reason: string;
  created_at: string;
  updated_at: string;
};

export type ActivityRow = {
  id: string;
  commitment_id: string | null;
  type: string;
  message: string;
  created_at: string;
};

export type ArtifactRow = {
  id: string;
  commitment_id: string;
  name: string;
  path: string;
  type: string;
  created_at: string;
};

export type ApprovalRow = {
  id: string;
  commitment_id: string;
  action: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

export type EvidenceRow = {
  id: string;
  commitment_id: string;
  type: string;
  description: string;
  reference: string;
  created_at: string;
};

type PendingApprovalRow = ApprovalRow & {
  commitment_title: string;
  person: string;
  risk_score: number;
  risk_reason: string;
  deadline: string | null;
};

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE commitments (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        person TEXT NOT NULL,
        deadline TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_score INTEGER NOT NULL,
        risk_reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        commitment_id TEXT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        reference TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE activities_v2 (
        id TEXT PRIMARY KEY,
        commitment_id TEXT REFERENCES commitments(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO activities_v2 (id, commitment_id, type, message, created_at)
        SELECT id, commitment_id, type, message, created_at FROM activities;
      DROP TABLE activities;
      ALTER TABLE activities_v2 RENAME TO activities;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE commitments_v3 (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        source_ref TEXT,
        person TEXT NOT NULL,
        deadline TEXT,
        status TEXT NOT NULL,
        risk_score INTEGER NOT NULL,
        risk_reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO commitments_v3 (
        id, title, source, source_ref, person, deadline, status,
        risk_score, risk_reason, created_at, updated_at
      )
        SELECT
          id, title, source, source_ref, person, deadline, status,
          risk_score, risk_reason, created_at, updated_at
        FROM commitments;
      DROP TABLE commitments;
      ALTER TABLE commitments_v3 RENAME TO commitments;
    `,
  },
];

type GlobalDb = typeof globalThis & { __opsguardDb?: Database.Database };

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    if (migration.version === 2 || migration.version === 3) {
      db.pragma("foreign_keys = OFF");
    }

    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      ).run(migration.version, new Date().toISOString());
    })();

    if (migration.version === 2 || migration.version === 3) {
      db.pragma("foreign_keys = ON");
    }
  }
}

export function getCommitmentById(id: string) {
  return getDb()
    .prepare("SELECT * FROM commitments WHERE id = ?")
    .get(id) as CommitmentRow | undefined;
}

export function listArtifactsByCommitmentId(commitmentId: string) {
  return getDb()
    .prepare(
      `SELECT * FROM artifacts
       WHERE commitment_id = ?
       ORDER BY datetime(created_at) DESC`,
    )
    .all(commitmentId) as ArtifactRow[];
}

export function insertArtifact(input: {
  commitment_id: string;
  name: string;
  path: string;
  type: string;
}): ArtifactRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  db.prepare(
    `INSERT INTO artifacts (id, commitment_id, name, path, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.commitment_id, input.name, input.path, input.type, created_at);

  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow;
}

export function updateCommitmentStatus(id: string, status: string): CommitmentRow {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare("UPDATE commitments SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    now,
    id,
  );

  return db.prepare("SELECT * FROM commitments WHERE id = ?").get(id) as CommitmentRow;
}

export function insertActivity(input: {
  commitment_id?: string | null;
  type: string;
  message: string;
}) {
  const db = getDb();
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  db.prepare(
    `INSERT INTO activities (id, commitment_id, type, message, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.commitment_id ?? null, input.type, input.message, created_at);

  return { id, created_at };
}

export function insertEvidence(input: {
  commitment_id: string;
  type: string;
  description: string;
  reference: string;
}): EvidenceRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  db.prepare(
    `INSERT INTO evidence (id, commitment_id, type, description, reference, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.commitment_id,
    input.type,
    input.description,
    input.reference,
    created_at,
  );

  return db.prepare("SELECT * FROM evidence WHERE id = ?").get(id) as EvidenceRow;
}

export function resolvePendingApprovals(commitmentId: string) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE approvals
       SET status = 'approved', resolved_at = ?
       WHERE commitment_id = ? AND status = 'pending'`,
    )
    .run(now, commitmentId);
}

export function insertCommitment(input: {
  title: string;
  source: string;
  source_ref: string | null;
  person: string;
  deadline: string | null;
  status: string;
  risk_score: number;
  risk_reason: string;
}): CommitmentRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO commitments (
       id, title, source, source_ref, person, deadline, status,
       risk_score, risk_reason, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.source,
    input.source_ref,
    input.person,
    input.deadline,
    input.status,
    input.risk_score,
    input.risk_reason,
    now,
    now,
  );

  return db.prepare("SELECT * FROM commitments WHERE id = ?").get(id) as CommitmentRow;
}

export function getDb() {
  const globalForDb = globalThis as GlobalDb;
  if (!globalForDb.__opsguardDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    globalForDb.__opsguardDb = db;
  }

  migrate(globalForDb.__opsguardDb);
  return globalForDb.__opsguardDb;
}

export function loadDashboard() {
  const db = getDb();

  const commitments = db
    .prepare(
      `SELECT * FROM commitments
       ORDER BY risk_score DESC, datetime(deadline) ASC`,
    )
    .all() as CommitmentRow[];

  const pendingApprovals = db
    .prepare(
      `SELECT
         c.id,
         c.id AS commitment_id,
         c.title AS action,
         'pending' AS status,
         c.updated_at AS created_at,
         NULL AS resolved_at,
         c.title AS commitment_title,
         c.person,
         c.risk_score,
         c.risk_reason,
         c.deadline
       FROM commitments c
       WHERE c.status = 'needs_approval'
       ORDER BY datetime(c.deadline) ASC, c.risk_score DESC`,
    )
    .all() as PendingApprovalRow[];

  const activities = db
    .prepare(
      `SELECT * FROM activities
       ORDER BY datetime(created_at) DESC
       LIMIT 8`,
    )
    .all() as ActivityRow[];

  const evidence = db
    .prepare(
      `SELECT * FROM evidence
       ORDER BY datetime(created_at) DESC
       LIMIT 8`,
    )
    .all() as EvidenceRow[];

  const evidenceCount = (
    db.prepare("SELECT COUNT(*) AS count FROM evidence").get() as {
      count: number;
    }
  ).count;

  const resolvedCount = (
    db
      .prepare("SELECT COUNT(*) AS count FROM commitments WHERE status = 'resolved'")
      .get() as { count: number }
  ).count;

  const autonomousResolvedCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM commitments c
         WHERE c.status = 'resolved'
           AND NOT EXISTS (
             SELECT 1 FROM activities a
             WHERE a.commitment_id = c.id AND a.type = 'APPROVAL_GRANTED'
           )`,
      )
      .get() as { count: number }
  ).count;

  const artifacts = db
    .prepare(
      `SELECT * FROM artifacts
       ORDER BY datetime(created_at) DESC`,
    )
    .all() as ArtifactRow[];

  return {
    commitments,
    pendingApprovals,
    activities,
    evidence,
    evidenceCount,
    resolvedCount,
    autonomousResolvedCount,
    artifacts,
    now: Date.now(),
  };
}
