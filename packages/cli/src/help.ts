/**
 * Every help document, as a constant.
 *
 * `docs/IMPLEMENTATION_SPEC.md` section 10: "No command is considered public
 * until its help text and exit-code behavior have golden tests." So these are
 * data rather than a builder, and nothing here interpolates a version, a path,
 * a terminal width or a date: a help document that changes with the
 * environment cannot have a byte-stable golden.
 *
 * Only implemented surface appears. `report diff`, `profiles list`, `doctor`,
 * `--output`, `--include-metadata` and the JUnit, GitHub Summary and SARIF
 * formats are in `IMPLEMENTATION_SPEC.md` section 10 and are absent here,
 * because `CLAUDE.md` forbids advertising a planned feature and a help text is
 * the most literal form of advertising a CLI has.
 */

export const ROOT_HELP = `agentready-lab - conformance and interoperability checks for agent-facing web mechanisms

USAGE
  agentready-lab <command> [options]

COMMANDS
  check <url>            Scan one exact loopback origin.
  rules list             List the rules in the pinned ruleset.
  rules explain <id>     Print one rule's pinned metadata and assertions.

OPTIONS
  -h, --help             Print help for a command and exit 0.

EXIT CODES
  0  Completed with no failure under the selected strictness policy.
  1  A selected rule failed, or strict mode promoted a warning or unable result.
  2  Invalid argument, configuration, profile, selector, or unsupported combination.
  3  The scan as a whole could not safely continue.
  4  An internal invariant was violated.

Run 'agentready-lab <command> --help' for the options of one command.
`;

export const CHECK_HELP = `agentready-lab check - scan one exact loopback origin

USAGE
  agentready-lab check <url> [options]

ARGUMENTS
  <url>                  An http or https URL whose host is a loopback IP
                         literal, such as http://127.0.0.1:3000 or
                         http://[::1]:3000. A host name is refused: resolving
                         one would put the hosts file, NSS and a DNS answer
                         inside the loopback trust boundary.

OPTIONS
      --network-profile <local-loopback|ci-public>
                         Default local-loopback. ci-public is refused: it is
                         unimplemented, and this build has no policy object
                         that could reach a public destination.
      --mode <spec|compat|interop>
                         Default spec.
      --profile <content|api|agent-service|full>
                         Default content. commerce is refused in M1.
      --ruleset <version>
                         Must equal the ruleset version this build pins.
      --include <selectors>
                         Comma-separated. Adds rules the profile does not list.
      --exclude <selectors>
                         Comma-separated. Always beats --include.
      --format <human|json>
                         Default human. json writes JSON only to stdout.
      --source-map <path>
                         A JSON object mapping an origin-relative request path
                         to a repository-relative file path.
      --strict-warnings  Treat an enforced warning as a failure.
      --strict-unable    Treat an enforced unable-to-check as a failure.
      --color            Emit colour. NO_COLOR in the environment still wins.
      --no-color         Never emit colour. This is already the default: the
                         output is the same bytes wherever it is run.
  -h, --help             Print this help and exit 0.

SELECTORS
  web.discovery.robots   One exact rule id.
  web.discovery.*        A namespace glob. '*' is only ever the last component.
  @category:name         Every rule in one registry category.
  @profile:name          Every rule listing one profile.

  An unknown selector, a glob matching nothing, an empty element and an
  uppercase character are each exit 2, before any request is issued.

CONFIGURATION
  agentready.config.json in the working directory, if it exists. Flags win over
  the file, and the file wins over the built-in defaults, with two exceptions:
  every network budget takes the minimum across all sources, and rules.disable
  and --exclude take the union.

NOTE
  All eight rules in this build are implemented, so 'check' produces a full
  report for every rule a profile selects. The default content profile
  selects six of the eight: web.discovery.api-catalog and
  agent.discovery.skills do not list content in the pinned ruleset, so
  reaching them takes --profile agent-service, --profile full, or --include.
  That is profile membership, not implementation status.
`;

export const RULES_HELP = `agentready-lab rules - inspect the pinned ruleset

USAGE
  agentready-lab rules <subcommand> [options]

SUBCOMMANDS
  list                   List the rules in the pinned ruleset.
  explain <rule-id>      Print one rule's pinned metadata and assertions.

OPTIONS
  -h, --help             Print help for a subcommand and exit 0.
`;

export const RULES_LIST_HELP = `agentready-lab rules list - list the rules in the pinned ruleset

USAGE
  agentready-lab rules list [options]

OPTIONS
      --profile <content|api|agent-service|full>
                         List only the rules that name this profile.
      --mode <spec|compat|interop>
                         List only the rules that declare this mode.
      --format <human|json>
                         Default human. json writes canonical JSON to stdout.
  -h, --help             Print this help and exit 0.

Applicability and gate use the native ADR-0004 names, not the published
compatibility-snapshot strings, so a selector can be written from this output
without reading the ruleset YAML.
`;

export const RULES_EXPLAIN_HELP = `agentready-lab rules explain - print one rule's pinned metadata

USAGE
  agentready-lab rules explain <rule-id> [options]

ARGUMENTS
  <rule-id>              An exact rule id, such as web.discovery.robots. A
                         selector is not accepted here: this command explains
                         one rule.

OPTIONS
  -h, --help             Print this help and exit 0.

The assertions, requirement classes and source references printed here are read
from the rule's pinned metadata. They are what a finding may cite; they are not
a claim that the rule is implemented.
`;
