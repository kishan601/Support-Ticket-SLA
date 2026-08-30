# Support Ticket & SLA (Service Level Agreement) Tracker

A full-stack Support Ticket & SLA Tracker built with **TypeScript**, **GraphQL Yoga**, **Prisma ORM**, **PostgreSQL**, and **Next.js (React)**. Every ticket calculates precise SLA targets using configurable **business hours only**, excluding nights, weekends, and configured public holidays.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Database Schema Overview](#database-schema-overview)
5. [SLA Engine & Calculation Approach](#sla-engine--calculation-approach)
6. [Ticket Status Transition Rules](#ticket-status-transition-rules)
7. [Authentication & Authorization](#authentication--authorization)
8. [Environment Variables](#environment-variables)
9. [Setup & Database Instructions](#setup--database-instructions)
10. [Running Backend & Frontend](#running-backend--frontend)
11. [Running Tests](#running-tests)
12. [Example GraphQL Queries & Mutations](#example-graphql-queries--mutations)
13. [How I'd Extend This](#how-id-extend-this)

---

## Project Overview

In technical support workflows, Service Level Agreements (SLAs) determine how quickly customer issues must receive a first response and reach full resolution. 

This application implements an enterprise-grade SLA engine with the following core rules:
- **Business Hours Only**: Working hours are Monday through Friday from **09:00 to 18:00** (9 business hours per day).
- **Timezone Awareness**: All business calendar logic runs against a configurable business timezone (`Asia/Kolkata` by default).
- **Exclusions**: Non-working hours, weekends (Saturday & Sunday), and configured public holidays contribute zero business minutes.
- **Clock Freezing**: When an agent sends the first response or when a ticket is marked resolved, the respective SLA clock stops permanently and freezes its final state.
- **Server-Driven SLA State**: The backend GraphQL API is the single source of truth for SLA states and remaining business minutes.

---

## Tech Stack

### Backend
- **Runtime**: Node.js (v18+) with TypeScript (Strict mode, no `any`)
- **API Server**: GraphQL Yoga (Schema-First approach with `.graphql` files)
- **Database & ORM**: PostgreSQL with Prisma ORM
- **Authentication**: JSON Web Tokens (JWT) + Bcrypt password hashing
- **Date/Time Utilities**: `date-fns` & `date-fns-tz` for timezone-aware business calendar calculations
- **Testing**: Vitest for unit and persistence integration testing

### Frontend
- **Framework**: Next.js (App Router) + React + TypeScript
- **Styling**: Tailwind CSS (Dark theme with glassmorphism UI)
- **GraphQL Client**: URQL Client with authentication header exchange

---

## Architecture Overview

The repository is structured as an **NPM Workspace (Monorepo)**:

```text
Support-ticket/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        # Prisma data models & relations
│   │   └── seed.ts              # Database seeder (Users, Holidays, Tickets)
│   ├── src/
│   │   ├── graphql/
│   │   │   ├── schema/
│   │   │   │   └── typeDefs.graphql  # Schema-first GraphQL definitions
│   │   │   └── resolvers/
│   │   │       └── index.ts          # Query & Mutation resolvers
│   │   ├── services/
│   │   │   └── sla/
│   │   │       └── engine.ts         # Isolated business hours SLA engine
│   │   └── server.ts                 # GraphQL Yoga server entry point
│   ├── tests/
│   │   ├── unit/
│   │   │   └── sla.test.ts           # 9 comprehensive SLA engine unit tests
│   │   └── integration/
│   │       └── sla.test.ts           # Real PostgreSQL persistence integration test
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx            # App root layout with URQL provider
│   │   │   └── page.tsx              # Interactive dashboard, ticket list & actions
│   │   └── components/
│   │       └── Provider.tsx          # URQL Client GraphQL provider
│   ├── package.json
│   └── next.config.ts
├── docker-compose.yml                # Optional local PostgreSQL container
├── package.json                      # Root workspace configuration
└── README.md
```

---

## Database Schema Overview

The database models are defined in `backend/prisma/schema.prisma`:

### Models:
1. **`User`**:
   - `id`: UUID (Primary Key)
   - `name`: User's display name
   - `email`: Unique email address
   - `passwordHash`: Bcrypt hashed password
   - `role`: Enum (`REPORTER` | `AGENT`)
   - Relations: `reportedTickets`, `assignedTickets`, `comments`

2. **`Ticket`**:
   - `id`: UUID (Primary Key)
   - `title`: Ticket summary
   - `description`: Detailed issue description
   - `priority`: Enum (`LOW` | `MEDIUM` | `HIGH` | `URGENT`)
   - `status`: Enum (`OPEN` | `IN_PROGRESS` | `RESOLVED` | `CLOSED`)
   - `reporterId`: Foreign key to `User`
   - `assigneeId`: Optional foreign key to `User` (Support Agent)
   - `createdAt`: UTC creation timestamp
   - `firstResponseAt`: UTC timestamp of first non-reporter response (freezes response SLA)
   - `resolvedAt`: UTC timestamp when ticket is resolved (freezes resolution SLA)
   - Indexes: `status`, `priority`, `assigneeId`

3. **`Comment`**:
   - `id`: UUID
   - `content`: Comment body
   - `ticketId`: Foreign key to `Ticket`
   - `authorId`: Foreign key to `User`
   - `createdAt`: UTC creation timestamp

4. **`Holiday`**:
   - `id`: UUID
   - `date`: Unique Date representing the public holiday
   - `name`: Holiday name (e.g. "Independence Day", "Christmas")

---

## SLA Engine & Calculation Approach

The default SLA policies configured per priority:

| Priority | First Response Target | Resolution Target |
| :--- | :--- | :--- |
| **URGENT** | 1 business hour | 4 business hours |
| **HIGH** | 4 business hours | 24 business hours |
| **MEDIUM** | 8 business hours | 48 business hours |
| **LOW** | 24 business hours | 72 business hours |

### Calculation Engine (`backend/src/services/sla/engine.ts`)
1. **Target Calculation (`calculateSlaTarget`)**:
   - If a ticket is raised outside business hours (e.g. Monday 07:00 or Friday 20:00) or on a weekend/holiday, counting begins immediately at **09:00 on the next business day**.
   - If raised during working hours (e.g. Friday 17:59), only the remaining minute before 18:00 is consumed, and the rest rolls over to Monday 09:00.
2. **Remaining Business Minutes (`calculateRemainingBusinessMinutes`)**:
   - Evaluates remaining working minutes between the current time (or frozen event timestamp) and the computed SLA deadline.
3. **SLA States**:
   - `ON_TRACK`: 0% to 75% of SLA budget consumed.
   - `AT_RISK`: > 75% of SLA budget consumed.
   - `BREACHED`: SLA deadline has passed (`remainingMinutes <= 0`).
4. **Clock Freezing**:
   - Once a non-reporter/agent comments, `firstResponseAt` is recorded and the Response SLA clock is permanently locked.
   - Once a ticket is resolved, `resolvedAt` is recorded and the Resolution SLA clock is permanently locked.

---

## Ticket Status Transition Rules

The server and frontend UI enforce a strict state machine lifecycle:

```text
  ┌─────────┐
  │  OPEN   ├─────────────────┬──────────────┐
  └────┬────┘                 │              │
       │                      │              │
       ▼                      │              │
┌──────────────┐              │              │
│ IN_PROGRESS  ├────────┐     │              │
└──────┬───────┘        │     │              │
       │                ▼     ▼              ▼
       │             ┌──────────────┐   ┌──────────┐
       │             │   RESOLVED   ├──►│  CLOSED  │
       │             └──────┬───────┘   └──────────┘
       │                    │ (reopen)       ▲
       └────────────────────┼────────────────┘
                            │
                            ▼
                     (IN_PROGRESS)
```

- **Transition Rules**:
  - `OPEN` &rarr; `IN_PROGRESS`, `RESOLVED`, `CLOSED`
  - `IN_PROGRESS` &rarr; `RESOLVED`, `CLOSED` (cannot move backwards to `OPEN`)
  - `RESOLVED` &rarr; `CLOSED` or `IN_PROGRESS` (re-open for rework)
  - `CLOSED` &rarr; **Terminal state** (cannot transition to any other status)
- **Server Enforcement**: Any invalid transition attempt throws a clear GraphQL error: `INVALID_STATUS_TRANSITION`.
- **UI Dynamic Options**: The ticket detail status dropdown dynamically filters options to show only valid next states, and disables itself when a ticket is `CLOSED`.
- **Resolving**: Marking a ticket as `RESOLVED` automatically sets the `resolvedAt` timestamp and stops the resolution clock.

---

## Authentication & Error Handling

### Authentication & Roles
- **JWT Tokens**: Emitted upon `login` or `register` and supplied via the standard HTTP `Authorization: Bearer <token>` header.
- **Server-Side Role Enforcement**:
  - `REPORTER`: Allowed to create tickets and comment on tickets.
  - `AGENT`: Exclusively allowed to assign tickets, change ticket status, resolve tickets, and post official agent responses.

### Machine-Readable Error Codes
Every error thrown by the GraphQL server uses standardized, machine-readable codes:
| Error Code | Description |
|---|---|
| `VALIDATION_ERROR` | Empty or whitespace-only inputs (title, description, comment content, user registration fields) |
| `INVALID_STATUS_TRANSITION` | Attempting a forbidden status transition (e.g. moving a `CLOSED` ticket or moving `IN_PROGRESS` to `OPEN`) |
| `USER_NOT_FOUND` | Assigning a ticket to a non-existent user ID or logging in with an unknown email |
| `TICKET_NOT_FOUND` | Mutating a ticket that does not exist in the database |
| `UNAUTHORIZED` | Performing an authenticated action without a valid JWT token |
| `FORBIDDEN` | Attempting an agent-only action with a reporter account |

---

## Environment Variables

Inside `backend/.env`:

```env
# Database connection string (PostgreSQL)
DATABASE_URL="postgresql://postgres:password@localhost:5432/support_ticket_db?schema=public"

# Optional: Dedicated test database for running integration tests
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/support_ticket_test_db?schema=public"

# JWT Signing secret
JWT_SECRET="your-super-secret-jwt-key"

# Configured business timezone
BUSINESS_TIMEZONE="Asia/Kolkata"

# Server Port
PORT=4000
```

---

## Setup & Database Instructions

From the root directory:

```bash
# 1. Install all monorepo dependencies
npm install

# 2. Sync database schema with PostgreSQL
npm run db:push --workspace=backend
npm run generate --workspace=backend

# 3. Seed demo data (users, holidays, tickets)
npm run seed --workspace=backend
```

---

## Running Backend & Frontend

### Option A: Running from root (both servers concurrently)
```bash
npm run dev
```

### Option B: Running in separate terminals

**Terminal 1 — Backend (GraphQL Yoga API):**
```bash
npm run dev --workspace=backend
```
- **GraphQL Endpoint & GraphiQL Explorer**: `http://localhost:4000/graphql`

**Terminal 2 — Frontend (Next.js):**
```bash
npm run dev --workspace=frontend
```
- **Web Dashboard**: `http://localhost:3000`

---

## Seed Accounts

Pre-populated for instant testing:
- **Agent User**: `agent@example.com` / `agent` (Role: `AGENT`)
- **Reporter User**: `reporter@example.com` / `reporter` (Role: `REPORTER`)

---

## Running Tests

Execute unit tests and database integration tests using Vitest:

```bash
# Run all unit tests (22 tests)
npm run test:unit --workspace=backend

# Run full test suite
npm run test --workspace=backend
```

### Test Coverage Summary:
- **22 Unit Tests (All Passing)**:
  - **SLA Engine (9 tests)**: Normal weekday, before business hours, after business hours, weekends, Friday evening rollover, holidays, multi-day SLAs, and SLA state thresholds (`ON_TRACK`, `AT_RISK`, `BREACHED`).
  - **Business Logic & Status Transitions (9 tests)**: Status transition state machine (`OPEN` &rarr; `IN_PROGRESS` &rarr; `RESOLVED` &rarr; `CLOSED`), illegal transition rejection, input validation (`VALIDATION_ERROR`), authorization guards (`FORBIDDEN`, `UNAUTHORIZED`), and first-response clock freezing.
  - **Cursor Pagination Mechanics (4 tests)**: First page cursor, next page cursor advancing, last page terminal check (`hasNextPage: false`), and empty dataset handling.
- **1 Persistence Integration Test**: Full ticket lifecycle against a dedicated test database (guarded with `TEST_DATABASE_URL` to ensure development/production data is never accidentally modified).

---

## Example GraphQL Queries & Mutations

### 1. Fetch Dashboard & Tickets
```graphql
query GetDashboardAndTickets {
  dashboard {
    openTickets
    inProgressTickets
    atRiskTickets
    breachedTickets
  }
  tickets(take: 10) {
    nodes {
      id
      title
      priority
      status
      sla {
        firstResponseDueAt
        resolutionDueAt
        firstResponseState
        resolutionState
        firstResponseRemainingMinutes
        resolutionRemainingMinutes
      }
    }
  }
}
```

### 2. Create Ticket
```graphql
mutation CreateTicket {
  createTicket(
    title: "Checkout failure on production"
    description: "Customers receiving 500 error on Stripe payment step"
    priority: URGENT
  ) {
    id
    title
    status
    sla {
      firstResponseDueAt
      resolutionDueAt
    }
  }
}
```

### 3. Add Agent Comment (Triggers First Response)
```graphql
mutation AddComment {
  addComment(
    ticketId: "<TICKET_ID>"
    content: "We are investigating the payment logs now."
  ) {
    id
    content
    createdAt
  }
}
```

### 4. Resolve Ticket
```graphql
mutation ResolveTicket {
  resolveTicket(ticketId: "<TICKET_ID>") {
    id
    status
    resolvedAt
  }
}
```

### 5. Register User
```graphql
mutation Register($name: String!, $email: String!, $password: String!, $role: UserRole!) {
  register(name: $name, email: $email, password: $password, role: $role) {
    token
    user {
      id
      name
      email
      role
    }
  }
}
```

### 6. Login
```graphql
mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    token
    user {
      id
      name
      email
      role
    }
  }
}
```

---

## How I'd Extend This

With more time, the following enhancements could be added:
1. **SLA Pausing (`WAITING_ON_CUSTOMER`)**: Add a ticket status that temporarily freezes SLA countdowns while waiting for customer feedback, resuming once the customer replies.
2. **Per-Team Business Calendars**: Support custom working hours (e.g. 24/7 coverage vs 8-hour regional teams) tied to specific departments.
3. **Escalation Triggers & Webhook Notifications**: Automated alerts to Slack or Email when a ticket reaches `AT_RISK` (>75% budget consumed).
4. **Audit Trail Log**: Append-only log recording every status change, assignment change, and SLA recalculation event for compliance.
5. **Agent Performance Analytics**: Dashboard metrics measuring average first-response time and percentage of SLAs met per agent.
