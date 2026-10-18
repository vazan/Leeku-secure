# Getting Started (Shared Baseline)

Date: 2026-10-18
Scope: Leeku-POSTGRESQL

## 1. Purpose

This guide is the common developer onboarding path for both branches. It centralizes shared setup and isolates DB-specific deltas.

## 2. Shared Prerequisites

- Node.js 22.x runtime.
- PNPM available.
- A local .env file created from branch .env.example.

## 3. Shared Setup Steps

1. Choose one branch folder as working app root:
   - Leeku-MSSQL
   - Leeku-POSTGRESQL
2. Install dependencies:
   - pnpm install --frozen-lockfile
3. Create environment file:
   - copy .env.example to .env
4. Fill placeholders before run (secrets must remain masked in docs and tickets as [REDACTED]).
5. Start development:
   - pnpm run dev

## 4. Shared Run Commands

- pnpm run dev
- pnpm run build
- pnpm run start
- pnpm run preview
- pnpm run clean
- pnpm run lint
