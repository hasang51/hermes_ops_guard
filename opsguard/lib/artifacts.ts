import fs from "node:fs";
import path from "node:path";

const ARTIFACTS_DIR = path.resolve(process.cwd(), "workspace", "artifacts");

function isInsideArtifactsDir(resolvedPath: string) {
  const relative = path.relative(ARTIFACTS_DIR, resolvedPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sanitizeCommitmentId(commitmentId: string) {
  const sanitized = commitmentId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!sanitized) {
    throw new Error("Invalid commitment id.");
  }
  return sanitized;
}

export function sanitizeArtifactName(name: string) {
  const sanitized = name
    .replace(/\.md$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return sanitized || "artifact";
}

export function saveArtifactMarkdown(
  commitmentId: string,
  artifactName: string,
  content: string,
) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const filename = `${sanitizeCommitmentId(commitmentId)}-${sanitizeArtifactName(artifactName)}.md`;
  const absPath = path.resolve(ARTIFACTS_DIR, filename);

  if (!isInsideArtifactsDir(absPath)) {
    throw new Error("Unsafe artifact path.");
  }

  fs.writeFileSync(absPath, content, "utf8");
  return path.posix.join("workspace", "artifacts", filename);
}

export function readArtifactMarkdown(relativePath: string) {
  const filename = path.basename(relativePath);
  if (!filename || filename === "." || filename === "..") return null;

  const absPath = path.resolve(ARTIFACTS_DIR, filename);
  if (!isInsideArtifactsDir(absPath)) return null;
  if (!fs.existsSync(absPath)) return null;
  return fs.readFileSync(absPath, "utf8");
}
