# Governance

AgentReady Lab begins as a maintainer-led open-source project. This document
describes how project decisions are made without pretending that a mature
committee or foundation already exists.

## Principles

Project governance should preserve:

- technically defensible, source-backed conformance results;
- transparent decisions and stable public contracts;
- safe handling of hostile network input;
- respectful treatment of contributors and users;
- independence from vendors, scanners, and standards proponents;
- a low-friction path for substantive external contributions.

## Roles

### Users

Users run the software, test fixtures, report problems, and provide feedback.
No repository activity is required to be a user.

### Contributors

Contributors submit issues, documentation, fixtures, reviews, code, or other
project work. A merged contribution does not automatically grant repository
permissions or decision-making authority.

### Triagers

Triagers may label issues, request reproductions, identify duplicates, and help
contributors find the correct workflow. They do not merge changes or make
binding compatibility decisions unless they are also maintainers.

### Maintainers

Maintainers review and merge changes, manage releases and security reports,
interpret project scope, and enforce repository policy. The founding maintainer
is initially the final decision maker.

## Decision making

Routine, reversible implementation decisions are made through pull-request
review. The project seeks consensus by considering technical evidence,
compatibility, security, maintenance cost, and contributor feedback.

When consensus is not possible, the maintainer makes the final decision and
records the reason. Maintainer authority does not override the project's
license, security policy, or adopted Code of Conduct.

Material decisions require a public issue and, when appropriate, an
architecture decision record. Examples include:

- changing rule semantics or normative interpretations;
- adding a protocol family or interpretation mode;
- changing CLI, configuration, exit-code, or report-schema contracts;
- introducing scoring or changing a score model;
- changing network, storage, telemetry, privacy, or security boundaries;
- adding executable plugins or a hosted multi-user service;
- changing licensing, governance, release, or compatibility policy.

Security-sensitive details may be discussed privately until coordinated
disclosure is safe. The final non-sensitive decision should be documented
publicly.

## Standards and compatibility decisions

Rule decisions are based on exact, versioned primary sources. External scanner
behavior can justify a separately labeled compatibility observation, but it is
not automatically a normative requirement.

A change that alters a verdict must include source evidence, positive and
negative fixtures, a ruleset-version decision, and an explanation in the
changelog. Rule IDs are never reused after retirement.

## Becoming a maintainer

Maintainer access may be offered to a contributor who demonstrates sustained:

- technically sound contributions and reviews;
- care with compatibility and security boundaries;
- reliable, respectful communication;
- appropriate handling of confidential security or conduct matters;
- willingness to maintain existing work, not only add features;
- compliance with the DCO, license, and community policies.

There is no automatic contribution-count threshold. Existing maintainers decide
appointments based on demonstrated judgment and project need. New permissions
should begin with the minimum access required and expand as trust and
responsibility grow.

## Maintainer responsibilities

Maintainers are expected to:

- disclose relevant conflicts of interest;
- distinguish personal opinions from project decisions;
- avoid preferential treatment for employers, vendors, or standards authors;
- protect embargoed security and private conduct information;
- document breaking changes and releases accurately;
- recuse themselves when they cannot review a matter impartially;
- avoid claiming support capacity the project does not have.

Maintainer inactivity is not misconduct. Permissions may be reduced or removed
when a maintainer requests it, becomes persistently inactive, misuses access,
violates community policy, or creates a material security risk. Except for an
urgent security response, removal should be explained to the affected
maintainer and documented at an appropriate level of detail.

## Release authority

Only maintainers designated for release access may publish packages or create
official releases. Releases must come from the protected repository workflow,
pass required checks, and use provenance-capable trusted publishing once a
package exists. No contributor should need a shared long-lived publishing
credential.

## Support and response times

Maintainers provide support on a best-effort basis. Issue discussion or an
accepted proposal is not a promise of implementation, merge, release, or a
specific response date. Security-report response targets are documented in
[SECURITY.md](SECURITY.md).

## Community conduct launch requirement

The repository must not present itself as ready for a public contributor
community until it has an enforceable `CODE_OF_CONDUCT.md` and a real private
conduct-reporting method. This starter intentionally omits that file because a
valid private contact has not been configured. Before public launch, the
maintainer should adopt the current official Contributor Covenant, configure a
private contact that is actually monitored, and confirm that the policy can be
enforced. A placeholder address is not acceptable.

## Independence

AgentReady Lab is not affiliated with, sponsored by, endorsed by, or maintained
by Cloudflare, Inc. Cloudflare, isitagentready.com, and other implementations
may be referenced truthfully for technical context or dated compatibility
observations. No maintainer or contributor may imply official approval,
certification, partnership, or access to proprietary implementation details.

## Changes to governance

Governance changes use the same public proposal and review process as other
material decisions. As the contributor community grows, the maintainers may
replace this model with a more distributed one. Any transition should document
roles, voting or consensus rules, release authority, security responsibility,
and how deadlocks are resolved.
