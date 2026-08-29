# Security Policy

AgentReady Lab treats scanning as a security-sensitive activity. URLs, DNS
answers, redirects, headers, and response bodies are untrusted input.

## Project status and supported versions

There is currently no working scanner or supported release. This repository is
an implementation blueprint.

Once pre-1.0 releases exist, only the latest released minor line will receive
security fixes unless the maintainers announce broader support. After 1.0, the
supported versions will be listed here. Security backports are not implied by a
version appearing in package registries or Git history.

## Reporting a vulnerability

Do **not** open a public issue or discussion for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow from this repository's
**Security** tab by selecting **Report a vulnerability**. The repository owner
must enable private vulnerability reporting before public launch. If that
option is unavailable, do not publish technical details publicly; ask the
maintainer, without including vulnerability details, to enable a private
reporting channel.

Include, when possible:

- the affected version or commit;
- the affected package or component;
- a concise description and potential impact;
- reproducible steps or a minimal proof of concept;
- required configuration or platform details;
- suggested remediation, if known;
- whether any third-party system or data was involved;
- your preferred name for optional public credit.

Remove credentials, access tokens, personal data, private hostnames, and data
that belongs to an unrelated target. Do not perform destructive testing to
demonstrate impact.

## Response targets

The maintainers aim to:

- acknowledge a report within **5 business days**; and
- provide an initial triage assessment within **10 business days**.

These are best-effort targets, not guaranteed service-level agreements. Fix and
disclosure timing depends on severity, reproducibility, maintainer availability,
and downstream coordination. The maintainers will try to provide periodic
updates while an accepted report remains unresolved.

Please allow time for coordinated remediation before public disclosure. The
maintainers will discuss a disclosure date with the reporter and credit the
reporter only with consent.

## Vulnerabilities in scope

Examples include:

- server-side request forgery or private-network filtering bypass;
- DNS-rebinding, redirect, address-pinning, or hostname-validation bypass;
- command injection or arbitrary file access;
- unsafe execution of discovered scripts, skills, tools, or content;
- response-size, decompression, parser, recursion, or resource-exhaustion
  attacks;
- leakage of credentials, sensitive headers, submitted URLs, or report data;
- cross-user data exposure in a future hosted service;
- malicious fixture execution or test isolation failure;
- GitHub Actions injection or release-pipeline compromise;
- dependency or package-integrity issues with a demonstrated impact on this
  project.

Public hardening suggestions without a plausible exploit or sensitive detail
may be filed as normal issues. When uncertain, report privately.

## Reports outside this project's scope

The following are not AgentReady Lab vulnerabilities:

- a vulnerability in a third-party website discovered while scanning it;
- disagreement with a rule result that has no security impact;
- missing checks or planned features accurately described as unimplemented;
- denial-of-service testing against public infrastructure;
- social engineering, credential stuffing, or attacks on maintainers;
- automated dependency reports without a demonstrated affected path;
- findings that require testing a system without permission.

Report a false positive or false negative through the dedicated issue form only
after removing sensitive information. Report a vulnerability in a scanned site
to that site's authorized security contact, not to this repository.

## Authorized testing

Test only systems you own or are explicitly authorized to assess. Until remote
scanning is implemented and the threat model's required controls pass
adversarial review, restrict development testing to deterministic local
fixtures and project-controlled infrastructure.

Do not use this policy as authorization to test Cloudflare, isitagentready.com,
other contributors, or any third-party service. AgentReady Lab is independent
and has no authority to grant permission over those systems.

## No bug bounty

The project does not currently offer a paid bug bounty. A report's acceptance,
fix, acknowledgement, or public credit does not create an entitlement to
payment.
