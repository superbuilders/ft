"""Render gitleaks PR-gate findings as a markdown run summary, and own the verdict.

Reads gitleaks' JSON report (argv[1]), writes a markdown summary to stdout
(the workflow redirects it into GITHUB_STEP_SUMMARY), and exits non-zero
when the scan found anything — so one parser decides both what to print
and whether the gate fails. The scan runs with --redact, so Secret and
Match arrive as "REDACTED"; this prints rule, location, and the fingerprint
a developer copies into .gitleaksignore, never the secret itself.
"""

import json
import sys

with open(sys.argv[1]) as f:
    findings = json.load(f)

print('### Secret scan (PR diff)')

if not findings:
    print('No secrets introduced by this PR.')
    raise SystemExit(0)

print(f'{len(findings)} secret(s) introduced by this PR — rotate any real ones, then remove or allowlist.')
print()
print('| Rule | Location | .gitleaksignore entry |')
print('|---|---|---|')

for finding in findings:
    rule = finding.get('RuleID', '?')
    file = finding.get('File', '?')
    line = finding.get('StartLine', '?')
    # The commit-less form on purpose: gitleaks' own Fingerprint field is
    # commit-qualified (commit:file:rule:line), and a squash merge rewrites
    # that SHA, so a commit-qualified ignore entry silently stops matching.
    ignore = f'{file}:{rule}:{line}'
    print(f'| {rule} | {file}:{line} | `{ignore}` |')

print()
print('False positive? Add `# gitleaks:allow` on the line, or the commit-less')
print('fingerprint (`file:rule-id:line`) to `.gitleaksignore`.')

# Any finding fails the gate.
raise SystemExit(1)
