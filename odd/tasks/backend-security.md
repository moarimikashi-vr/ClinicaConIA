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
| T1 | S2-S5, S7 | inline | done | c5c74be; node --test 21/21 |
| T2 | S6 | inline | done | 10d32ca; pytest 28/28 (RED vs baseline main.py observed) |
| T3 | S3 (frontend PDF flow) | inline | done | ed7411a; vite build OK |
| T4 | all | independent verifier (Risk item 2) | done | 0 blockers, S1–S7 pass; advisories 1,2,5,6 fixed in follow-up commit |

## Log

- L1 (2026-11-17): "vamos a arreglar todos los errores de backend para tener una buena seguridad".
- L2: Source review findings: unauthenticated `users`, `pacientes`, `reports` routes (anyone could register an administrador); per-case IDOR on read/comment/update; `PATCH /casos/:id` mass assignment; body-supplied author/owner; missing profile ⇒ no role ⇒ admin branch in `getCases`; HTML injection in e-mails; `debug_ids` leak; IA service open with `allow_origins=["*"]`.
- L3 (2026-11-17): real services smoke test: all formerly public routes 401 without token; admin flows (cases, case, comments, patient, search, doctors) 200; PATCH with `estado` 400.
- L4: Independent verifier: 0 blockers, S1–S7 pass. Advisories fixed: IA path regex `fullmatch` (trailing newline), token checked in middleware before body parsing, `/docs` and `/openapi.json` disabled, file URL must match `uploadPath`, `verifyIdToken(..., checkRevoked=true)`, ASCII startup warning, NSS trimmed in upload folder. Left for the owner: patient/case delete scope (any atencion deletes any patient; participants delete open cases), legacy NSS values with `.`/spaces, updateCase read-then-write without transaction, Firestore/Storage security rules (frontend reads `casos`, `comentarios`, `notifications` directly).
- L5 (2026-11-17): Gentle AI review (risk + reliability, lineage review-ef90f0f1aa47e014, 95fd1c0..9c5f631) approved and acknowledged. Non-blocking warnings: bucket segment of file URL not pinned (pre-existing gap, narrowed); S7 test does not reach a 500 path; no test proves the backend sends X-IA-Token; legacy NSS with `.`/space skips IA silently; sanitizePatient coerces '' to 0 and 'false' to true; checkRevoked maps infra errors to 401; CasoDetalle identifiers flagged as unverified (they exist at lines ~195-197). Full-slice review 0f17223..HEAD refused with lens_context_budget_exceeded; the UI redesign slice 0f17223..95fd1c0 remains unreviewed.
- L6 (2026-11-17): UI redesign reviewed in three chained candidates from temporary worktrees: 0f17223..90b151c (review-e43ce20a3d79e617), 90b151c..0131e84 (review-45ec2a14287fc252), 0131e84..95fd1c0 (review-b2d2d754860eba74), all approved and acknowledged. The full candidate 0f17223..HEAD keeps failing with lens_context_budget_exceeded (user chose "Revisar" three times); its parts are all covered. Follow-up warnings worth fixing: Row/FieldError/NumberWithUnit declared in render; Ctrl+B also fires inside inputs; matchMedia unguarded; I-key handler without e.key/e.repeat guard; AltaUsuario focuses hardcoded 'rol-medico'; GestionPacientes exhaustive-deps and stale search responses; prediction labels and 'sistema_ia' as unnamed contracts.
- L7 (2026-11-17): user: "Sí, corregilas". Review warnings fixed. Backend (a4c850f): bucket pinned in file URLs, auth/* errors 401 vs Firebase outage 503, patient booleans/empty numbers, unusable NSS rejected with clear 400, IA accepts dots in NSS segment; new tests for 500 responses and the X-IA-Token call (RED observed for the 4 behavior changes; node 26/26, pytest 31/31). Frontend (46b6033): module-scope Row/FieldError/NumberWithUnit, shared InfoRow, IA constants, Ctrl+B ignored in fields, matchMedia guard, I shortcut ignores repeat/missing key, role focus from list, stale patient search ignored. Browser checks: focus kept while typing, Ctrl+B in/out of fields, viewer chip/rows/I key, case detail rows and IA comment. Assessed medium, under_budget (594 lines).
