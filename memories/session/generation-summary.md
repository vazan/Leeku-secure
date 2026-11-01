---
agent: DocHub | date: 2026-10-31 | model: codestral-latest
---

# GENERATION-SUMMARY — Migration MSSQL → PostgreSQL (soft-deletion & file versioning)

## Audience
- Backend/DB engineers who will execute the migration on the `postgresql` branch.
- Frontend engineers touching the sharing / trash / version UI.
- The project owner/technical lead who must approve scope and sequencing.

## Périmètre
Migrate the **soft-deletion** and **file versioning** functionality that currently
exists only on the `mssql` branch onto the `postgresql` branch. The source of truth
is the commit range:

```
d364703f8b89baced180e5a565ee55d62d19ad99  (first commit of range)
   …
e82dba6c8816258713409cd294f2835f3e0b5861  (last commit of range)
```

The two features in scope:
1. **Soft-deletion / Trash (Recycle Bin)** — `files.deleted_at`, trash UI, retention purge.
2. **File versioning** — same-name version detection, `file_versions` /
   `file_version_keys`, version endpoints, shared-link version pinning, backfill script.

Out of scope: the competitive Google-Drive/Mega documentation commits, DEV-CHANGE-REPORT
rewrites, and repo housekeeping (`.gitignore`) that ride in the same range.

## Profil
Qualité production — migration plan, schema DDL, parity notes, and a gap manifest
usable directly by a database + backend engineer.

## Objectifs
- [ ] Cartographier les différences MSSQL→PostgreSQL des 2 features.
- [ ] Produire le schéma PostgreSQL (DDL) équivalent.
- [ ] Lister les adaptations du code (`db.ts` translator + `server.ts` + frontend).
- [ ] Identifier les écarts de behavior et les risques (OUTPUT/RETURNING, NEWID, TOP).
- [ ] Score DocQA ≥ 7,0 pour PASS.

## Seuils de qualité
- Score DocQA minimum : 7.0
- Couverture minimale : 100 % des écarts DB(code+schema+scripts) identifiés
- Dette technique maximum : 6 items
