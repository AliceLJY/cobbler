import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAuditReport } from "./audit-ci.mjs";

test("accepts only the exact unresolved upstream advisories", () => {
  const report = {
    vulnerabilities: {
      "image-size": {
        severity: "high",
        via: [
          {
            source: 1138808,
            severity: "high",
            url: "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
          },
          {
            source: 1138809,
            severity: "high",
            url: "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
          },
        ],
      },
      metro: { severity: "high", via: ["image-size"] },
    },
  };

  const result = evaluateAuditReport(report);
  assert.equal(result.blocking.length, 0);
  assert.deepEqual(
    result.accepted.map(({ name }) => name).sort(),
    ["image-size", "metro"],
  );
});

test("fails closed for a new high-severity advisory", () => {
  const report = {
    vulnerabilities: {
      dependency: {
        severity: "high",
        via: [
          {
            source: 9999999,
            severity: "high",
            url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
          },
        ],
      },
    },
  };

  const result = evaluateAuditReport(report);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.blocking.length, 1);
  assert.deepEqual(result.blocking[0].rejectedLeaves, ["GHSA-XXXX-YYYY-ZZZZ (high)"]);
});

test("fails closed when npm names a missing dependency record", () => {
  const report = {
    vulnerabilities: {
      wrapper: { severity: "critical", via: ["missing"] },
    },
  };

  const result = evaluateAuditReport(report);
  assert.equal(result.blocking.length, 1);
  assert.deepEqual(result.blocking[0].rejectedLeaves, ["dependency:missing (critical)"]);
});
