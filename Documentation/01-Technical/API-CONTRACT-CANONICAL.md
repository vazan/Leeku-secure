# Canonical API Contract

Date: 2026-07-07
Scope: Leeku-MSSQL + Leeku-POSTGRESQL
Owner: DocEngineer + Backend Owner
Status: Draft - authoritative until replaced by OpenAPI artifact

## Purpose

Define a single contract baseline for API behavior to reduce integration drift across both branches.

## Authority Model

1. Primary source (current): this file + API-REFERENCE.md.
2. Future primary source: OpenAPI/Swagger artifact once published.
3. In case of conflict: implementation in server route handlers remains runtime truth until contract is updated.

## Contract Baseline

### Authentication policy

- Public endpoints: health, public sharing, login/register/verify/csrf/refresh/logout.
- Authenticated user endpoints: files, sharing links, profile/session self-management.
- Admin endpoints: admin user/file/log/quota operations and maintenance toggle.

### Status policy (baseline)

- 2xx: successful operation.
- 4xx: client/auth/permission/validation issues.
- 5xx: internal/server dependency failure.

Note:
- Endpoint-specific status matrices remain partial until OpenAPI publication.

### Error object policy (baseline)

All JSON errors should include:

| Field | Type | Required | Notes |
|---|---|---|---|
| code | string | Yes | Stable machine-readable code |
| message | string | Yes | Human-readable description |
| requestId | string | Recommended | Correlates logs/traces |
| details | object or array | Optional | Validation or context details |

Unknown:
- Full error-code registry is not yet centralized.

### Request/Response policy

- Request validation should reject malformed payloads with 4xx.
- Response payloads should avoid leaking internal stack or secrets.
- File/share route schemas are implementation-derived and must be formalized in OpenAPI.

## Route Group Contract Map

Reference route groups and known endpoint inventory:
- API-REFERENCE.md

## Branch Parity Rules

1. Any route added in one branch must be evaluated for parity in the sibling branch.
2. DB-specific behavior differences must be documented in DATABASE-MSSQL.md or DATABASE-POSTGRESQL.md.
3. Contract changes require updates to:
   - API-REFERENCE.md
   - this file
   - roadmap and risk docs if behavior affects reliability/security.

## Exit Criteria To Replace Draft Status

1. Publish OpenAPI schema artifact in repository.
2. Add endpoint-level request/response schemas.
3. Add endpoint-level auth and status matrix.
4. Add centralized error-code registry.

## Evidence

- 01-Technical/API-REFERENCE.md
- 01-Technical/DISCOVERY-REPORT.md
- 04-Risk-And-Corrections/GAP-MANIFEST.md
