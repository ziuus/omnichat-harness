# Security Policy

OmniChat Harness automates browser sessions for AI chat websites. Handle sessions like credentials.

## Sensitive data

- Encrypted session files live under `data/sessions/*.enc` and must never be committed.
- Do not log cookies, local/session storage, API keys, or decrypted session contents.
- Set a strong `SESSION_ENCRYPTION_KEY` before using persistent sessions.

## Reporting issues

For vulnerabilities or accidental credential exposure, open a private security advisory on GitHub or contact the maintainer privately. Do not publish exploit details in public issues.

## Responsible usage

Use dedicated accounts where possible and review each provider's Terms of Service before automating their web UI.
