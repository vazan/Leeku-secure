# SQL Documentation (PostgreSQL Branch)

This folder is PostgreSQL-focused on the `postgresql` branch.

## Canonical Schema

- [postgresql_schema.sql](postgresql_schema.sql)

Apply it with:

```sh
psql -U leeku_app -d LeekuSecure -f Documentation/SQL/postgresql_schema.sql
```

## Prerequisites

- Database `LeekuSecure` exists.
- Role used for bootstrap has privileges to create tables, indexes, and constraints in schema `public`.

## Notes

- The schema is idempotent where possible (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Includes seed data needed by the app (for example quota tiers and system configuration defaults).
- Use this file as the single source of truth for database changes on this branch.

## Related Docs

- [../01-Technical/SETUP.md](../01-Technical/SETUP.md)
- [../01-Technical/DEPLOYMENT.md](../01-Technical/DEPLOYMENT.md)
