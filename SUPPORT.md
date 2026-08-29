# Support

AgentReady Lab is currently an implementation blueprint, not a released
scanner. There is no npm package, hosted service, GitHub Action, or supported
CLI yet. See [PROJECT_STATUS.md](PROJECT_STATUS.md) before requesting help with
a planned interface.

## Where to ask

Use the repository's GitHub features according to the type of request:

| Request | Channel |
| --- | --- |
| Reproducible project bug | Bug report issue form |
| False positive or false negative | Incorrect-result issue form |
| New or changed standards rule | Rule-proposal issue form |
| Implementation or usage question | GitHub Discussions, once enabled |
| Security vulnerability | Private reporting from the Security tab |
| Conduct incident | Private conduct channel required before public launch |

Do not put vulnerability details in an issue or Discussion. Follow
[SECURITY.md](SECURITY.md).

## Before opening an issue

1. Read [PROJECT_STATUS.md](PROJECT_STATUS.md) and confirm the feature exists.
2. Search existing issues and Discussions.
3. Reduce the behavior to a local fixture when possible.
4. Record the tool, schema, profile, and ruleset versions.
5. Remove credentials, private URLs, personal data, cookies, authorization
   headers, and unrelated response content.
6. Include an exact standards source for a disputed conformance result.

If you include a non-local target, you must own it or be authorized to test it.
A public URL is not automatically suitable for repeated automated testing.

## Support scope

Maintainers can help with:

- documented AgentReady Lab behavior;
- reproducing a suspected incorrect result;
- interpreting the evidence emitted by a rule;
- contributing fixtures, rules, or code;
- migration between supported project versions.

Maintainers cannot provide:

- emergency or guaranteed-response support;
- legal, compliance, security-audit, or certification advice;
- permission to test third-party systems;
- support for unpublished packages or unofficial forks;
- debugging of an entire unrelated website without a minimal reproduction;
- credentials, access, or support for Cloudflare or isitagentready.com.

AgentReady Lab is independent and is not affiliated with, sponsored by,
endorsed by, or maintained by Cloudflare, Inc. Questions about Cloudflare
products or the public isitagentready.com service should use those providers'
official support channels.

## Response expectations

Community support is best effort. Maintainers may prioritize security,
correctness regressions, reproducible false results, and work already on the
roadmap. Opening an issue, receiving a label, or discussing an approach does not
guarantee implementation, merge, release, or a response by a particular date.

## Code of Conduct launch blocker

A real private conduct-reporting channel has not yet been configured, so this
starter pack intentionally has no `CODE_OF_CONDUCT.md`. Before public launch,
the maintainer must add an enforceable Code of Conduct with a monitored private
contact. Do not direct sensitive conduct reports to a public issue and do not
publish a fake placeholder contact.
