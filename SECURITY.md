# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| 1.x.x   | :x:                |

## Reporting a Vulnerability

Please report sensitive security issues via email to `security@trae.ai` (placeholder) or open a private advisory on GitHub if enabled. Do NOT open public issues for critical vulnerabilities.

## Security Model

### Vulnerability Scanning
The `security_scan` tool allows users to assess code risks.
- **Database**: Currently integrates with `npm audit` (via sub-process) and static analysis rules.
- **Scope**: Checks direct dependencies and known static code patterns (hardcoded secrets, dangerous eval, etc.).
- **False Positives**: The scanner is conservative. Users should manually review high-severity alerts.

### Audit Log Integrity
We use a Merkle Tree-based immutable log to ensure that:
1.  **Tamper-Evidence**: Any modification to past events invalidates the hash chain.
2.  **Lineage**: Every AI action is traceable to a specific prompt and code context.

### Critical CVE Handling
If a critical vulnerability is found in the MCP server itself:
1.  We will issue a patch release within 24 hours.
2.  The CI pipeline blocks builds on critical `npm audit` failures.
