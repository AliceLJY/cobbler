import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SEVERITY = new Map([
  ["info", 0],
  ["low", 1],
  ["moderate", 2],
  ["high", 3],
  ["critical", 4],
]);

// Both high-severity image-size findings are currently unresolved upstream:
// npm reports image-size 2.0.2 as the latest release and the advisories affect
// every release through 2.0.2. Metro 0.84.4 requires image-size ^1.0.2.
// Keep the exception tied to exact advisory IDs so any new high/critical
// finding still fails CI. The uuid item is moderate, but appears as another
// leaf when npm expands the same Expo dependency graph.
//
// 2026-10-17: two more high findings published that npm cannot fix without
// downgrading Expo to SDK 44 (its only "fix" suggestion), because the affected
// ranges reach the latest releases:
//   GHSA-VFJ7-8CJW-P6XM braces <=3.0.3 (stack-exhaustion DoS); braces 3.0.3 is
//     the latest release, pulled in by metro / @expo/metro-file-map tooling.
//   GHSA-86W9-CPQP-85RV node-forge <=1.4.0 (RSA PKCS#1 v1.5 signature check);
//     node-forge 1.4.0 is the latest release, pulled in by @expo/cli and
//     @expo/code-signing-certificates.
// Both sit in the Expo build / dev-server toolchain, not in what the app ships.
// The same night `npm audit fix` (no --force) took the three findings that do
// have fixes: compression 1.8.2, shell-quote 1.12.0, source-map-js 1.2.2.
// Remove these two entries once braces / node-forge publish a fixed release.
export const ALLOWED_ADVISORIES = new Map([
  ["GHSA-W3RX-R6R6-PGPR", "high"],
  ["GHSA-5P2G-FCMC-QVQQ", "high"],
  ["GHSA-W5HQ-G745-H8PQ", "moderate"],
  ["GHSA-VFJ7-8CJW-P6XM", "high"],
  ["GHSA-86W9-CPQP-85RV", "high"],
]);

function advisoryId(via) {
  const match = typeof via.url === "string" ? via.url.match(/GHSA-[\w-]+$/i) : null;
  return match?.[0]?.toUpperCase() ?? `source:${String(via.source ?? "unknown")}`;
}

function collectLeafAdvisories(name, vulnerabilities, visiting = new Set()) {
  if (visiting.has(name)) return new Map();
  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !Array.isArray(vulnerability.via)) {
    return new Map([[`dependency:${name}`, "critical"]]);
  }

  const nextVisiting = new Set(visiting).add(name);
  const leaves = new Map();
  for (const via of vulnerability.via) {
    const nested =
      typeof via === "string"
        ? collectLeafAdvisories(via, vulnerabilities, nextVisiting)
        : new Map([[advisoryId(via), via.severity ?? vulnerability.severity ?? "critical"]]);
    for (const [id, severity] of nested) {
      const current = leaves.get(id);
      if (!current || (SEVERITY.get(severity) ?? 4) > (SEVERITY.get(current) ?? 4)) {
        leaves.set(id, severity);
      }
    }
  }
  return leaves;
}

export function evaluateAuditReport(report) {
  if (!report || typeof report !== "object" || typeof report.vulnerabilities !== "object") {
    throw new Error("npm audit returned an unsupported JSON report");
  }

  const blocking = [];
  const accepted = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if ((SEVERITY.get(vulnerability.severity) ?? 4) < SEVERITY.get("high")) continue;

    const leaves = collectLeafAdvisories(name, report.vulnerabilities);
    const rejectedLeaves = [];
    if (leaves.size === 0) rejectedLeaves.push("unresolved dependency cycle");
    for (const [id, severity] of leaves) {
      const allowedSeverity = ALLOWED_ADVISORIES.get(id);
      if (!allowedSeverity || (SEVERITY.get(severity) ?? 4) > SEVERITY.get(allowedSeverity)) {
        rejectedLeaves.push(`${id} (${severity})`);
      }
    }

    const result = { name, severity: vulnerability.severity, leaves: [...leaves.keys()] };
    if (rejectedLeaves.length > 0) blocking.push({ ...result, rejectedLeaves });
    else accepted.push(result);
  }
  return { accepted, blocking };
}

export function runAudit() {
  const audit = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (audit.error) throw audit.error;

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch (error) {
    throw new Error(`could not parse npm audit JSON: ${error.message}`);
  }
  if (report.error) throw new Error(`npm audit failed: ${report.error.summary ?? "unknown error"}`);

  const result = evaluateAuditReport(report);
  if (result.blocking.length > 0) {
    console.error("Unapproved high/critical dependency findings:");
    for (const finding of result.blocking) {
      console.error(`- ${finding.name} (${finding.severity}): ${finding.rejectedLeaves.join(", ")}`);
    }
    return 1;
  }

  const allowedIds = [...new Set(result.accepted.flatMap((finding) => finding.leaves))].sort();
  if (allowedIds.length > 0) {
    console.log(`Known upstream findings accepted: ${allowedIds.join(", ")}`);
  } else {
    console.log("No high/critical dependency findings.");
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runAudit();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
