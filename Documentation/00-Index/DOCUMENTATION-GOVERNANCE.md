# Documentation Governance Policy

Date: 2026-07-07
Scope: Workspace documentation trees
Owner: Project Manager + Documentation Owner

## Decision

The authoritative documentation root is:

- Documentation/

The legacy tree:

- Documentations/

is non-authoritative and should be treated as legacy/reference until decommission.

## Policy Rules

1. New docs must be created only under Documentation/.
2. Updates must be applied to Documentation/ first.
3. Cross-links from project READMEs should target Documentation/.
4. Legacy Documentations/ content should not be used as source of truth for release decisions.

## Migration Plan

1. Freeze legacy updates in Documentations/.
2. Compare Documentations/ vs Documentation/ for any missing historical context.
3. Port useful deltas into Documentation/ with explicit changelog notes.
4. Remove legacy tree after owner approval.

## Ownership and Review Cadence

- PM: monthly governance review.
- Doc Owner: weekly structure and link integrity review.
- Technical owners: update relevant docs during feature changes.

## Compliance Checklist

- Authoritative root explicitly stated in onboarding docs.
- Inventory includes governance file and owner map.
- QA validation references this policy in every documentation audit.
