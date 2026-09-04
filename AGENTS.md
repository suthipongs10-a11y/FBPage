# AGENTS.md — Facebook AI Page Manager / AI Marketing Manager

> **Purpose:** This file is the primary implementation guide for all coding agents working on this repository.
> Read this entire document before creating, modifying, or refactoring any production code.

---

# 1. Project Mission

Build a **multi-tenant Facebook AI Page Manager SaaS** that can also be used internally as an agency operating system.

The product must combine:

- Facebook / Meta API integration
- AI agents
- content planning and generation
- approval workflows
- publishing and scheduling
- page analytics
- comment / inbox intelligence
- lead detection
- reporting
- automation
- optional Ads intelligence
- pluggable AI providers

The product is **not** merely a social media scheduler.

The core product idea is:

> **Read real Facebook data → analyze it → decide what to do → create content → request approval when required → publish → measure results → learn → improve the next cycle.**

The long-term product positioning is:

> **AI Marketing Manager for Facebook Pages**

The first commercial use case is:

> Enable one operator or a small agency team to manage many client Facebook Pages with far less manual work.

---

# 2. Product Principles

Every implementation decision must follow these principles.

## 2.1 Dashboard-first, Chat-assisted

The product is primarily a **Dashboard SaaS**.

Chat is an embedded **AI Command Center**, not the whole product.

Use the Dashboard for:

- clients
- brands
- pages
- analytics
- posts
- calendar
- approvals
- comments
- leads
- reports
- automation
- AI usage
- settings
- audit history

Use Chat / Command Center for flexible instructions such as:

- "Analyze this Page for the last 90 days."
- "Create next week's content plan."
- "Find customer pain points from comments."
- "Create 3 posts about our wedding equipment rental."
- "Why did this post perform better?"
- "Turn this successful post into a Reel concept."
- "Prepare next month's strategy."

AI responses should be able to create structured objects in the product, not only text messages.

Examples:

- create drafts
- create content plan
- create calendar items
- create recommendations
- create reports
- create approval requests

---

# 3. Critical Architecture Rule

Do **NOT** build:

```text
Dashboard → OpenAI → Facebook
```

Build:

```text
Dashboard
   │
   ├── AI Command Center
   ├── Manual Dashboard Actions
   └── Automation Rules
            │
            ▼
     Agent Orchestrator
            │
     ┌──────┴────────┐
     ▼               ▼
 AI Gateway      Tool Registry
     │               │
     ▼               ▼
AI Providers     Internal Services
                     │
              ┌──────┼─────────┐
              ▼      ▼         ▼
          Facebook  Research  Media
          Service   Service   Service
              │
              ▼
        Meta Graph APIs
```

---

# 4. Never Lock the Product to One AI Vendor

AI providers must be replaceable.

Supported architecture:

```text
AI Gateway
├── OpenAI Adapter
├── Anthropic Adapter
├── Gemini Adapter
├── OpenRouter Adapter
├── LiteLLM Adapter
└── Future Provider Adapter
```

The application must depend on an internal interface, never directly on one provider SDK throughout the codebase.

Example internal interface:

```ts
interface AIProvider {
  generateText(input: GenerateTextInput): Promise<AITextResult>;
  generateStructured<T>(input: StructuredInput<T>): Promise<T>;
  analyze(input: AnalyzeInput): Promise<AnalysisResult>;
  executeTools(input: ToolExecutionInput): Promise<ToolExecutionResult>;
  analyzeImage?(input: VisionInput): Promise<VisionResult>;
}
```

Provider-specific code belongs only inside provider adapters.

---

# 5. AI Routing

The platform must support different models for different jobs.

Example roles:

| AI Role | Typical Task |
|---|---|
| Strategy Model | complex reasoning and planning |
| Content Model | captions, posts, hooks, CTA |
| Analysis Model | page and post analytics |
| Community Model | comment classification and replies |
| Research Model | topic research and source synthesis |
| Vision Model | image / creative analysis |
| Fast Model | simple formatting and classification |
| Fallback Model | provider outage / rate limit fallback |

The router should eventually support:

```text
Task Complexity
   ↓
Provider / Model Selection
   ↓
Budget Check
   ↓
Execute
   ↓
Quality Check
   ↓
Fallback if required
```

Do not use the most expensive model for every task.

---

# 6. Recommended Technology Stack

Use a TypeScript-first stack unless there is a strong technical reason not to.

## Frontend

- Next.js
- TypeScript
- Tailwind CSS
- component system with accessible reusable primitives
- TanStack Query or equivalent server-state layer
- charting library for analytics
- responsive desktop / tablet / mobile UI

## Backend

- NestJS
- TypeScript
- REST API initially
- OpenAPI documentation
- WebSocket / SSE only where real-time UX materially benefits

## Database

- PostgreSQL
- Prisma or another mature typed ORM
- pgvector for embeddings / brand memory when required

## Queue / Jobs

- Redis
- BullMQ

## Storage

Use S3-compatible object storage for:

- generated images
- uploaded assets
- reports
- videos
- post creatives

## AI

- internal AI Gateway
- provider adapters
- optional LiteLLM proxy
- structured JSON outputs
- tool calling
- retry / fallback policies

## Facebook

- Meta Graph API as core integration
- Messenger APIs where required
- Marketing API in later phase
- Webhooks
- MCP exposed as an **agent interface**, not as the core Facebook integration

## Deployment

Target:

- Ubuntu VPS
- Docker
- Docker Compose for initial production
- reverse proxy such as Caddy or Nginx
- HTTPS
- environment-based configuration

---

# 7. Repository Structure

Recommended monorepo:

```text
/
├── AGENTS.md
├── README.md
├── docker-compose.yml
├── .env.example
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   ├── hooks/
│   │   └── lib/
│   │
│   └── api/
│       ├── src/
│       │   ├── auth/
│       │   ├── tenants/
│       │   ├── clients/
│       │   ├── brands/
│       │   ├── facebook/
│       │   ├── content/
│       │   ├── analytics/
│       │   ├── comments/
│       │   ├── leads/
│       │   ├── approvals/
│       │   ├── reports/
│       │   ├── automation/
│       │   ├── ai/
│       │   ├── billing/
│       │   ├── audit/
│       │   └── health/
│       └── test/
│
├── workers/
│   ├── scheduler/
│   ├── analytics/
│   ├── content/
│   ├── webhooks/
│   └── reports/
│
├── packages/
│   ├── shared/
│   ├── database/
│   ├── ai-core/
│   ├── ai-providers/
│   ├── facebook-core/
│   ├── tool-registry/
│   ├── validation/
│   └── ui/
│
├── services/
│   └── mcp-server/
│
└── docs/
    ├── architecture/
    ├── api/
    ├── facebook/
    ├── ai/
    └── runbooks/
```

---

# 8. Multi-Tenant Data Model

The SaaS must be multi-tenant from day one.

Basic hierarchy:

```text
User
  ↓
Workspace / Tenant
  ↓
Client
  ↓
Brand
  ↓
Facebook Page
```

A workspace may be:

- internal agency
- independent marketer
- external agency
- individual business

A client may own multiple brands.

A brand may have multiple connected social accounts in the future.

Do not assume one Facebook Page per account.

---

# 9. Core Database Entities

At minimum define the following entities.

## Identity

### User

- id
- email
- name
- avatar
- status
- createdAt
- updatedAt

### Workspace

- id
- name
- slug
- plan
- status
- timezone
- createdAt

### WorkspaceMember

- workspaceId
- userId
- role
- permissions

Roles:

- owner
- admin
- manager
- editor
- reviewer
- analyst
- viewer

---

## Client / Brand

### Client

- id
- workspaceId
- name
- contactName
- email
- phone
- notes
- status

### Brand

- id
- clientId
- name
- description
- industry
- targetAudience
- toneOfVoice
- preferredLanguage
- serviceArea
- primaryCTA
- website
- knowledgeBaseStatus

---

## Brand Knowledge

### BrandKnowledgeItem

- id
- brandId
- type
- title
- content
- source
- metadata
- embedding
- active

Possible types:

- business_info
- product
- service
- faq
- price
- location
- policy
- brand_voice
- prohibited_claim
- customer_persona
- past_campaign

The AI must use brand knowledge before generating customer-facing content.

---

# 10. Facebook Entities

### FacebookConnection

- id
- workspaceId
- userId
- providerUserId
- encryptedAccessToken
- tokenExpiresAt
- scopes
- status
- lastValidatedAt

### FacebookPage

- id
- brandId
- connectionId
- facebookPageId
- name
- username
- category
- pictureUrl
- pageAccessTokenEncrypted
- tokenStatus
- connectedAt
- lastSyncedAt

### FacebookPost

- id
- facebookPageId
- facebookPostId
- message
- mediaType
- permalink
- publishedAt
- source
- rawData
- syncStatus

### PostMetricSnapshot

- id
- postId
- capturedAt
- metrics
- apiVersion

Never design analytics around one fixed Facebook metric schema.

Store metric payloads flexibly because Meta can rename, remove, or replace metrics.

Create a metric adapter layer.

---

# 11. Facebook Integration Rules

Meta Graph APIs are the source of truth for Facebook operations.

Do not make a third-party Facebook MCP server the only integration path.

Implement an internal:

```text
FacebookService
```

Example interface:

```ts
interface FacebookService {
  listPages(userId: string): Promise<FacebookPageSummary[]>;
  getPage(pageId: string): Promise<FacebookPageDetails>;
  getPosts(pageId: string, options?: GetPostsOptions): Promise<PagePost[]>;
  getPost(postId: string): Promise<PagePost>;
  getPostInsights(postId: string, range?: DateRange): Promise<PostInsights>;
  getPageInsights(pageId: string, range: DateRange): Promise<PageInsights>;
  getComments(objectId: string, options?: CommentOptions): Promise<Comment[]>;
  createPost(pageId: string, input: CreatePostInput): Promise<PublishResult>;
  createPhotoPost(pageId: string, input: PhotoPostInput): Promise<PublishResult>;
  createVideoPost(pageId: string, input: VideoPostInput): Promise<PublishResult>;
  schedulePost(pageId: string, input: SchedulePostInput): Promise<PublishResult>;
  deletePost(postId: string): Promise<void>;
  replyToComment(commentId: string, message: string): Promise<CommentReplyResult>;
}
```

Later interfaces:

```ts
MessengerService
MarketingService
```

---

# 12. Meta Permissions Strategy

Do not request every permission immediately.

Request only what each product phase needs.

Expected Page-related permissions may include permissions such as:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `pages_manage_engagement`
- `pages_read_user_content`
- `read_insights`

Messenger capabilities may require:

- `pages_messaging`

Marketing capabilities may require:

- `ads_read`
- `ads_management`
- other Meta business permissions depending on implementation

**Important:** Meta permissions, review requirements, Graph API versions, and available metrics change over time.

Before submitting Meta App Review:

1. verify every permission against current official Meta documentation
2. document why the app needs it
3. implement least-privilege access
4. implement deletion / disconnect flows
5. prepare screencasts required by App Review
6. verify whether Business Verification is required

Never ship new Meta permissions based only on old documentation.

---

# 13. Token Security

Facebook tokens are secrets.

Requirements:

- encrypt tokens at rest
- never log full tokens
- redact tokens from errors
- restrict production database access
- rotate application secrets when compromised
- track token expiry
- validate token status periodically
- surface token health in Dashboard
- notify operator when reconnect is required

UI status example:

```text
Facebook Connection
● Healthy

Page Token
● Valid

Last checked
3 hours ago
```

Error example:

```text
⚠ Facebook access expired.
Reconnect this Page before scheduled publishing can continue.
```

---

# 14. Webhooks

Prefer webhooks where Meta provides them.

Webhook processing architecture:

```text
Meta
 ↓
Webhook Endpoint
 ↓
Signature Verification
 ↓
Event Normalization
 ↓
Queue
 ↓
Event Processor
 ↓
AI / Rules / Database
```

Never execute expensive AI tasks directly inside the webhook HTTP request.

Acknowledge webhook quickly, then process asynchronously.

Events should be normalized into internal event types.

Example:

```ts
type SocialEvent =
  | { type: "COMMENT_CREATED"; ... }
  | { type: "MESSAGE_RECEIVED"; ... }
  | { type: "POST_UPDATED"; ... }
  | { type: "TOKEN_ERROR"; ... };
```

---

# 15. MCP Strategy

MCP is an agent-access interface.

Architecture:

```text
FacebookService
    │
    ├── Internal REST / service calls
    └── MCP tools
```

MCP tools should call internal services.

Do not duplicate business logic inside MCP handlers.

Example MCP tools:

```text
facebook.list_pages
facebook.get_page
facebook.get_posts
facebook.get_post_insights
facebook.get_comments
facebook.create_draft
facebook.publish_post
facebook.schedule_post
facebook.reply_comment
analytics.analyze_page
content.create_plan
content.create_post
approval.request
```

Every write-capable MCP tool must check:

- workspace
- user
- role
- page ownership
- automation level
- approval policy

---

# 16. Agent System

Agents are logical roles.

Do not necessarily deploy each agent as a separate microservice.

Start as modules sharing one orchestrator.

---

# 17. Agent: Orchestrator

The Orchestrator is the brain of the workflow.

Responsibilities:

- interpret user intent
- determine required data
- decide which tools to call
- choose AI role/model
- enforce permissions
- enforce approval policies
- create jobs
- return structured results
- stop unsafe / unauthorized actions

Example:

User:

```text
Analyze the last 60 days and prepare next week's posts.
```

Orchestrator:

```text
1. Resolve workspace + Page
2. Fetch posts
3. Fetch metrics
4. Fetch comments if permitted
5. Send normalized data to Analyst Agent
6. Send insights to Strategist Agent
7. Generate content plan
8. Generate drafts
9. Store drafts
10. Create approval batch
11. Report completion
```

---

# 18. Agent: Strategist

Responsibilities:

- understand business goals
- identify content pillars
- define posting strategy
- propose content mix
- recommend campaign themes
- use historical Page performance
- use customer interests
- compare content categories
- create weekly / monthly plans

Structured output example:

```json
{
  "objective": "increase qualified inquiries",
  "contentPillars": [
    "customer proof",
    "service education",
    "before-after",
    "offer"
  ],
  "recommendedMix": {
    "customerProof": 0.30,
    "education": 0.30,
    "beforeAfter": 0.25,
    "offer": 0.15
  }
}
```

Do not allow free-form strategy text to be the only stored output.

---

# 19. Agent: Analyst

Responsibilities:

- analyze Page performance
- rank posts
- identify high-performing themes
- compare content types
- detect trends
- detect unusual performance
- summarize metric changes
- generate actionable recommendations

Analyst output must distinguish:

- observed data
- AI inference
- recommendation

Example:

```text
Observed:
Customer testimonial posts received 2.1x median comment rate.

Inference:
Social proof appears more relevant to current audience.

Recommendation:
Publish 2 additional customer-case posts next week.
```

Never present inference as measured fact.

---

# 20. Agent: Content Creator

Responsibilities:

- captions
- hooks
- CTA
- FAQ posts
- promotional posts
- educational posts
- story/reel scripts
- rewrite
- localization

Inputs must include:

- brand knowledge
- brand voice
- objective
- platform
- target audience
- content pillar
- historical insights
- prohibited claims
- CTA
- language

Output should be structured.

Example:

```json
{
  "headline": "...",
  "caption": "...",
  "cta": "...",
  "hashtags": [],
  "mediaBrief": "...",
  "contentPillar": "customer_proof"
}
```

---

# 21. Agent: Creative Director

Responsibilities:

- create image brief
- analyze existing creative
- propose visual direction
- produce image-generation prompt
- produce Reel storyboard
- check brand consistency

Do not directly publish generated visual content without applying the workspace approval policy.

---

# 22. Agent: Researcher

Responsibilities:

- research current topics
- verify facts
- find content opportunities
- summarize sources
- identify industry trends
- provide evidence to Content Agent

Research output should retain:

- source
- URL or source identifier
- date
- extracted claim
- confidence

Do not mix unverified web information into customer-facing content silently.

---

# 23. Agent: Community Manager

Responsibilities:

- classify comments
- identify question type
- draft replies
- detect complaints
- detect spam
- detect potential leads
- escalate sensitive conversations

Comment classifications:

```text
QUESTION
LEAD
COMPLAINT
PRAISE
SPAM
PRICE_QUERY
LOCATION_QUERY
SERVICE_QUERY
OTHER
```

Default behavior:

```text
AI drafts reply → human approval
```

Full auto replies must be explicitly enabled.

---

# 24. Agent: Lead Detector

Responsibilities:

Extract useful lead information from comments / messages.

Potential fields:

- name
- intent
- product
- service
- quantity
- requestedDate
- location
- budget
- phone
- urgency
- confidence
- leadScore

Example:

```json
{
  "intent": "rental",
  "service": "table rental",
  "quantity": 30,
  "requestedDate": "2026-09-18",
  "leadScore": 92,
  "confidence": 0.91
}
```

Never fabricate missing contact information.

---

# 25. Agent: Reviewer / QA

Before an AI-generated post reaches Ready state, Reviewer checks:

- factual consistency
- brand voice
- prohibited claims
- duplicate content
- obvious hallucination
- CTA correctness
- pricing consistency
- contact details
- language quality
- policy flags

Result:

```text
PASS
NEEDS_REVISION
BLOCKED
```

---

# 26. Ads Agent — Later Phase

Do not build fully autonomous ad spending in MVP.

Ads Agent eventually supports:

- read campaign performance
- identify weak creatives
- identify strong organic posts
- recommend promotion
- create campaign draft
- create ad set draft
- create creative draft
- propose budget
- monitor performance

Any action spending money must default to:

```text
Approval Required
```

Examples:

- launching campaign
- increasing budget
- changing bid
- expanding targeting

---

# 27. Automation Levels

Every Page must have an explicit automation level.

## Level 1 — Read Only

AI may:

- read
- analyze
- recommend

AI may not create or publish.

## Level 2 — Auto Draft

AI may:

- create plans
- create drafts
- create media briefs
- prepare replies

No publishing.

## Level 3 — Approval Required

Recommended default.

AI may:

- create content
- prepare calendar
- schedule draft actions

Human must approve publication.

## Level 4 — Full Auto

AI may publish content under configured rules.

Must support:

- allowed days
- allowed time windows
- daily post maximum
- content categories allowed
- excluded topics
- emergency kill switch

## Money Actions

Always treated separately.

MVP default:

```text
MANUAL_APPROVAL_ONLY
```

---

# 28. Content Status Lifecycle

Use explicit states.

```text
IDEA
↓
PLANNED
↓
DRAFT
↓
AI_REVIEW
↓
NEEDS_REVISION
↓
READY_FOR_APPROVAL
↓
APPROVED
↓
SCHEDULED
↓
PUBLISHING
↓
PUBLISHED
↓
ANALYZED
```

Failure states:

```text
REJECTED
PUBLISH_FAILED
CANCELLED
```

Never infer status solely from timestamps.

---

# 29. Approval System

Approval is a core product feature.

### ApprovalRequest

- id
- workspaceId
- resourceType
- resourceId
- requestedBy
- requestedAt
- status
- reviewedBy
- reviewedAt
- reviewerComment

Possible status:

```text
PENDING
APPROVED
REJECTED
CHANGES_REQUESTED
EXPIRED
```

All approval actions must be audit logged.

---

# 30. Core Workflow — Page Onboarding

```text
Create Client
↓
Create Brand
↓
Enter Business Knowledge
↓
Connect Facebook
↓
Choose Page
↓
Validate Permissions
↓
Initial Data Sync
↓
Analyze Historical Posts
↓
Generate Baseline Report
↓
Configure Content Strategy
↓
Configure Automation Level
↓
Ready
```

The initial analysis should produce a useful result immediately after connection.

---

# 31. Core Workflow — Weekly Content Loop

```text
Load Brand Context
↓
Load Historical Performance
↓
Load Recent Posts
↓
Load Customer Insights
↓
Optional Research
↓
Strategist creates weekly plan
↓
Content Agent creates drafts
↓
Creative Agent creates media briefs/assets
↓
Reviewer checks content
↓
Approval Queue
↓
Approved posts scheduled
↓
Facebook Publish
↓
Metrics collected
↓
Analyst updates learnings
```

---

# 32. Core Workflow — High Performing Post

```text
Metrics Collector
↓
Detect outperforming post
↓
Analyst
↓
Recommendation
↓
Create follow-up content
```

Possible recommendation:

```text
This customer review post has 2.8x the median engagement rate.
Create two additional proof-based posts.
```

Later:

```text
Recommend ad promotion
```

---

# 33. Core Workflow — Comment Intelligence

```text
New Comment
↓
Webhook
↓
Store Comment
↓
Classification
↓
Lead Detection
↓
Sentiment / Risk
↓
Draft Reply
↓
Approval or Auto Reply
↓
Customer Insight Aggregation
```

Comment insights should feed the content strategy.

Example:

```text
34% price questions
22% service-area questions
19% product availability questions
```

Output:

```text
Recommendation:
Create a Pricing FAQ and Service Area post this week.
```

---

# 34. Core Workflow — Monthly Report

Monthly report should answer:

1. What happened?
2. Why might it have happened?
3. Which content performed best?
4. Which content performed poorly?
5. What questions did customers ask?
6. What leads were detected?
7. What should change next month?
8. What content should be repeated?
9. What should be stopped?
10. What experiments should be run?

Report components:

- executive summary
- Page growth / relevant Page metrics
- publishing consistency
- top posts
- bottom posts
- content pillar performance
- comment insights
- lead summary
- AI recommendations
- next-month strategy

---

# 35. Dashboard Information Architecture

## Sidebar

```text
Overview
Clients
Pages
AI Command
Content
Calendar
Analytics
Comments
Leads
Reports
Automation
AI Models
Settings
```

Later:

```text
Ads
Inbox
Team
Billing
```

---

# 36. Overview Dashboard

Show actionable information, not decorative numbers.

Suggested cards:

- active clients
- connected Pages
- posts this month
- scheduled posts
- pending approvals
- unresolved comments
- leads detected
- publishing errors
- Facebook connection errors
- AI spend this month

Also show:

```text
Needs Attention
```

Examples:

- 4 posts waiting for approval
- 1 Facebook token requires reconnection
- 3 hot leads detected
- tomorrow has no scheduled content
- AI monthly budget is at 85%

---

# 37. AI Command Center

The command center should feel like a domain-specific ChatGPT connected to the operator's data.

Must support context selectors:

```text
Workspace
Client
Brand
Page
Date Range
```

Example commands:

```text
Analyze this Page for 90 days.
```

```text
Create next week's content.
```

```text
Find what customers ask most often.
```

```text
Create 3 posts based on the best-performing content category.
```

```text
Why did this post perform well?
```

```text
Show posts waiting for my approval.
```

```text
Prepare this month's client report.
```

The Agent must not silently change context from one client/Page to another.

---

# 38. Content Workspace

Views:

- Ideas
- Drafts
- Ready for approval
- Scheduled
- Published

Each content item should show:

- Page
- content type
- caption
- visual
- objective
- pillar
- schedule
- creator
- AI model
- status
- approval history
- performance after publication

---

# 39. Calendar

Must support:

- month
- week
- list

Calendar item:

- Page
- post type
- title
- status
- scheduled time
- thumbnail

Actions:

- preview
- edit
- approve
- reject
- reschedule
- cancel

Drag/drop is optional for MVP.

Reliable scheduling is more important than animation.

---

# 40. Analytics

Do not create a dashboard full of graphs without interpretation.

Every analytics section should ideally include:

```text
Data
+
Explanation
+
Recommendation
```

Example:

```text
Customer case-study posts:
2.1x median comment rate.

Recommendation:
Increase case-study frequency from 1 to 2 posts/week.
```

Support metric versioning because Meta changes metrics.

---

# 41. AI Models Settings

Workspace owner can configure models.

Example:

```text
Strategy
Provider: OpenAI
Model: <configured model>

Content
Provider: Google
Model: <configured model>

Comment Reply
Provider: OpenRouter
Model: <configured model>

Fallback
Provider: Anthropic
Model: <configured model>
```

Also configure:

- monthly AI budget
- max cost per task
- provider fallback
- timeout
- retry count

---

# 42. BYOK — Bring Your Own Key

Optional feature after MVP.

Workspace may use:

```text
Platform Managed Key
```

or:

```text
Customer API Key
```

Customer keys must:

- be encrypted
- never appear in client-side JavaScript
- never be logged
- support deletion
- support provider-specific validation

---

# 43. Tool Registry

AI tools should be centrally defined.

Example:

```ts
interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: unknown;
  requiredPermission?: string;
  riskLevel: "READ" | "WRITE" | "PUBLISH" | "MONEY";
  execute(context: ToolContext, input: TInput): Promise<TOutput>;
}
```

Tool Context must include:

```ts
interface ToolContext {
  userId: string;
  workspaceId: string;
  clientId?: string;
  brandId?: string;
  pageId?: string;
  requestId: string;
}
```

---

# 44. Tool Risk Levels

## READ

Examples:

- read posts
- read analytics
- read comments

May run without approval if user has permission.

## WRITE

Examples:

- create draft
- modify calendar
- generate report

Usually no publication impact.

## PUBLISH

Examples:

- publish post
- schedule post
- reply comment in full-auto mode

Must check Page automation policy.

## MONEY

Examples:

- launch ad
- increase budget

Requires explicit approval by default.

---

# 45. Internal API Design

Initial API categories:

```text
/auth
/workspaces
/clients
/brands
/facebook
/content
/calendar
/analytics
/comments
/leads
/approvals
/reports
/automation
/ai
/audit
```

Examples:

```text
POST /facebook/connect
GET  /facebook/pages
POST /facebook/pages/:id/sync

GET  /content
POST /content
POST /content/:id/approve
POST /content/:id/reject
POST /content/:id/schedule

POST /ai/command
GET  /ai/tasks/:id

GET  /analytics/pages/:id
POST /analytics/pages/:id/analyze

GET  /comments
POST /comments/:id/draft-reply

GET  /leads

GET  /approvals
POST /approvals/:id/approve
POST /approvals/:id/reject
```

Use idempotency keys for actions that can publish externally.

---

# 46. Background Jobs

Use jobs for:

- Facebook sync
- metric collection
- scheduled publishing
- video processing
- image processing
- AI generation
- report generation
- webhook processing
- token validation
- retry operations

Suggested queues:

```text
facebook-sync
facebook-publish
facebook-webhook
analytics
ai
media
reports
maintenance
```

Every job must be retry-safe.

---

# 47. Scheduling

Never depend only on browser timers.

Publishing schedule must run server-side.

Store:

- intended local time
- timezone
- normalized execution time
- status
- retry count

Use workspace / Page timezone explicitly.

Avoid timezone assumptions.

---

# 48. Idempotency

External publishing is high risk.

Before retrying a publish job:

- check whether a Facebook post was already created
- store external operation ID
- use idempotency record
- do not produce duplicate posts

Example table:

### ExternalOperation

- id
- provider
- operationType
- idempotencyKey
- requestHash
- externalId
- status
- createdAt

---

# 49. Audit Log

Audit logging is mandatory.

Log:

- login
- Page connection
- Page disconnect
- content generation
- content editing
- approval
- rejection
- scheduling
- publishing
- deletion
- comment reply
- automation change
- AI provider change
- token errors
- Ads actions

Audit record:

```text
who
what
resource
before
after
timestamp
requestId
```

Do not log secrets.

---

# 50. AI Task Logging

Every AI call should capture:

- task type
- provider
- model
- latency
- input token count if available
- output token count if available
- estimated cost
- success / failure
- retry
- workspace
- resource
- requestId

This enables future model-performance comparisons.

---

# 51. AI Performance Dataset

One long-term moat is learning:

```text
Which model
+
Which prompt
+
Which content pattern
+
Which business category
=
Best real-world Facebook result
```

Design the data model so this is possible later.

Do not train models automatically in MVP.

First collect clean structured metadata.

Useful fields:

- provider
- model
- promptVersion
- brandIndustry
- contentPillar
- postType
- generatedAt
- editedByHuman
- editDistance / revision status
- published
- measuredPerformance

---

# 52. Prompt Versioning

Prompts are production code.

Store prompt templates with versions.

Example:

```text
content-caption-v1
content-caption-v2
page-analysis-v1
comment-classifier-v3
```

An AI output should record the prompt version used.

Never silently replace production prompts without version history.

---

# 53. Brand Memory

AI must not rely only on chat history.

Use structured Brand Knowledge.

Possible context assembly:

```text
Business facts
+
Products/services
+
Pricing
+
FAQ
+
Voice
+
Audience
+
Past successful content
+
Current strategy
+
Prohibited claims
```

Only retrieve relevant knowledge for each task.

Avoid dumping the entire database into every prompt.

---

# 54. Safety and Hallucination Controls

For customer-facing content:

- do not invent prices
- do not invent promotions
- do not invent service areas
- do not invent phone numbers
- do not invent testimonials
- do not invent certifications
- do not invent medical/legal/financial claims
- do not invent product availability

If required information is absent:

```text
mark as missing
```

or produce:

```text
NEEDS_HUMAN_INPUT
```

---

# 55. Human Editing

Track human edits.

Useful future signal:

```text
AI Draft
↓
Human Edit
↓
Approved Version
```

Store revision history.

This allows the system to eventually learn the preferred brand style.

---

# 56. Security

Mandatory:

- secure password/auth provider
- secure session management
- CSRF protections where applicable
- server-side authorization
- workspace isolation
- database authorization checks
- rate limiting
- request validation
- encrypted secrets
- secure headers
- audit logs
- dependency scanning
- backups

Never rely on hidden frontend controls as authorization.

Backend must enforce permissions.

---

# 57. Tenant Isolation

Every query involving tenant data must be scoped by workspace.

Bad:

```ts
db.facebookPost.findMany({ where: { pageId } })
```

Better:

```ts
db.facebookPost.findMany({
  where: {
    pageId,
    page: {
      brand: {
        client: {
          workspaceId
        }
      }
    }
  }
})
```

Prefer centralized tenant-scoping helpers.

Write integration tests for cross-tenant access.

---

# 58. RBAC

Example permissions:

```text
client.read
client.manage

page.read
page.connect
page.manage

content.read
content.create
content.edit
content.approve
content.publish

analytics.read

comments.read
comments.reply

leads.read

automation.read
automation.manage

ai.use
ai.configure

billing.manage
workspace.manage
```

Do not use only role-name checks throughout application code.

Prefer permission checks.

---

# 59. Failure Handling

User-friendly errors are required.

Example:

Bad:

```text
OAuthException 190
```

Good:

```text
Facebook access for this Page has expired.
Reconnect the Page before publishing can continue.
```

Internally retain raw provider error.

Externally show actionable message.

---

# 60. Facebook API Adapter

Do not expose raw Graph API responses throughout the application.

Normalize them.

Example:

```ts
type NormalizedPostMetric = {
  metric: string;
  value: number | null;
  period?: string;
  sourceMetric: string;
  capturedAt: Date;
};
```

This helps survive Graph API changes.

---

# 61. Meta API Versioning

Graph API version must be configurable.

Example:

```env
META_GRAPH_API_VERSION=vXX.X
```

Do not scatter version strings throughout code.

Maintain upgrade documentation.

Before upgrading:

- read Meta changelog
- run integration tests
- compare metrics
- test publishing
- test webhooks
- test permissions

---

# 62. Research Service

External research must be independent from any specific AI provider.

Potential future sources:

- web search APIs
- RSS
- user-provided URLs
- business website
- uploaded documents

Internal interface:

```ts
interface ResearchService {
  search(query: string, options?: ResearchOptions): Promise<ResearchResult[]>;
  summarize(sources: ResearchResult[]): Promise<ResearchSummary>;
}
```

---

# 63. Media Service

Media operations should be abstracted.

```text
MediaService
├── image generation provider
├── image storage
├── image metadata
├── video generation provider
├── upload handling
└── Facebook media upload
```

Do not make one image-generation vendor a hard dependency.

---

# 64. Report Service

Report outputs:

- in-app report
- exportable PDF later
- client share link later

Report data must come from saved analytics / analysis objects, not by re-running all expensive AI calls every time a user opens the page.

---

# 65. Notification Service

Future channels:

- in-app
- email
- LINE
- Telegram
- Slack

Initial important notifications:

- approval required
- publish failed
- Facebook reconnect required
- hot lead detected
- monthly report ready
- AI budget threshold reached

Keep notification transport separate from domain event generation.

---

# 66. SaaS Billing Model Readiness

Even if billing is not in MVP, entities must support future limits.

Potential plan limits:

- workspaces
- users
- clients
- Pages
- posts/month
- AI generations/month
- AI budget
- stored media
- reports
- automation
- Ads features

Do not hardcode plan logic in the frontend.

---

# 67. MVP Scope

MVP should prove this loop:

```text
Connect Facebook
↓
Import Page history
↓
Analyze
↓
Generate strategy
↓
Generate posts
↓
Approve
↓
Schedule / Publish
↓
Collect metrics
↓
Analyze results
```

MVP modules:

1. Authentication
2. Workspace
3. Client
4. Brand Knowledge
5. Facebook connection
6. Page sync
7. Historical post import
8. Analytics normalization
9. AI Gateway
10. Agent Orchestrator
11. Page Analyst
12. Strategist
13. Content Generator
14. Content Calendar
15. Approval
16. Publish / Schedule
17. Metric collection
18. Basic Report
19. Audit Log
20. AI cost logging

---

# 68. Do NOT Put These in MVP Unless Needed

- fully autonomous Ads
- complex CRM
- full Messenger bot
- cross-platform Instagram/TikTok/YouTube support
- custom model training
- complicated drag/drop page builder
- white-label
- mobile app
- advanced billing
- dozens of dashboard themes

Build the Facebook content performance loop first.

---

# 69. Phase 2

Add:

- comment ingestion
- comment classification
- comment reply drafts
- customer insight
- lead detection
- notification
- improved reports

---

# 70. Phase 3

Add:

- Messenger
- lead inbox
- FAQ assistant
- human handoff
- conversation summaries

---

# 71. Phase 4

Add:

- Marketing API
- Ads read-only analytics
- organic → Ads recommendation
- campaign draft creation
- approval workflow

---

# 72. Phase 5

Add:

- agency billing
- self-service SaaS onboarding
- BYOK AI
- white-label options
- multiple social networks

---

# 73. Implementation Order for Coding Agents

Do not build random screens first.

Recommended order:

```text
1. Monorepo + Docker
2. PostgreSQL + Redis
3. Auth
4. Workspace + tenant isolation
5. Client + Brand
6. Brand Knowledge
7. Facebook OAuth / token storage
8. Page listing + connect
9. Page / post sync
10. Analytics storage
11. AI Gateway
12. AI task logging
13. Analyst Agent
14. Strategist Agent
15. Content Agent
16. Content domain
17. Approval
18. Scheduler
19. Publisher
20. Metric collector
21. Dashboard
22. AI Command Center
23. Reporting
24. Webhooks
25. Hardening / tests
```

---

# 74. Coding Agent Working Rules

When implementing a feature:

## Step 1

Read:

- AGENTS.md
- related domain code
- related database schema
- existing tests

## Step 2

State internally:

- feature objective
- affected entities
- affected APIs
- security impact
- tenant impact
- migration impact

## Step 3

Implement the smallest coherent vertical slice.

Example:

Bad:

```text
Build the whole analytics platform.
```

Good:

```text
Import Page posts and store normalized records.
```

## Step 4

Add tests.

## Step 5

Run:

- typecheck
- lint
- unit tests
- relevant integration tests
- build

## Step 6

Document important architectural decisions.

---

# 75. Do Not Make Large Architectural Changes Silently

Before replacing:

- ORM
- database
- queue
- authentication system
- AI gateway
- Facebook architecture
- monorepo structure

the coding agent must explain the reason in project documentation or implementation notes.

---

# 76. Definition of Done

A feature is not done because the UI looks complete.

A feature is done when:

- database model exists if needed
- migration exists
- backend authorization is enforced
- tenant scope is enforced
- API validation exists
- errors are handled
- audit log exists where appropriate
- UI handles loading / empty / failure states
- tests pass
- TypeScript passes
- lint passes
- production build passes
- secrets are not exposed
- documentation is updated

---

# 77. Testing Strategy

## Unit tests

Focus on:

- AI router
- permission rules
- approval rules
- content state machine
- metric adapters
- provider adapters
- classifiers

## Integration tests

Focus on:

- tenant isolation
- Facebook connection lifecycle
- Page sync
- scheduling
- publishing idempotency
- approvals
- jobs

## E2E tests

Critical path:

```text
Login
→ Create Client
→ Create Brand
→ Connect Page
→ Import Data
→ Generate Draft
→ Approve
→ Schedule
```

Use mocked Meta endpoints in automated test environments.

Do not publish to real client Pages during CI.

---

# 78. Development Facebook Environment

Maintain:

- Meta development app
- test Page
- test user / account as permitted
- development callback URLs
- production callback URLs

Never test new publishing code first on a real client Page.

---

# 79. Observability

Track:

- API errors
- queue depth
- failed jobs
- publishing failures
- Facebook token status
- webhook failures
- AI errors
- AI latency
- AI spend
- database health

Every request and job should have a request/correlation ID.

---

# 80. Backups

Production requirements:

- automated PostgreSQL backup
- retention policy
- restore documentation
- encrypted secret backup
- storage backup policy

Test restoring backup periodically.

A backup that has never been restored is not considered verified.

---

# 81. Docker Services

Initial Docker Compose may contain:

```text
web
api
worker
postgres
redis
reverse-proxy
```

Optional:

```text
litellm
minio
```

Do not create unnecessary microservices.

---

# 82. Environment Variables

Example categories:

```env
# Application
APP_ENV=
APP_URL=
API_URL=

# Database
DATABASE_URL=

# Redis
REDIS_URL=

# Auth
AUTH_SECRET=

# Meta
META_APP_ID=
META_APP_SECRET=
META_GRAPH_API_VERSION=
META_OAUTH_REDIRECT_URI=
META_WEBHOOK_VERIFY_TOKEN=

# AI platform-managed providers
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=
OPENROUTER_API_KEY=

# Optional AI Gateway
LITELLM_BASE_URL=
LITELLM_API_KEY=

# Storage
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

Never commit real values.

---

# 83. Secrets Policy

`.env.example` must contain placeholders only.

Never commit:

- Facebook tokens
- Meta App Secret
- provider API keys
- production DB credentials
- JWT/Auth secrets
- S3 secrets

If a secret is accidentally committed:

1. remove it
2. rotate it
3. document incident
4. never assume deleting Git history alone makes it safe

---

# 84. UI Design Direction

The UI should feel:

- professional
- agency-grade
- modern SaaS
- calm
- information dense without clutter
- fast

Primary UX principle:

> Surface what needs attention.

Examples:

```text
4 Pending Approvals
3 Hot Leads
1 Publish Failure
1 Facebook Reconnect Required
```

Do not prioritize decorative charts over actions.

---

# 85. Dashboard Mobile Support

Desktop is the primary operating environment, but mobile must support critical actions:

- approve
- reject
- preview
- reply
- view alert
- view lead
- reschedule

Do not require desktop for emergency operations.

---

# 86. Localization

Design for multiple languages.

Initial:

```text
Thai
English
```

Do not hardcode user-visible text directly throughout components.

Use i18n keys.

Brand content language is independent from UI language.

---

# 87. Timezone

Timezone must be explicit.

Store workspace timezone.

Page / client may override it later.

Thailand default for initial internal deployment may be:

```text
Asia/Bangkok
```

But never hardcode this as global product behavior.

---

# 88. Analytics Interpretation Rules

Do not compare unlike time windows silently.

Do not declare:

```text
Post A is better
```

without defining metric and comparison basis.

Possible normalized indicators:

- engagement per view
- comment rate
- reaction rate
- click rate if available
- follower growth contribution if measurable
- relative performance vs Page median

Use robust baselines such as median where appropriate.

---

# 89. AI Recommendation Confidence

Recommendations should optionally include confidence.

Example:

```json
{
  "recommendation": "Increase customer proof content.",
  "confidence": 0.82,
  "evidence": [
    "testimonial posts had 2.1x median comment rate",
    "customer proof generated 31% of qualified comments"
  ]
}
```

---

# 90. Recommendation → Action

A key product differentiator:

Recommendations should be actionable.

Bad:

```text
Post more engaging content.
```

Good:

```text
Customer proof outperformed the median by 110%.

[Create 2 customer proof posts]
```

Button can start an AI task that creates drafts.

---

# 91. Learning Loop

Store accepted recommendations.

Future structure:

```text
Recommendation
↓
Action Taken?
↓
Content Published
↓
Performance
↓
Outcome
```

This enables measurement of whether AI advice actually improves results.

---

# 92. Kill Switch

Workspace must have:

```text
Pause All Automation
```

Page must have:

```text
Pause Publishing
```

Ads later must have:

```text
Pause Ads Automation
```

Emergency stop must not require AI.

---

# 93. Rate Limits

Design Meta integration with:

- rate-limit awareness
- queue throttling
- exponential backoff
- retry-after support
- batching where suitable

Do not repeatedly poll high-cost endpoints unnecessarily.

---

# 94. Cache

Cache safe read data where appropriate.

Never use stale cache for:

- approval status
- publishing status
- permissions
- automation kill switch
- money actions

---

# 95. Data Retention / Disconnect

When Facebook Page is disconnected:

- stop scheduled publishing
- disable automation
- mark connection inactive
- retain historical analytics according to workspace policy
- delete tokens
- provide data deletion capability if required

---

# 96. Privacy

Minimize storage of end-customer personal data.

For leads:

Store only what is needed for business workflow.

Never unnecessarily enrich or infer sensitive personal attributes.

---

# 97. Future Platform Expansion

The architecture should later support:

```text
SocialProvider
├── Facebook
├── Instagram
├── TikTok
├── YouTube
├── Google Business Profile
└── LinkedIn
```

Do not force Facebook-specific fields into generic content entities unless necessary.

---

# 98. Generic Social Provider Interface — Future

Possible abstraction:

```ts
interface SocialProvider {
  getAccount(): Promise<SocialAccount>;
  listPosts(): Promise<SocialPost[]>;
  publishContent(input: PublishContentInput): Promise<PublishResult>;
  getMetrics(input: MetricsInput): Promise<SocialMetrics>;
}
```

Facebook implementation remains first-class.

Do not over-engineer this abstraction before Facebook MVP works.

---

# 99. Product Success Metrics

Internal success metrics:

- Pages managed per operator
- human minutes per post
- percentage of AI drafts approved
- average revisions per draft
- publish success rate
- percentage scheduled automatically
- AI cost per managed Page
- leads detected
- unresolved lead rate
- recommendations acted upon
- content performance improvement over baseline

---

# 100. First Internal Milestone

The first milestone is successful when the operator can:

1. log in
2. create a client
3. create a brand
4. enter brand information
5. connect one Facebook Page
6. import historical posts
7. see normalized analytics
8. ask AI to analyze the Page
9. generate a 7-day content plan
10. create at least 3 drafts
11. approve one draft
12. schedule / publish it safely
13. collect post metrics later
14. see the result in analytics
15. retain an audit trail

This proves the main product loop.

---

# 101. Second Internal Milestone

The system should allow one operator to manage:

```text
5–10 Pages
```

without losing track of:

- approvals
- schedules
- errors
- content strategy
- Facebook connection state
- monthly reporting

Do not open self-service SaaS onboarding before internal operational reliability is acceptable.

---

# 102. Commercial Product Evolution

Recommended sequence:

```text
Internal Agency Tool
↓
Managed SaaS
↓
Agency SaaS
↓
Self-Service SaaS
```

Reason:

The service business supplies:

- real user feedback
- real Facebook data
- feature prioritization
- workflow validation
- revenue during development

---

# 103. Non-Goals

The project is not initially:

- a generic chatbot
- another Buffer clone
- only an AI caption generator
- only an MCP wrapper
- only a Facebook posting script
- a fully autonomous advertising robot
- a full enterprise CRM

The product differentiator is:

> **Closed-loop AI Facebook management based on real Page performance and customer signals.**

---

# 104. Architectural Summary

Final conceptual architecture:

```text
┌───────────────────────────────────────┐
│              DASHBOARD                │
│                                       │
│ Overview  Clients  Pages  Calendar    │
│ Analytics Comments Leads Reports      │
│                                       │
│          AI COMMAND CENTER            │
└───────────────────┬───────────────────┘
                    │
                    ▼
          ┌───────────────────┐
          │ AGENT ORCHESTRATOR│
          └─────────┬─────────┘
                    │
         ┌──────────┴───────────┐
         ▼                      ▼
┌─────────────────┐     ┌─────────────────┐
│    AI GATEWAY   │     │  TOOL REGISTRY  │
│                 │     │                 │
│ OpenAI          │     │ Facebook        │
│ Anthropic       │     │ Analytics       │
│ Gemini          │     │ Content         │
│ OpenRouter      │     │ Research        │
│ LiteLLM         │     │ Media           │
└─────────────────┘     └────────┬────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       FacebookService     ResearchService      MediaService
              │
              ▼
    ┌──────────────────────┐
    │     META PLATFORM    │
    │                      │
    │ Graph API            │
    │ Pages                │
    │ Insights             │
    │ Messenger            │
    │ Webhooks             │
    │ Marketing API later  │
    └──────────────────────┘

                    │
                    ▼

              PostgreSQL
              Redis / Queue
              S3 Storage
              Audit Logs
              AI Usage
```

---

# 105. Final Instruction to Every Coding Agent

Before writing code, remember:

> The goal is not to automate Facebook actions for the sake of automation.

The goal is to build a reliable system that can understand a business, observe real Facebook performance, assist or execute marketing work, and continually improve the next action.

The product must remain:

- multi-tenant
- auditable
- provider-independent
- safe by default
- approval-aware
- measurable
- extensible

Whenever there is a choice between:

```text
clever autonomous behavior
```

and

```text
reliable controlled behavior
```

choose reliable controlled behavior first.

Autonomy can increase after the system proves reliability.

---

# 106. Initial Build Command for an AI Coding Agent

A useful first instruction after placing this file in the repository:

```text
Read AGENTS.md completely.

We are beginning Phase 1 of the Facebook AI Page Manager.

Do not build the entire application at once.

First:
1. inspect the existing repository,
2. propose the monorepo structure based on AGENTS.md,
3. create the Docker development environment,
4. create PostgreSQL and Redis services,
5. scaffold the Next.js web app and NestJS API,
6. implement health checks,
7. create .env.example,
8. document how to run the stack locally and on Ubuntu VPS,
9. run all builds and tests.

Do not start Facebook OAuth or AI integration until the base stack is clean and running.
```

After that milestone:

```text
Read AGENTS.md again.

Implement Workspace, User, WorkspaceMember, Client, Brand and BrandKnowledge.

Requirements:
- strict multi-tenant isolation
- RBAC foundations
- database migrations
- API validation
- tests
- responsive basic Dashboard
- audit log foundations

Do not implement Facebook yet.
```

Then:

```text
Read AGENTS.md again.

Implement the Facebook connection vertical slice.

Requirements:
- Meta OAuth
- securely store tokens
- list Pages the authorized user can manage
- allow selecting and connecting a Page to a Brand
- validate connection health
- Page disconnect
- audit logs
- error handling
- tests with mocked Meta API
- no real production Page publishing yet
```

Then:

```text
Read AGENTS.md again.

Implement historical Page sync and analytics normalization.

Requirements:
- import Page posts
- save normalized posts
- save raw provider payload when useful
- store metric snapshots
- implement Graph API metric adapter
- support API version configuration
- handle pagination
- rate-limit-aware retry
- expose data in Dashboard
```

Then:

```text
Read AGENTS.md again.

Implement the provider-independent AI Gateway.

Requirements:
- AIProvider interface
- provider adapters
- model role configuration
- structured output
- retries
- fallback
- AI usage logging
- cost tracking foundations
- prompt versioning
- no business-domain prompts inside provider adapters
```

Then build:

```text
Analyst Agent
→ Strategist Agent
→ Content Agent
→ Approval
→ Calendar
→ Scheduler
→ Facebook Publishing
→ Metrics Feedback Loop
```

This sequence is the preferred MVP implementation path.

---

# END OF AGENTS.md
