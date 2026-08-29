import path from "node:path";

import type {
  InterpretationMode,
  NetworkBudget,
  ProfileId,
} from "@agentready-lab/core";

import type { NetworkProfileFlag } from "../args.js";
import { configurationError } from "../errors.js";
import type { FileRead } from "../environment.js";
import type { SourceMap } from "./source-map.js";
import { validateSourceMap } from "./source-map.js";

/**
 * `docs/ARCHITECTURE.md` section 10. Non-executable JSON, and nothing else.
 *
 * "Executable JavaScript/TypeScript configuration is prohibited in the MVP",
 * which is why this module reads text and calls `JSON.parse` rather than
 * importing anything. There is no cosmiconfig-style search either: exactly one
 * file name in exactly one directory, so "which configuration did this run
 * use" has one answer.
 *
 * Every value is validated here, before the caller has a transport, a policy
 * or a URL. `ARCHITECTURE.md` section 10: "Configuration validation occurs
 * before network access." That ordering is the whole reason this returns a
 * validated structure instead of the parsed object: a caller holding a
 * `FileConfig` is holding something that has already been refused if it was
 * going to be.
 */

export const CONFIG_FILE_NAME = "agentready.config.json";

export interface FileConfig {
  readonly profile: ProfileId | undefined;
  readonly mode: InterpretationMode | undefined;
  readonly ruleset: string | undefined;
  /** ADR-0004 section 6 selectors. `undefined` is "the key was absent". */
  readonly enable: readonly string[] | undefined;
  readonly disable: readonly string[] | undefined;
  readonly ruleOptions:
    Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  readonly networkProfile: NetworkProfileFlag | undefined;
  /**
   * Only the keys the file set. ADR-0004 section 9 makes every one of these a
   * ceiling that may be lowered and never raised, so the caller takes a
   * field-wise minimum rather than an override, and a key the file omitted has
   * to stay omitted for that to work.
   */
  readonly budget: Partial<NetworkBudget>;
  readonly sourceMap: SourceMap | undefined;
}

const EMPTY: FileConfig = {
  profile: undefined,
  mode: undefined,
  ruleset: undefined,
  enable: undefined,
  disable: undefined,
  ruleOptions: undefined,
  networkProfile: undefined,
  budget: {},
  sourceMap: undefined,
};

const MODES: readonly InterpretationMode[] = ["spec", "compat", "interop"];
const PROFILES: readonly ProfileId[] = [
  "content",
  "api",
  "agent-service",
  "commerce",
  "full",
];
const NETWORK_PROFILES: readonly NetworkProfileFlag[] = [
  "local-loopback",
  "ci-public",
];

/** Every `NetworkBudget` key the file may lower, minus `maxConcurrency`. */
const BUDGET_KEYS = [
  "maxRequests",
  "maxRedirects",
  "dnsTimeoutMs",
  "connectTimeoutMs",
  "perRequestTimeoutMs",
  "maxEncodedResponseBytes",
  "maxDecodedResponseBytes",
  "maxTotalEncodedBytes",
  "maxTotalDecodedBytes",
] as const satisfies readonly (keyof NetworkBudget)[];

function asObject(
  where: string,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw configurationError(`${where} must be a JSON object.`);
  }
  return { ...value };
}

function asString(where: string, value: unknown): string {
  if (typeof value !== "string") {
    throw configurationError(`${where} must be a string.`);
  }
  return value;
}

function asStringArray(where: string, value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw configurationError(`${where} must be an array of selectors.`);
  }
  return value.map((element, index) =>
    asString(`${where}[${String(index)}]`, element),
  );
}

function asPositiveInteger(where: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw configurationError(
      `${where} must be a positive integer.`,
      "Every network setting is a budget, and a budget of zero or less is not a smaller scan, it is an unrunnable one.",
    );
  }
  return value;
}

function oneOf<T extends string>(
  where: string,
  value: unknown,
  allowed: readonly T[],
): T {
  const text = asString(where, value);
  const found = allowed.find((candidate) => candidate === text);
  if (found === undefined) {
    throw configurationError(
      `${where} does not accept ${JSON.stringify(text)}.`,
      `Accepted values: ${allowed.join(", ")}.`,
    );
  }
  return found;
}

/**
 * Unknown keys are refused, which is what makes a typo a failed build rather
 * than a setting that silently did nothing.
 *
 * It is also what handles `"__proto__"`: `JSON.parse` gives it as an ordinary
 * own property, `Object.keys` lists it, and it is not in any allow-list, so it
 * lands here rather than needing a rule of its own.
 */
function expectKeys(
  where: string,
  object: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(object)) {
    if (allowed.includes(key)) continue;
    throw configurationError(
      `${where} has an unknown key ${JSON.stringify(key)}.`,
      `Known keys: ${allowed.join(", ")}.`,
    );
  }
}

function readRules(
  value: unknown,
): Pick<FileConfig, "enable" | "disable" | "ruleOptions"> {
  const rules = asObject("rules", value);
  if ("severity" in rules) {
    throw configurationError(
      "rules.severity was removed from the configuration schema.",
      "ADR-0004 section 7: a set of per-rule weights is the aggregate score ADR-0001 forbids, and it would let configuration promote a recommended requirement to fail against the class the registry records.",
      "Use --strict-warnings or --strict-unable instead.",
    );
  }
  expectKeys("rules", rules, ["enable", "disable", "options"]);

  const options = rules["options"];
  return {
    enable:
      rules["enable"] === undefined
        ? undefined
        : asStringArray("rules.enable", rules["enable"]),
    disable:
      rules["disable"] === undefined
        ? undefined
        : asStringArray("rules.disable", rules["disable"]),
    ruleOptions:
      options === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(asObject("rules.options", options)).map(
              ([ruleId, ruleOptions]) => [
                ruleId,
                asObject(
                  `rules.options[${JSON.stringify(ruleId)}]`,
                  ruleOptions,
                ),
              ],
            ),
          ),
  };
}

function readNetwork(
  value: unknown,
): Pick<FileConfig, "networkProfile" | "budget"> {
  const network = asObject("network", value);
  if ("totalTimeoutMs" in network) {
    throw configurationError(
      "network.totalTimeoutMs is not implemented and is refused rather than ignored.",
      "docs/ARCHITECTURE.md section 10 shows the key, and no whole-scan deadline exists in this build: the engine has no abort path, so a value here would change nothing.",
      "Lower network.perRequestTimeoutMs or network.maxRequests instead.",
    );
  }
  expectKeys("network", network, ["profile", "maxConcurrency", ...BUDGET_KEYS]);

  const concurrency = network["maxConcurrency"];
  if (concurrency !== undefined) {
    // ADR-0005 section 1: refused, never clamped. It is checked here, on the
    // value the file asked for, because the caller reduces every budget to a
    // field-wise minimum before the engine sees it, and a minimum would turn
    // `2` into `1` in silence, which is the behaviour that decision rejects.
    const requested = asPositiveInteger("network.maxConcurrency", concurrency);
    if (requested !== 1) {
      throw configurationError(
        `network.maxConcurrency is ${String(requested)}.`,
        "ADR-0005 section 1 pins it at 1 for M1 and refuses a higher value rather than clamping it, because a user who configured concurrency and did not get it should be told. Serial execution is what makes every shared byte budget deterministic.",
      );
    }
  }

  // `Partial<NetworkBudget>` keeps the `readonly` modifiers, so the
  // accumulator drops them and the return type puts them back.
  const budget: { -readonly [K in keyof NetworkBudget]?: NetworkBudget[K] } =
    {};
  for (const key of BUDGET_KEYS) {
    const raw = network[key];
    if (raw === undefined) continue;
    budget[key] = asPositiveInteger(`network.${key}`, raw);
  }

  return {
    networkProfile:
      network["profile"] === undefined
        ? undefined
        : oneOf("network.profile", network["profile"], NETWORK_PROFILES),
    budget,
  };
}

function readReport(value: unknown): SourceMap | undefined {
  const report = asObject("report", value);
  expectKeys("report", report, ["sourceMap"]);
  const sourceMap = report["sourceMap"];
  if (sourceMap === undefined) return undefined;
  return validateSourceMap(asObject("report.sourceMap", sourceMap));
}

/** Parses and validates the file's text. Exported for direct testing. */
export function parseConfig(text: string, where: string): FileConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (thrown) {
    throw configurationError(
      `${where} is not valid JSON.`,
      thrown instanceof Error ? thrown.message : String(thrown),
    );
  }

  const root = asObject(where, parsed);
  expectKeys(where, root, [
    "$schema",
    "profile",
    "mode",
    "ruleset",
    "rules",
    "network",
    "report",
  ]);

  const profile = root["profile"];
  if (typeof profile === "string" && profile.includes("@")) {
    throw configurationError(
      `${where}: profile must be a bare profile id, not ${JSON.stringify(profile)}.`,
      "docs/ARCHITECTURE.md section 10 shows the versioned form 'content@0.1.0'. No accepted decision pins a profile version and no artifact in this build carries one, so the versioned form is refused rather than parsed into a version this tool would have invented.",
    );
  }

  return {
    ...EMPTY,
    profile:
      profile === undefined ? undefined : oneOf("profile", profile, PROFILES),
    mode:
      root["mode"] === undefined
        ? undefined
        : oneOf("mode", root["mode"], MODES),
    ruleset:
      root["ruleset"] === undefined
        ? undefined
        : asString("ruleset", root["ruleset"]),
    ...(root["rules"] === undefined ? {} : readRules(root["rules"])),
    ...(root["network"] === undefined ? {} : readNetwork(root["network"])),
    sourceMap:
      root["report"] === undefined ? undefined : readReport(root["report"]),
  };
}

/**
 * Loads `agentready.config.json` from the working directory, if it is there.
 *
 * An absent file is not an error and an unreadable one is. The difference
 * matters: "you have no configuration" is a normal state, and "you have
 * configuration this process could not read" is a run whose settings are
 * unknown, which must not proceed to a scan that then reports settings it did
 * not use.
 */
export function loadConfig(
  cwd: string,
  readTextFile: (absolutePath: string) => FileRead,
): FileConfig {
  const file = path.join(cwd, CONFIG_FILE_NAME);
  const read = readTextFile(file);
  switch (read.kind) {
    case "absent":
      return EMPTY;
    case "unreadable":
      throw configurationError(
        `${CONFIG_FILE_NAME} could not be read.`,
        read.detail,
      );
    case "text":
      return parseConfig(read.text, CONFIG_FILE_NAME);
  }
}
