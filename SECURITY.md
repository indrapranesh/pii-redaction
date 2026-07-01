# Security Policy

This is a library whose entire job is to keep sensitive data from leaking, so
security reports are taken seriously.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Instead, email
**indrapranesh2111@gmail.com** with:

- a description of the issue and why it matters,
- steps to reproduce (a minimal input is ideal), and
- the version or commit you found it on.

You'll get an acknowledgement, and a fix or mitigation will be worked out before
any public disclosure. Please give a reasonable window to respond before
disclosing publicly.

## What counts

The kinds of issues most relevant to this project:

- **Leaks through the redactor** — an input that should be redacted but isn't,
  in a way that would send real PII/PHI to a downstream service.
- **Vault exposure** — any code path that could serialize the vault to the
  network, disk, or logs. The vault is meant to live only in memory on the
  client.
- **Rehydration errors** — a placeholder being swapped for the wrong value.
- **ReDoS** — a detector regex that can be driven to catastrophic backtracking.

Missed detections on *invalid* data (a number that fails its checksum) are
working as designed, not vulnerabilities — see `eval/RESULTS.md`.

## Supported versions

The latest published version on the `main` branch is what receives fixes.
