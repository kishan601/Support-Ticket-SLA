# Support Ticket & SLA Tracker — Project Walkthrough

---

## 1. Overall Architecture
- **Monorepo Structure**: Managed via NPM Workspaces (`workspaces: ["frontend", "backend"]`).
- **Backend**: Node.js (TypeScript strict mode) running a schema-first **GraphQL Yoga** server and **Prisma ORM** connecting to **PostgreSQL**.
- **Frontend**: **Next.js (App Router)** + **React** + **Tailwind CSS** with **URQL** GraphQL client using document caching (`additionalTypenames`) to ensure zero redundant network calls.
- **Security**: JWT-based authentication via `Authorization: Bearer <token>` headers with role-based access control (`AGENT` vs. `REPORTER`).

---

## 2. GraphQL Schema
- **Schema-First Design**: Defined in `backend/src/graphql/schema/typeDefs.graphql`.
- **Key Queries**:
  - `tickets(status, priority, assigneeId, slaState, take, cursor)`: Supports cursor-based pagination and multi-attribute filtering.
  - `dashboard`: Real-time aggregated metrics for Open, In-Progress, At-Risk, and Breached tickets.
  - `users(role)` & `holidays`: Metadata queries for dropdowns and holiday awareness.
- **Key Mutations**:
  - `createTicket`, `assignTicket`, `changeTicketStatus`, `addComment`, `resolveTicket`, `register`, `login`.
- **Standardized Machine Error Codes**: `VALIDATION_ERROR`, `INVALID_STATUS_TRANSITION`, `USER_NOT_FOUND`, `TICKET_NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`.

---

## 3. Database Schema
Defined in `backend/prisma/schema.prisma`:
- **`User`**: `id`, `name`, `email` (unique), `passwordHash`, `role` (`AGENT` | `REPORTER`).
- **`Ticket`**: `id`, `title`, `description`, `priority`, `status`, `reporterId`, `assigneeId`, `createdAt`, `firstResponseAt`, `resolvedAt`.
  - *Indexes*: Added on `status`, `priority`, and `assigneeId` for fast filtering.
- **`Comment`**: `id`, `content`, `ticketId`, `authorId`, `createdAt`.
- **`Holiday`**: `id`, `date` (unique), `name`.

---

## 4. SLA Calculation Approach
- **Priority Tiers**:
  - `URGENT`: 1h Response / 4h Resolution
  - `HIGH`: 4h Response / 24h Resolution
  - `MEDIUM`: 8h Response / 48h Resolution
  - `LOW`: 24h Response / 72h Resolution
- **SLA State Thresholds**:
  - `ON_TRACK`: 0% to 75% of business time consumed.
  - `AT_RISK`: > 75% of business time consumed.
  - `BREACHED`: Target deadline has passed (`remainingBusinessMinutes <= 0`).
- **Clock Freezing**:
  - **First Response SLA**: Freezes permanently when an agent posts the first comment (`firstResponseAt`).
  - **Resolution SLA**: Freezes permanently when a ticket is marked `RESOLVED` (`resolvedAt`).

---

## 5. Business-Hours Handling
- **Working Hours**: Monday through Friday, **09:00 to 18:00** (9 business hours / 540 minutes per day).
- **Exclusion Logic**:
  - Tickets raised outside business hours (nights, weekends, public holidays) begin counting at **09:00 on the next valid business day**.
  - Tickets raised near the end of a day (e.g., Friday at 17:45) consume only the remaining 15 minutes before 18:00, and roll over the remainder to **Monday at 09:00**.
  - All public holidays configured in the database are fully skipped during minute consumption.

---

## 6. Timezone Handling
- All business calendar calculations are timezone-aware using `date-fns-tz`.
- Configured business timezone is defined via the `BUSINESS_TIMEZONE` environment variable (defaults to `Asia/Kolkata`).
- Dates are stored in UTC in PostgreSQL and evaluated against the local business hours of the configured timezone.

---

## 7. Status Transition Design
Enforced by a strict server-side state machine:
```text
OPEN ──► IN_PROGRESS ──► RESOLVED ──► CLOSED (Terminal)
  │            │              │
  └────────────┴──────────────┘
```
- `OPEN` can transition to `IN_PROGRESS`, `RESOLVED`, or `CLOSED`.
- `IN_PROGRESS` can transition to `RESOLVED` or `CLOSED` (cannot move backwards to `OPEN`).
- `RESOLVED` can transition to `CLOSED` or be re-opened to `IN_PROGRESS`.
- `CLOSED` is a **terminal state** and cannot transition to any other status.
- **Frontend Sync**: Dropdown dynamically renders only valid next states and disables itself on closed tickets.

---

## 8. Testing Strategy
1. **Unit Tests (22 tests in Vitest)**:
   - `tests/unit/sla.test.ts` (9 tests): Covers normal weekdays, outside hours, weekend rollover, Friday evening rollover, holidays, multi-day SLAs, remaining minutes, and SLA states.
   - `tests/unit/business_logic.test.ts` (13 tests): Covers state transitions, illegal transition rejection, input validation, role-based authorization, first-response timestamp recording, and cursor pagination mechanics.
2. **Integration Testing**:
   - `tests/integration/sla.test.ts`: Tests complete ticket lifecycle against PostgreSQL persistence. Guarded with `TEST_DATABASE_URL` to protect development and production databases from accidental wiping.

---

## 9. Important Architectural Tradeoffs
1. **Dynamic In-Memory SLA Calculation vs. Cron Workers**:
   - *Chosen Approach*: SLA states and remaining minutes are calculated dynamically on the server at query time.
   - *Tradeoff*: Ensures 100% real-time accuracy to the exact second without desynchronization. For large-scale datasets (100k+ tickets), we would complement this with a scheduled background cron worker that persists indexed `slaState` columns.
2. **URQL Document Caching (`additionalTypenames`) vs. Normalized Cache**:
   - *Chosen Approach*: Lightweight document caching with reactive type invalidation (`Ticket`, `Comment`, `User`).
   - *Tradeoff*: Minimal client bundle size and rock-solid state synchronization without redundant network calls or race conditions.
