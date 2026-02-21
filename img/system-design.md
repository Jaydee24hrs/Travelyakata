# Omni-Channel Chat System (WhatsApp + Instagram + Facebook Messenger)

**Backend:** Django + DRF + (Channels)  
**Frontend:** **Next.js (recommended)** + TanStack React Query + Zod + Redux Toolkit  
**Database:** PostgreSQL  
**Async:** Celery + Redis  
**Storage:** S3-compatible (AWS S3 / Cloudflare R2 / MinIO)

This document describes an end-to-end architecture and implementation blueprint for a unified inbox that ingests messages from WhatsApp, Instagram DMs, and Facebook Messenger, normalizes them into a single conversation model, and streams updates to agents in real time. The frontend is built with Next.js using TanStack React Query for server-state, Zod for validation, Redux Toolkit for client-only state, and a secure JWT-based authentication system with refresh tokens.

---

## 1) Product Overview (Expanded Scope)

### MVP capabilities

- Connect channels:
  - **WhatsApp** via Meta WhatsApp Business Platform (Cloud API)
  - **Instagram** via Instagram Messaging API (Business/Creator accounts)
  - **Facebook Messenger** via Messenger Platform
- Ingest inbound messages via **webhooks**
- Normalize messages into a single **Conversation + Message** model
- Agent web app:
  - Unified inbox
  - Conversation view
  - Reply to messages (send back to the correct channel)
- Real-time updates (new messages appear instantly without refresh)
- Basic assignment + status:
  - open / pending / resolved
  - assigned to agent/team
- Authentication & authorization:
  - login/logout
  - roles/permissions (RBAC)
  - tenant isolation (org boundaries)

### Phase 2 features (near-term)

- Teams, routing rules, SLAs, working hours
- Templates / canned responses
- Internal notes, @mentions, tags
- Attachments, voice notes, link previews
- Search, filters, customer profile
- Audit logs and analytics
- Presence/typing indicators (optional)

### Phase 3 features (enterprise)

- Multi-tenant (many companies)
- Role-based access + permissions (granular)
- Data retention policies + export
- Webhook replay + dead-letter queue (DLQ)
- Observability, rate-limits, compliance

---

## 2) High-Level Architecture

### Key idea

Use **event-driven ingestion** so webhook requests are fast and reliable, then push updates to the UI via **WebSockets** (or SSE) after persistence. Use **TanStack React Query** for server state, **Redux Toolkit** for client-only state, and **Zod** to validate all REST and WebSocket payloads.

### Components

1. **API Gateway / Edge**
   - Nginx/Cloudflare/ALB
   - Terminates TLS, forwards to Django and Next.js
   - WAF + rate limiting (especially for webhooks)

2. **Django Backend (REST + Webhooks + Admin)**
   - DRF for API
   - Dedicated webhook endpoints for Meta channels
   - Outbound send endpoints (reply to WhatsApp/IG/Messenger)
   - Auth (JWT access token + HttpOnly refresh cookie), RBAC
   - Multi-tenant boundaries (recommended from day 1)

3. **Async Processing**
   - **Celery** workers (or Dramatiq)
   - **Redis** as broker + cache (RabbitMQ/Kafka if heavier duty)
   - Jobs: validate payload, fetch media, normalize, dedupe, persist, emit events, retry outbound sends

4. **PostgreSQL**
   - Source of truth (messages, conversations, users, channel connections)
   - Indexes for search and inbox filtering
   - Optional: partition messages table later

5. **Realtime Layer**
   - Django Channels (WebSockets) OR a separate Node WS server
   - Redis Pub/Sub for fanout between workers and WS layer
   - Presence/typing indicators (optional)

6. **Frontend (Next.js Recommended)**
   - **TanStack React Query**: server-state caching, pagination, optimistic updates
   - **Zod**: validate REST responses + WS events, schema-driven DTOs
   - **Redux Toolkit**: drafts, UI layout, websocket status, local upload queue
   - **react-hook-form + zodResolver** for validated forms
   - Real-time subscription (WS) + Query cache patching

7. **Object Storage**
   - S3-compatible storage for attachments
   - Store media after downloading from Meta (URLs can expire)

8. **Observability**
   - Sentry for errors (backend + frontend)
   - Prometheus/Grafana (optional)
   - Structured logging (JSON) + request IDs

---

## 3) External Integrations (Meta) — How It Works

All three channels come through **Meta webhooks**, but with different payload shapes and permissions.

- **Webhooks:** Meta calls your public HTTPS endpoint(s).
- Respond fast (within seconds). **Queue work** and immediately return `200 OK`.
- Outbound replies go from your backend to:
  - WhatsApp Cloud API send endpoints
  - Messenger Send API
  - Instagram Messaging send endpoints (via Graph API)

---

## 4) Data Model (Normalized)

### Tenancy / org

- `Organization`
- `OrgUser` (role: owner/admin/agent/viewer)
- `Team`

### Channel connections

- `ChannelAccount`
  - `org_id`
  - `channel_type`: `whatsapp | instagram | messenger`
  - `meta_page_id` / `ig_account_id` / `wa_phone_number_id`
  - `access_token` (encrypted)
  - `status`, webhook subscription metadata

### Customers & identities

- `Customer`
  - `org_id`
  - `display_name`, `created_at`
- `CustomerIdentity`
  - `customer_id`
  - `channel_type`
  - `external_user_id` (PSID / IG user id / WhatsApp `wa_id`)
  - Profile fields

### Conversations & messages

- `Conversation`
  - `org_id`
  - `channel_account_id`
  - `customer_id`
  - `status` (`open/pending/resolved`)
  - `assigned_to`
  - `last_message_at`, `last_message_preview`
- `Message`
  - `conversation_id`
  - `direction`: `inbound | outbound`
  - `channel_message_id` (idempotency key)
  - `message_type`: `text | image | video | audio | file | location | reaction`
  - `body_text`
  - `media_id` / `attachment_url`
  - `sent_at` (channel timestamp), `received_at`, `created_at`
  - `delivery_status` (`queued/sent/delivered/read/failed`)
- `MessageEvent` (optional)
  - `message_id`
  - `event_type`: `delivered/read/failed`
  - `payload`

### Audit / notes

- `ConversationNote`
- `AuditLog`

**Critical:** add a unique constraint on `(channel_type, channel_message_id)` to prevent duplicates from webhook retries.

---

## 5) Message Flows (End-to-End)

### Inbound message (Meta → You → Agent UI)

1. Meta calls `POST /webhooks/meta` with payload.
2. Django verifies:
   - signature (e.g., `X-Hub-Signature`)
   - the page/phone/account IDs map to a registered `ChannelAccount`
3. Django enqueues `process_inbound_event(payload)` and returns `200`.
4. Worker:
   - normalizes payload into internal schema
   - upserts `CustomerIdentity` + `Customer`
   - finds/creates `Conversation`
   - inserts `Message`
   - downloads media → stores in S3 → updates message
   - publishes realtime event: `conversation.updated` / `message.created`
5. WebSocket server pushes updates to subscribed clients:
   - inbox list updates
   - conversation thread appends new message
6. Next.js client:
   - validates WS event with **Zod**
   - patches TanStack Query cache (append message, reorder conversation preview)

### Outbound reply (Agent UI → Your backend → Meta → Customer)

1. Agent sends reply in UI.
2. Frontend calls `POST /api/conversations/:id/messages`.
3. Django writes `Message(direction=outbound, delivery_status=queued)`.
4. Worker sends via channel adapter:
   - WhatsApp send API OR Messenger OR Instagram
5. On success:
   - update `delivery_status` to `sent` (and later `delivered/read` if supported)
   - store `channel_message_id`
   - publish realtime update
6. Frontend:
   - optimistic UI uses a `temp_id`
   - WS `message.updated` reconciles temp message → real message id/status
7. Delivery/read receipts (if configured) arrive via webhook → update `MessageEvent`

---

## 6) Real-Time Architecture Options

### Option A (cleanest with Django): Django Channels

- Use `channels` + `channels_redis`
- WebSocket URL: `/ws/org/:org_id/?token=<access_token>`
- Auth via JWT (during WS handshake)
- Redis layer for horizontal scaling

**Pros:** single stack, fewer services  
**Cons:** requires careful scaling/ops (still very doable)

### Option B: Separate realtime service (Node)

- Django emits events to Redis PubSub
- Node WS server fans out to clients

**Pros:** very scalable, isolates websocket concerns  
**Cons:** more infrastructure and code paths

> Recommendation: **Option A** unless you anticipate very high concurrency early.

---

## 7) Frontend Standards (Next.js + TanStack Query + Zod + Redux)

### Next.js (App Router)

- App shell, routing, layout, auth-gated pages
- SSR where useful (initial inbox list), client components for realtime thread

### TanStack React Query (Server State)

- Queries:
  - conversations list (keyed by filters)
  - conversation detail
  - messages (infinite query with cursor pagination)
  - /me (user/org/permissions)
- Mutations:
  - send message (optimistic)
  - assign conversation
  - change status
- WS-driven cache updates:
  - append messages
  - patch delivery status
  - reorder inbox previews

### Zod (Validation)

- Validate:
  - all REST responses (DTO parsing)
  - all WS event payloads
  - all outbound payloads (forms, message sends)
- Use schema-first approach to generate types:
  - `type Conversation = z.infer<typeof ConversationSchema>`

### Redux Toolkit (Client-only State)

- Drafts per conversation
- UI layout state (sidebar open/closed, selected conversation)
- WebSocket connection status
- Local upload queue + progress (optional)
- Presence/typing (optional)

### Recommended supporting libraries

- `react-hook-form` + `@hookform/resolvers/zod`
- `date-fns`
- `clsx` + `tailwind-merge` (if using Tailwind)
- `Sentry` (frontend)
- Toast system (e.g., sonner) for consistent UX

---

## 8) Authentication & Authorization (Included)

### Token model (recommended)

- **Access token (JWT):** short-lived (5–15 minutes)
- **Refresh token:** stored as **HttpOnly cookie** (7–30 days)
- Access token stored in Redux/memory (not localStorage unless you accept higher risk)

### Auth endpoints

- `POST /auth/login` → returns `{ accessToken }` + sets refresh cookie
- `POST /auth/refresh` → returns `{ accessToken }`
- `POST /auth/logout` → clears/invalidates refresh cookie
- `GET /me` → returns user/org/roles/permissions

### Frontend auth behavior

- All API calls include `Authorization: Bearer <accessToken>`
- On 401:
  - run a **single-flight refresh mutex**
  - retry the original request
- WebSocket handshake includes `token=<accessToken>`
- If WS auth fails:
  - refresh access token
  - reconnect WS automatically

### RBAC (authorization)

- Backend enforces permissions per org/user:
  - view conversations
  - reply to conversations
  - assign conversations
  - manage channels (admin-only)
- Frontend uses `/me` permissions to show/hide actions but never relies on UI only

---

## 9) API Design (Core Endpoints)

### Auth / org

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `GET /orgs/:id/users`

### Inbox

- `GET /conversations?status=open&assigned_to=me&channel=whatsapp`
- `GET /conversations/:id`
- `POST /conversations/:id/assign`
- `POST /conversations/:id/status`

### Messages

- `GET /conversations/:id/messages?cursor=...`
- `POST /conversations/:id/messages` (text + attachments)

### Channels (admin)

- `POST /channels/connect`
- `GET /channels`
- `POST /channels/:id/test`
- `POST /webhooks/meta` (public)

---

## 10) Security & Reliability (Non-Negotiables)

- Verify webhook signatures (protect from spoofing)
- Encrypt channel tokens at rest (KMS or app-level encryption)
- Idempotency keys for inbound events (dedupe Meta retries)
- Retries with exponential backoff for outbound API failures
- Dead-letter queue for poison events
- Rate limiting per org/user and per channel
- PII controls: redact logs, protect attachments
- Full audit trail for agent actions (assignment/status/notes)

---

## 11) Deployment Architecture (Production-Ready)

### Minimal production footprint

- `web`: Django + DRF (gunicorn/uvicorn)
- `worker`: Celery workers
- `realtime`: Django Channels (or bundled early on)
- `postgres`: managed Postgres (RDS / Neon / Supabase, etc.)
- `redis`: managed Redis
- `storage`: S3/R2/MinIO
- `nginx`: reverse proxy (or managed load balancer)
- `frontend`: Next.js (Node runtime) or built static + API routed to Django

### Environments

- dev (local docker-compose)
- staging (replica of prod)
- prod

### CI/CD

- GitHub Actions:
  - tests + lint
  - build images
  - run migrations
  - deploy

---

## 12) Implementation Plan (Start-to-Finish)

### Phase 0 — Foundations (Week 1)

- Repo layout (monorepo or separate)
- Docker Compose: Postgres + Redis + Django + Worker + Next
- Base models: Org, Users, Conversations, Messages
- Auth + RBAC (login/refresh/logout + /me)

### Phase 1 — One channel end-to-end (Week 2–3)

Start with **Facebook Messenger** (often easiest to test).

- Webhook verification + ingestion
- Normalize + persist + realtime updates
- UI inbox + conversation + send reply
- TanStack Query + WS event router + optimistic send

### Phase 2 — WhatsApp (Week 4)

- WhatsApp phone number setup
- Template message handling (WA rules)
- Media download pipeline

### Phase 3 — Instagram (Week 5)

- IG permissions + app review considerations
- DM ingestion + replies

### Phase 4 — Hardening (Week 6+)

- retries, DLQ, replay tooling
- search & filtering
- analytics, audit logs
- multi-tenant polish, rate limits

---

## 13) Recommended Repo Structure

### backend/

- `apps/core` (org/users/permissions)
- `apps/channels` (channel accounts, adapters)
- `apps/inbox` (conversations/messages)
- `apps/webhooks` (meta webhook endpoints)
- `apps/realtime` (channels groups/events)
- `apps/media` (attachment storage)
- `workers/` (celery tasks)

### frontend/

- `app/` (Next.js routes)
- `components/Inbox/`
- `lib/api/` (fetch client + TanStack hooks)
- `lib/realtime/` (ws client + event router)
- `schemas/` (zod DTOs)
- `store/` (redux slices)

---

## 14) Key Design Decisions to Lock In Early

1. **Multi-tenancy:** build in now (`org_id` everywhere) even if only one org at first.
2. **Idempotency:** prevent duplicates from webhook retries.
3. **Media strategy:** always copy attachments to your own storage.
4. **Realtime contract:** define event types + payloads early (Zod validates).
5. **Outbound send as async:** never block UI waiting on Meta.
6. **State separation:** React Query = server state, Redux = client-only state.

---

# System Design — Visual (Markdown)

> A markdown-friendly “diagram” of the omni-channel chat architecture.

---

## 1) High-Level Architecture (Component View)

```text
                        ┌──────────────────────────────┐
                        │     Meta Platforms (APIs)    │
                        │  WhatsApp | Instagram | FB   │
                        └───────────────┬──────────────┘
                                        │ Webhooks (HTTPS)
                                        ▼
                         ┌─────────────────────────────┐
                         │   Edge / Gateway (Nginx/ALB)│
                         │ TLS termination + routing   │
                         └───────────────┬─────────────┘
                                         │
                                         ▼
              ┌─────────────────────────────────────────────────┐
              │              Django Backend (DRF)               │
              │  - Webhook endpoints (/webhooks/meta)           │
              │  - REST APIs (/api/...)                         │
              │  - Auth (JWT + refresh cookie), RBAC            │
              │  - Admin/Channel setup                          │
              └───────────────┬───────────────────┬─────────────┘
                              │                   │
                              │ enqueue jobs       │ REST/HTTPS
                              ▼                   ▼
                  ┌──────────────────────┐   ┌────────────────────────┐
                  │   Queue/Broker       │   │  Frontend (Next.js)     │
                  │     Redis            │   │  - TanStack Query       │
                  └───────────┬──────────┘   │  - Zod validation       │
                              │              │  - Redux (drafts/UI)    │
                              ▼              └─────────┬───────────────┘
                 ┌────────────────────────┐             │ WebSocket
                 │   Celery Workers       │             ▼
                 │ - normalize payloads   │   ┌────────────────────────┐
                 │ - dedupe/idempotency   │   │ Realtime (Channels)     │
                 │ - persist messages     │   │ - WS connections        │
                 │ - media download → S3  │   │ - Redis fanout          │
                 │ - send outbound msgs   │   └─────────┬───────────────┘
                 └───────────┬────────────┘             │ publish events
                             │                          │ (Redis Pub/Sub)
                             ▼                          ▼
                 ┌────────────────────────┐    ┌────────────────────────┐
                 │      PostgreSQL        │    │         Redis           │
                 │  source of truth       │    │ pub/sub, cache, broker  │
                 └───────────┬────────────┘    └────────────────────────┘
                             │
                             ▼
                 ┌────────────────────────┐
                 │   Object Storage (S3)  │
                 │  attachments/media     │
                 └────────────────────────┘
```
