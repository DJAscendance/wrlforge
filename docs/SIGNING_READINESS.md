# Windows Code-Signing Readiness (audit only — no certificate in use)

Phase 6B audit of the electron-builder configuration for **future** Windows
Authenticode signing. **No signing certificate is purchased, requested,
generated, imported, or applied.** The current beta artifacts are and remain
**Private Beta — Unsigned**; on first run Windows SmartScreen shows the normal
"Windows protected your PC" / unknown-publisher prompt (**More info → Run
anyway**). Signing does **not** make that prompt vanish — see "SmartScreen
expectations" below.

This document records what *would* be required so that, if an approved
certificate is provisioned later, the wiring is understood and can be added in a
single small, reviewable change. It is a plan, not authorization to sign.

## 1. Current state

`package.json` `build` (see `docs/BUILD.md`) targets `win`: a **portable** `.exe`
and an **NSIS installer** (`nsis`), x64 only, built from Linux via `wine`. There
is **no** `win.certificateFile`, `win.certificateSubjectName`,
`win.signtoolOptions`, `win.sign`, or `CSC_LINK`/`CSC_KEY_PASSWORD` in the config
or environment — i.e. nothing signs today, by design. electron-builder therefore
emits unsigned binaries and logs `skipped … signing is not configured`.

## 2. Required certificate format

Authenticode signing needs a **code-signing certificate** whose private key is
available to the signing host:

| Type | Format | Notes |
|---|---|---|
| **OV** (Organization Validation) | `.pfx`/`.p12` (PKCS#12: cert + private key + chain) | Historically usable as a plain file. Since **June 2023** the CA/Browser Forum requires OV code-signing keys to be stored on **FIPS 140-2 hardware** (HSM / USB token / cloud KMS). A fresh OV cert is therefore **not** a bare `.pfx` on disk — it lives on a token or in a KMS, and signing calls the token/KMS. |
| **EV** (Extended Validation) | Hardware token / cloud HSM only | Never exportable to a file. Required for immediate SmartScreen reputation. Signing is done through the token's CSP/KSP or a cloud-signing API. |

Practical implication for this project: plan for **token/KMS-backed signing**, not
a `.pfx`-on-disk flow. electron-builder supports both:

- **File-based** (legacy / internal test CA): `win.certificateFile` +
  `CSC_KEY_PASSWORD`, or `CSC_LINK` (path or base64) + `CSC_KEY_PASSWORD`.
- **Token/KMS / custom**: `win.sign` pointing at a custom signing hook, or
  `win.signtoolOptions` with a `signingHashAlgorithms`/`certificateSubjectName`
  that resolves against the machine cert store where the token is presented.
  Cloud options (Azure Trusted Signing, DigiCert KeyLocker, SSL.com eSigner) are
  wired through their own signtool plug-in or a `win.sign` script.

Use **SHA-256** (`signingHashAlgorithms: ["sha256"]`); SHA-1 is obsolete.

## 3. Expected environment variables / secure configuration points

If/when a certificate is approved, the intended wiring (nothing here is set today):

| Point | Variable / config | Purpose |
|---|---|---|
| Cert material (file flow) | `CSC_LINK` | Path or base64 of the `.pfx`. Base64 lets it live as a CI secret, never on disk in the repo. |
| Cert password (file flow) | `CSC_KEY_PASSWORD` | PKCS#12 passphrase. **Secret.** |
| Token/KMS flow | provider-specific (e.g. `AZURE_*` for Trusted Signing, `SM_*` for DigiCert KeyLocker) + `win.sign` hook | The private key never leaves the HSM; the hook streams the digest out and the signature back. |
| Opt out on unsigned builds | `CSC_IDENTITY_AUTO_DISCOVERY=false` | Prevents electron-builder from picking up an *ambient* cert on a dev machine — keeps "unsigned" deterministic. Worth setting **now** in the build scripts to guarantee the beta stays unsigned regardless of host cert store. |
| Config block | `package.json` `build.win.signtoolOptions` / `build.win.sign` | Where the signing method is declared. Absent today. |

None of these are committed. Secrets (`CSC_KEY_PASSWORD`, provider tokens) must
**only** ever arrive via CI secret store or an interactive prompt — never a repo
file, never a shell-history literal, never a log line.

## 4. Timestamping configuration

A signature without a trusted timestamp becomes invalid when the certificate
expires; a **timestamped** signature stays valid past expiry. electron-builder
defaults to an RFC-3161 timestamp server but the URL should be pinned explicitly:

- `build.win.rfc3161TimeStampServer` — e.g. `http://timestamp.digicert.com` or
  the issuing CA's TSA. (Legacy `timeStampServer` for the old Authenticode TSA is
  deprecated; prefer RFC-3161.)
- Requirement: **every** signed artifact (portable `.exe` **and** the NSIS
  `setup.exe`, plus the uninstaller stub NSIS emits) must be timestamped. NSIS
  signs its own sub-binaries via electron-builder's signing pass, so the same TSA
  applies to all of them automatically once configured.

Verification after signing: `signtool verify /pa /all <artifact>` (on Windows) or
`osslsigncode verify <artifact>` (cross-platform) must show a present, valid
countersignature/timestamp.

## 5. CI implications

- **Signing host**: token/HSM-backed OV/EV **cannot** sign under `wine` on Linux
  the way the unsigned build does today — the token CSP/KSP and `signtool.exe` are
  Windows-native. A signed build therefore needs a **Windows CI runner** (or a
  cloud-signing API that accepts a digest from Linux, e.g. Azure Trusted Signing /
  DigiCert KeyLocker with their Linux-capable clients). This is the single biggest
  structural change from the current Linux+wine flow.
- **Determinism**: signing embeds a signature + timestamp, so a signed artifact is
  **not** byte-reproducible across runs (the timestamp differs). The SHA-256
  checksum file must be regenerated **after** signing, and reproducibility claims
  apply to the *unsigned* payload only. (This does not affect the Review Bundle
  ZIP, which stays deterministic — it is content, not an app binary, and is never
  signed.)
- **Ordering**: checksum + release-notes generation must run **after** the signing
  step, not before.
- **Isolation**: the signing job should be a separate, permission-gated CI stage so
  the certificate/token is only exposed to that stage, not to build/test stages.

## 6. Secret-handling requirements

- Certificate passphrase and any provider tokens live **only** in the CI secret
  store (or an interactive HSM PIN prompt). Never in `package.json`, `.env` files
  committed to the repo, build logs, or command-line arguments visible in
  `ps`/history.
- `CSC_LINK` as **base64 in a secret** is preferred over a checked-in `.pfx`
  (an internal test cert included). A real OV/EV key is on hardware and is never a
  file at all.
- Rotate/scope tokens to the signing stage; revoke on suspected exposure.
- Keep `release/` git-ignored (it is) so no signed or unsigned binary is ever
  committed.
- Audit logs from the signing stage must not echo secrets; scrub `signtool`
  verbose output if it would print cert details into public CI logs.

## 7. SmartScreen expectations (do not overclaim)

- **OV** signing removes the *unknown publisher* wording but SmartScreen may still
  warn until the binary earns reputation (download volume over time).
- **EV** signing grants immediate SmartScreen reputation, so first-run warnings are
  typically absent — but this is Microsoft's behavior, not a guarantee this project
  can assert.
- **Therefore:** signing readiness here makes **no claim** that SmartScreen warnings
  are eliminated. Until an approved certificate is provisioned *and* verified on a
  real download, artifacts stay labelled **Private Beta — Unsigned** and the
  README/PLATFORM_NOTES keep the "expect a SmartScreen prompt" instruction.

## 8. Minimal future change set (when approved)

1. Provision an approved OV/EV cert on a token/KMS (separate approval — **not** part
   of this lane).
2. Add a Windows (or cloud-signing) CI stage; move the build there or add a signing
   pass.
3. Add `build.win.signtoolOptions`/`build.win.sign` + `rfc3161TimeStampServer` to
   `package.json`; supply `CSC_*`/provider secrets via CI secret store.
4. Regenerate checksums + notes **after** signing; drop the "Unsigned" label only
   after `signtool verify`/`osslsigncode verify` passes on a real artifact.
5. Re-verify first-run behavior on a real download before making any SmartScreen
   claim.

Until all of the above is done under separate approval, the project ships
**unsigned** and says so.
