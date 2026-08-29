import type { CanonicalScanReportV1 } from "@agentready-lab/core";
import { canonicalizeJson } from "@agentready-lab/core";

import type { ReporterOutput } from "./output.js";
import { formatDiagnostics, reportDiagnostics } from "./output.js";

/**
 * The canonical JSON reporter. `docs/ARCHITECTURE.md` section 14.
 *
 * It is nearly all contract and almost no code, which is the point:
 *
 * - the bytes come from core's RFC 8785 canonicalizer, the same function that
 *   computes the ruleset digest. A second serializer here would be two
 *   implementations that must agree byte for byte and could only disagree;
 * - `stdout` is *exactly* the canonical form, with no trailing newline. A
 *   newline would make the piped bytes differ from `encodeCanonicalJson` of
 *   the same report, so a consumer that digests the stream and a consumer that
 *   digests the report would get different answers;
 * - nothing is re-sanitized. Core bounded and sanitized every
 *   target-influenced string as it entered the report, and JSON string
 *   escaping is the sink-correct escape for this sink. Re-bounding here would
 *   change the bytes and break the byte-identity above;
 * - nothing is added. `CanonicalScanReportV1` carries no wall-clock time, no
 *   duration and no random id (`docs/ARCHITECTURE.md` section 9), and this
 *   function has no second parameter through which any could be supplied, so
 *   the omission of volatile metadata is structural rather than a default.
 *   The `--include-metadata` envelope of section 9 does not exist in M1:
 *   core builds no `ReportEnvelopeV1`, and inventing one here would be a
 *   reporter asserting scan facts it did not observe.
 *
 * @throws {CanonicalJsonError} if the report contains a value RFC 8785 cannot
 * represent. That is a defect in whatever produced the report, and failing is
 * the only honest response: emitting a repaired document under the name
 * "canonical" would be worse than emitting nothing.
 */
export function renderJson(report: CanonicalScanReportV1): ReporterOutput {
  return {
    stdout: canonicalizeJson(report),
    stderr: formatDiagnostics(reportDiagnostics(report)),
  };
}
