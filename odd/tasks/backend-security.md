# Feature: backend security hardening

Objective: close the authentication and authorization gaps in the Node API and the IA microservice without breaking the current frontend flows.
Branch: claude/repo-latest-changes-83c046 · Delivery: ask-on-risk · Test runner: `node --test` (Backend), `pytest` (Backend/api-IAFraturas).

## Specs

- S1 User request (L1): "vamos a arreglar todos los errores de backend para tener una buena seguridad".
- S2 Every `/api/*` route requires a valid Firebase ID token and an existing `users` profile with a known role (`medico`, `atencion`, `administrador`); otherwise 401/403.
- S3 Role and resource permissions:
  - users: register → administrador only; `GET /users/:uid` → self or administrador, no list of IDs on 404; `GET /users/doctors` → atencion/administrador, only id, nombre, apellido.
  - pacientes: search, create/update, delete → atencion/administrador; `GET /pacientes/:nss` → atencion/administrador, or medico with an assigned case for that NSS.
  - casos: read, comments, report → administrador, assigned specialist or the case's general doctor; create → atencion/administrador, owner fields from the token; `PATCH /casos/:id` → only `diagnostico`, only the assigned specialist, only while open; close → specialist or administrador.
- S4 Server-derived identity: comment author and case owner come from the token/profile, never from the request body.
- S5 User-controlled text is escaped before it goes into notification e-mail HTML.
- S6 IA microservice: shared secret header required on analysis endpoints; `path` restricted to `casos/<uid>/<nss>/<file>`; upload size limit; no wildcard CORS.
- S7 No internal details (`error.message`, stack, IDs) in API error responses.

Assumption: Firestore/Storage security rules live outside the repo; they are reported as needing owner validation, not changed here.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S2-S5, S7 | inline | in progress | |
| T2 | S6 | inline | pending | |
| T3 | S3 (frontend PDF flow) | inline | pending | |
| T4 | all | independent verifier (Risk item 2) | pending | |

## Log

- L1 (2026-11-17): "vamos a arreglar todos los errores de backend para tener una buena seguridad".
- L2: Source review findings: unauthenticated `users`, `pacientes`, `reports` routes (anyone could register an administrador); per-case IDOR on read/comment/update; `PATCH /casos/:id` mass assignment; body-supplied author/owner; missing profile ⇒ no role ⇒ admin branch in `getCases`; HTML injection in e-mails; `debug_ids` leak; IA service open with `allow_origins=["*"]`.
