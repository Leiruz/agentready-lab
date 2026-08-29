import path from "node:path";

import type {
  AnyRuleDefinition,
  CanonicalScanReportV1,
  ScanInput,
  SelectedRule,
  TargetDescriptor,
} from "@agentready-lab/core";
import {
  resolveSelectors,
  runScan,
  selectRules,
  transportCapabilities,
} from "@agentready-lab/core";
import { renderHuman, renderJson } from "@agentready-lab/reporters";
import type { CanonicalTarget } from "@agentready-lab/transport-node";
import {
  applyUrlPolicy,
  classifyAddress,
  createNetworkPolicy,
} from "@agentready-lab/transport-node";

import type { CheckFlags } from "../args.js";
import { loadConfig } from "../config/load.js";
import type { EffectiveSettings } from "../config/settings.js";
import { resolveSettings } from "../config/settings.js";
import type { SourceMap } from "../config/source-map.js";
import {
  assertRepositoryPath,
  validateSourceMap,
} from "../config/source-map.js";
import type { CliEnvironment, PinnedArtifacts } from "../environment.js";
import { configurationError } from "../errors.js";
import type { ExitCode } from "../exit-codes.js";
import { EXIT } from "../exit-codes.js";
import type { CommandResult } from "../result.js";
import { CLI_PACKAGE_VERSION } from "../version.js";

/**
 * `check`, in the order `docs/ARCHITECTURE.md` section 5 fixes.
 *
 * "Everything that can be decided from configuration is decided before the
 * transport is touched at all." Core says that about itself; this function is
 * where it becomes true of the process, because core cannot decide what it is
 * never called with. The sequence below is therefore the contract and not a
 * convenience, and it is worth reading as one:
 *
 *  1. the configuration file, parsed and validated;
 *  2. the source map, every path refused before anything reads a file;
 *  3. precedence, producing one settled set of values;
 *  4. `ci-public`, refused here, above the transport package entirely;
 *  5. the pinned ruleset version the caller asked for;
 *  6. selector grammar, resolved against the registry alone;
 *  7. the network policy, and the URL that has to satisfy it;
 *  8. the transport, constructed only now, from a policy object;
 *  9. selection, which is where core's own configuration refusals live;
 * 10. whether the selected rules and the pinned artifacts exist at all;
 * 11. the scan.
 *
 * Steps 1 to 6 do not enter `packages/transport-node` and steps 1 to 7 do not
 * construct a transport, which is what makes "an invalid configuration issues
 * no request" a property of this ordering rather than a review note.
 */

/**
 * `--source-map` names a JSON object mapping a request path to a repository
 * file. The argument itself takes the same rules as the paths inside it: the
 * setting is defined as repository-relative, so an absolute or escaping value
 * is refused here rather than read and then reported as relative.
 */
function readFlagSourceMap(
  environment: CliEnvironment,
  flagPath: string | undefined,
): SourceMap | undefined {
  if (flagPath === undefined) return undefined;
  assertRepositoryPath("--source-map", flagPath);

  const absolute = path.join(environment.cwd, flagPath);
  const read = environment.readTextFile(absolute);
  if (read.kind === "absent") {
    throw configurationError(
      `--source-map names ${JSON.stringify(flagPath)}, which does not exist.`,
    );
  }
  if (read.kind === "unreadable") {
    throw configurationError(
      `--source-map names ${JSON.stringify(flagPath)}, which could not be read.`,
      read.detail,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch (thrown) {
    throw configurationError(
      `--source-map names ${JSON.stringify(flagPath)}, which is not valid JSON.`,
      thrown instanceof Error ? thrown.message : String(thrown),
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw configurationError(
      `--source-map names ${JSON.stringify(flagPath)}, which is not a JSON object.`,
      'Each entry maps a request path to a repository path, as in {"/robots.txt": "public/robots.txt"}.',
    );
  }
  return validateSourceMap({ ...parsed });
}

/**
 * ADR-0004 section 6 and the `docs/ROADMAP.md` M1 criterion: "The `ci-public`
 * profile exits as an unsupported/configuration condition and makes no public
 * connection."
 *
 * Refused here, before `createNetworkPolicy` is called and before a transport
 * exists, so the guarantee does not depend on the transport package refusing
 * it correctly. That package's own defence is stronger than an early return -
 * `LocalLoopbackPolicy` is the only policy type it can construct, so no value
 * carrying `"ci-public"` can reach a connector - and this check is not a
 * substitute for it. It is the half that keeps the profile from reaching the
 * package at all, so a future connector added there is out of range of a
 * `ci-public` invocation whatever it does.
 */
function refuseUnsupportedNetworkProfile(settings: EffectiveSettings): void {
  if (settings.networkProfile !== "ci-public") return;
  throw configurationError(
    "--network-profile ci-public is not implemented in this build.",
    "docs/ROADMAP.md M3 owns it. Nothing in this build can reach a public destination: packages/transport-node can construct only a local-loopback policy object, and this refusal happens before that package is called at all.",
    "Scan a loopback preview instead, with --network-profile local-loopback (the default).",
  );
}

/**
 * The pinned ruleset version this build carries, and a refusal if the registry
 * disagrees with itself.
 *
 * Read from the registry rather than from the pinned artifacts because it is
 * needed at step 5, before the artifacts are consulted, and because a registry
 * whose rules cite two ruleset versions is a defect worth naming on its own.
 */
function pinnedRulesetVersion(
  registry: readonly AnyRuleDefinition[],
): string | undefined {
  const versions = new Set(
    registry.map(
      (rule) => `${rule.metadata.ruleset.id} ${rule.metadata.ruleset.version}`,
    ),
  );
  if (versions.size > 1) {
    throw configurationError(
      "the pinned registry declares more than one ruleset version.",
      `Declared: ${[...versions].sort().join("; ")}.`,
      "A scan cites one ruleset id and version, so this build cannot produce a report at all.",
    );
  }
  const [only] = registry;
  return only?.metadata.ruleset.version;
}

function checkRequestedRuleset(
  requested: string | undefined,
  registry: readonly AnyRuleDefinition[],
): void {
  const pinned = pinnedRulesetVersion(registry);
  if (requested === undefined || pinned === undefined) return;
  if (requested === pinned) return;
  throw configurationError(
    `--ruleset ${JSON.stringify(requested)} is not the ruleset this build pins.`,
    `This build carries ${JSON.stringify(pinned)}. A ruleset is not downloadable and not selectable at run time: it is compiled in, so a request for a different one cannot be served.`,
  );
}

/**
 * The `local-loopback` refusal, explained.
 *
 * `LocalLoopbackPolicy.forTarget` accepts only a loopback IP literal, and that
 * narrowing is correct: resolving a name would put the hosts file, NSS and a
 * DNS answer inside the loopback trust boundary, which
 * `docs/THREAT_MODEL.md` section 12.2 requires to be explicit rather than
 * inherited. What it is not is self-explanatory, and `http://localhost:3000`
 * is what a developer running a preview server actually types. So the refusal
 * says what happened, why, and the exact command that works.
 */
function explainPolicyRejection(target: CanonicalTarget): never {
  const classified = classifyAddress(target.hostname);
  const portSuffix = target.hostHeader.slice(target.hostname.length);

  if (classified.kind === "address") {
    throw configurationError(
      `${target.origin} is not a loopback address.`,
      `Its address class is '${classified.addressClass}'. The local-loopback profile scans only 127.0.0.0/8 and [::1], so a preview server on another interface is out of range for this build.`,
      "docs/ROADMAP.md M3 owns scanning anything else.",
    );
  }

  const suggestion = `${target.protocol}//127.0.0.1${portSuffix}${target.requestPath}`;
  const isLocalhost = target.hostname === "localhost";
  throw configurationError(
    `${JSON.stringify(target.hostname)} is a host name, and the local-loopback profile accepts only an IP literal.`,
    isLocalhost
      ? "'localhost' is a name that has to be resolved, and resolving it would put your hosts file, NSS and a DNS answer inside the trust boundary of a profile whose entire guarantee is that the scan cannot leave your machine. M1 ships the profile whose destination needs no resolution at all, so the name is refused rather than looked up (docs/THREAT_MODEL.md section 12.2)."
      : "Resolving it would put your hosts file, NSS and a DNS answer inside the trust boundary of a profile whose guarantee is that the scan cannot leave your machine (docs/THREAT_MODEL.md section 12.2).",
    "",
    "Run this instead:",
    `  agentready-lab check ${suggestion}`,
    "",
    "Use [::1] in place of 127.0.0.1 if your server listens on IPv6 only.",
  );
}

function explainUrlRejection(url: string, code: string): never {
  const detail: Readonly<Record<string, string>> = {
    "prohibited-scheme":
      "Only http and https are accepted. A file, data or javascript URL is not a target.",
    "credentials-in-url":
      "The URL carries user information. Credentials are never forwarded to a target, so a URL that contains them is refused rather than stripped and sent.",
    "unsafe-port": "The port is outside 1 to 65535.",
    "invalid-url":
      "It did not parse as an absolute URL, or it exceeded the 2,048-byte limit, or it contains a raw control character.",
  };
  // The one refusal that does not quote its input. `docs/THREAT_MODEL.md`
  // section 20.2 keeps credentials out of reports and logs, and a message
  // saying "http://user:hunter2@... is not usable" would put a password into
  // a CI log at the exact moment the tool was congratulating itself for not
  // sending it. Sanitizing does not help: the value is well formed text.
  const subject =
    code === "credentials-in-url" ? "the target URL" : JSON.stringify(url);
  throw configurationError(
    `${subject} is not a usable target URL (${code}).`,
    detail[code] ?? "The URL policy refused it.",
  );
}

/**
 * ADR-0004 section 6 makes `--include` naming a `planned` rule exit 2, and
 * `selectRules` enforces exactly that. It says nothing about a `planned` rule
 * the *profile* selects, because until the rules exist there was no case to
 * decide.
 *
 * There is now, and every one of the eight M1 rules is in it. A `planned`
 * rule's `plan()` throws, so letting the scan start would produce exit 4 and a
 * message about an internal invariant, which is a false statement: nothing is
 * broken, the rule is simply not written yet. Dropping the rule instead would
 * be worse - a scan that quietly ran five of six selected rules and reported a
 * clean result.
 *
 * So the run is refused, before a request, naming the rules. The check is on
 * `resolution === "invoke"` and not on selection, because a rule core has
 * already resolved to `unsupported-runtime` or `commerce-endpoint-absent`
 * never reaches `plan()` and is reported honestly as it is. The refusal
 * disappears on its own as each rule's `implementationStatus` moves off
 * `planned`; nothing has to remember to delete it.
 */
function refuseUnimplementedSelection(selected: readonly SelectedRule[]): void {
  const planned = selected
    .filter(
      (entry) =>
        entry.resolution === "invoke" &&
        entry.rule.metadata.implementationStatus === "planned",
    )
    .map((entry) => entry.rule.metadata.id);
  if (planned.length === 0) return;
  throw configurationError(
    `${String(planned.length)} of the selected rules are declared and not implemented.`,
    `Planned: ${planned.join(", ")}.`,
    "A planned rule has metadata and no behaviour, so a scan that included one would report a verdict nothing computed. Run 'agentready-lab rules list' to see which rules this build implements.",
  );
}

function requireArtifacts(
  artifacts: PinnedArtifacts | undefined,
): PinnedArtifacts {
  if (artifacts !== undefined) return artifacts;
  throw configurationError(
    "this build carries no pinned message templates or remediation table, so no report can cite anything.",
    "Every finding is rendered from a pinned template and, when it fails or warns, a pinned remediation entry (ADR-0007 sections 1 and 3). nodeEnvironment supplies both from packages/rules-standard's generated projection of specs/, so a build reaching this refusal was composed without them.",
    "The CLI does not synthesise them from rule metadata: the engine validates a rule's own assertion copy against the pinned ruleset, and a pinned ruleset built out of that same metadata would make the check compare a rule with itself.",
  );
}

/**
 * ADR-0004 section 4: "The exit code considers only results with
 * `gate: "enforced"`."
 *
 * `unsupported-runtime` is not promoted by `--strict-unable`, and the two
 * statuses are worth separating. `unable-to-check` says this scan tried and
 * could not reach a verdict, which is the thing a strict CI wants to fail on.
 * `unsupported-runtime` says the composed transport cannot serve that kind of
 * observation at all, which is a fact about the build and does not become
 * truer or falser on the next run. Promoting it would make `--strict-unable`
 * fail every scan on this build for as long as it ships one runtime.
 */
export function exitCodeFor(
  report: CanonicalScanReportV1,
  settings: Pick<EffectiveSettings, "strictWarnings" | "strictUnable">,
): ExitCode {
  let promoted = false;
  for (const result of report.results) {
    if (result.gate !== "enforced") continue;
    if (result.status === "fail") return EXIT.findings;
    if (settings.strictWarnings && result.status === "warning") promoted = true;
    if (settings.strictUnable && result.status === "unable-to-check") {
      promoted = true;
    }
  }
  return promoted ? EXIT.findings : EXIT.ok;
}

export async function check(input: {
  readonly environment: CliEnvironment;
  readonly url: string;
  readonly flags: CheckFlags;
}): Promise<CommandResult> {
  const { environment, flags } = input;

  // 1 to 3. Configuration, source map, precedence.
  const file = loadConfig(environment.cwd, environment.readTextFile);
  const settings = resolveSettings({
    flags,
    file,
    flagSourceMap: readFlagSourceMap(environment, flags.sourceMap),
    env: environment.env,
  });

  // 4 and 5. Refusals that need nothing but the settings and the registry.
  refuseUnsupportedNetworkProfile(settings);
  checkRequestedRuleset(settings.ruleset, environment.registry);

  // 6. Selector grammar, against the registry alone. `selectRules` resolves
  // these again from inside `runScan`; doing it here as well is what moves an
  // unknown selector above the transport, and `resolveSelectors` is pure, so
  // the two calls cannot disagree.
  if (settings.include !== undefined) {
    resolveSelectors(settings.include, environment.registry);
  }
  if (settings.exclude !== undefined) {
    resolveSelectors(settings.exclude, environment.registry);
  }

  // 7. The URL, then the policy. The URL policy runs first so that a scheme or
  // credential refusal is reported as itself, and so that the loopback
  // refusal below has a parsed target to explain with.
  const parsed = applyUrlPolicy(input.url);
  if (parsed.kind === "rejected") {
    explainUrlRejection(input.url, parsed.reason.code);
  }
  const target = parsed.target;

  // The settled profile, not a literal. `refuseUnsupportedNetworkProfile`
  // above has already stopped anything but `local-loopback`, so this call is
  // only ever made with that value today. Passing the settled value anyway is
  // what makes the transport package's own refusal the second line of defence
  // rather than dead code: delete the check above and `ci-public` arrives here
  // and is refused again, by the package that owns the connectors. Hard-coding
  // the literal would instead have turned a deleted check into a `ci-public`
  // run that silently scanned as `local-loopback`.
  const policyResult = createNetworkPolicy(settings.networkProfile, input.url);
  if (policyResult.kind === "rejected") explainPolicyRejection(target);
  if (policyResult.kind === "unsupported-profile") {
    throw configurationError(
      `the ${policyResult.profile} network profile is not available.`,
      policyResult.detail,
    );
  }
  const policy = policyResult.policy;

  // 8. The transport. A policy object is the only thing that can produce one.
  const transport = environment.createTransport(policy);

  // 9. Selection, which raises core's own configuration refusals: an unknown
  // selector, `--profile commerce`, a duplicated rule id, and `--include`
  // naming a planned rule. Still no request has been issued.
  const selected = selectRules({
    registry: environment.registry,
    profile: settings.profile,
    ...(settings.include === undefined ? {} : { include: settings.include }),
    ...(settings.exclude === undefined ? {} : { exclude: settings.exclude }),
    availableRuntimes: transportCapabilities(transport),
    // ADR-0004 section 2: no M1 rule is `commerce-endpoint-required`, and no
    // configuration key supplies an endpoint, so there is nothing this could
    // read that would make it true.
    commerceEndpointConfigured: false,
  });

  // 10. Whether there is anything to run, and anything to cite.
  refuseUnimplementedSelection(selected);
  const artifacts = requireArtifacts(environment.pinnedArtifacts);

  const descriptor: TargetDescriptor = {
    requestedUrl: input.url,
    pageUrl: target.href,
    origin: policy.origin,
    scope: "local",
    networkProfile: policy.id,
  };

  const scan: ScanInput = {
    toolVersion: CLI_PACKAGE_VERSION,
    registry: environment.registry,
    ruleset: artifacts.ruleset,
    rulesetAssertions: artifacts.assertions,
    sourceLedgerVersion: artifacts.sourceLedgerVersion,
    sourceLedger: artifacts.sourceLedger,
    ...(artifacts.externalSnapshot === undefined
      ? {}
      : { externalSnapshot: artifacts.externalSnapshot }),
    templates: artifacts.templates,
    remediation: artifacts.remediation,
    profile: {
      id: settings.profile,
      version: artifacts.profileVersions[settings.profile],
    },
    mode: settings.mode,
    target: descriptor,
    networkPolicy: policy.toIdentity(),
    budget: settings.budget,
    transport,
    ...(settings.include === undefined ? {} : { include: settings.include }),
    ...(settings.exclude === undefined ? {} : { exclude: settings.exclude }),
    ...(settings.ruleOptions === undefined
      ? {}
      : { ruleOptions: settings.ruleOptions }),
  };

  // 11. The scan.
  const report = await runScan(scan);
  const rendered =
    settings.format === "json"
      ? renderJson(report)
      : renderHuman(report, { color: settings.color });

  return {
    exitCode: exitCodeFor(report, settings),
    stdout: rendered.stdout,
    stderr: rendered.stderr,
  };
}
