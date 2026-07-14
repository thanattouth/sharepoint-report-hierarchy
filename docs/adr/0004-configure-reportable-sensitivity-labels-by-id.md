# ADR 0004: Configure reportable sensitivity labels by ID

Status: Accepted  
Date: 2026-07-14

## Context

The report originally treated `Secret` as the only reportable label. Customer Purview
policies can include several governed classifications, including `Confidential` and
`Secret`, and display names can be renamed or localized.

## Decision

The scanner and report use a tenant-specific set of immutable sensitivity label IDs
called `reportableLabelIds`. A file is included once when any extracted label matches
that set. Display names are presentation metadata only and never decide inclusion.

The pilot receives the allowlist through `SCANNER_REPORTABLE_LABEL_IDS` and may receive
an approved ID-to-name catalog through `SCANNER_LABEL_DISPLAY_NAMES_JSON`. The cached
inventory keeps the extracted label ID and optional display name, and the report can
filter the authorized result set by label without changing hierarchy authorization.

Run metrics use `sensitiveCount`, and product copy uses `Sensitive files`. Individual
rows continue to show the actual configured label, such as Confidential or Secret.

## Consequences

- Adding a reportable classification is configuration, not a scanner code change.
- Tenant onboarding must map and approve every reportable label ID.
- Counts remain distinct by stable file identity even if a response contains multiple
  reportable labels.
- Removing a label from configuration changes report visibility but does not erase its
  cached extraction history; retention and reclassification are separate policies.
