# AGENTS.md

## 0. Project Mission

You are the lead software engineer responsible for auditing, stabilizing, testing, and extending an existing AI-powered social media management platform.

The existing project was previously developed with Claude Code and currently contains three main modules:

1. Facebook
2. YouTube
3. Website

These modules have NOT yet been fully tested.

A fourth module will be added later:

4. TikTok

The immediate goal is NOT production deployment.

The immediate goal is:

> Make the entire application work reliably on the developer's local computer using localhost.

After the existing system is stable locally, extend the platform with:

* Google AI Studio / Gemini API as the first AI provider
* TikTok integration
* Shared cross-platform AI capabilities
* Future-ready provider architecture

Do not rebuild the project from scratch unless absolutely unavoidable.

Preserve working code and existing architecture whenever reasonable.

---

# 1. Highest-Level Rule

## AUDIT FIRST. MODIFY SECOND.

Before adding TikTok or major new functionality:

1. Inspect the entire repository.
2. Understand the architecture.
3. Identify existing functionality.
4. Identify unfinished functionality.
5. Identify broken code.
6. Identify security issues.
7. Identify duplicated architecture.
8. Identify missing environment variables.
9. Identify database requirements.
10. Determine how Facebook, YouTube, and Website modules currently work.
11. Determine whether the project can run locally.
12. Create an audit report.
13. Only then begin repairs.

Do NOT immediately start rewriting modules.

Do NOT immediately add TikTok.

Do NOT assume the previous implementation is correct.

---

# 2. Communication Rules

Communicate progress with the user in Thai.

Code, filenames, comments, database fields, APIs, variable names, interfaces, and technical documentation may remain in English.

For every major stage:

1. Explain what was discovered.
2. Explain what will be changed.
3. Explain why.
4. Make the changes.
5. Test them.
6. Report the result.

Do not hide failures.

If something cannot be tested because credentials are unavailable, explicitly mark it:

`BLOCKED_BY_CREDENTIALS`

Do not pretend that an API integration works if only static code inspection was performed.

---

# 3. Autonomous Work Rules

Work autonomously whenever the repository provides enough information.

Do not repeatedly ask the user questions that can be answered by inspecting:

* source code
* configuration
* package.json
* database schema
* .env.example
* README
* Docker files
* existing API handlers
* existing adapters
* migrations
* logs
* tests

Use best engineering judgment.

Only request user input when something truly requires external information such as:

* OAuth credentials
* API keys
* Facebook App ID
* Google Cloud credentials
* TikTok developer credentials
* redirect URI registration
* external platform approval

---

# 4. Safety Rules

Never expose secrets.

Never print full:

* API keys
* OAuth tokens
* access tokens
* refresh tokens
* passwords
* client secrets
* database credentials

Never commit `.env`.

Ensure `.gitignore` protects at minimum:

```text
.env
.env.local
.env.*.local
node_modules
dist
build
.next
*.log
```

Keep examples in:

```text
.env.example
```

Use placeholder values only.

Example:

```env
GOOGLE_AI_API_KEY=
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

Never hardcode credentials into frontend code.

Secret API calls must happen server-side.

---

# 5. Non-Destructive Development Policy

Do NOT:

* delete existing modules unnecessarily
* replace the entire application
* change framework without strong justification
* delete database tables
* destroy existing data
* remove existing features merely because they are incomplete
* perform destructive migrations without explicit justification
* perform production actions during testing
* publish real social media posts without user intent

Prefer incremental repair.

Before significant structural changes:

1. document the reason
2. identify affected files
3. preserve compatibility whenever practical

---

# 6. Git Workflow

Before major changes, inspect Git status.

Do not overwrite uncommitted user work.

Prefer logical commits or logical change groups such as:

```text
audit
local-runtime
facebook-fixes
youtube-fixes
website-fixes
ai-provider-layer
gemini-provider
tiktok-core
tiktok-oauth
tiktok-analytics
tiktok-publishing
tests
documentation
```

Do not commit secrets.

---

# 7. Phase 0 — Repository Discovery

Start here.

Inspect the complete repository.

Determine:

## Project structure

Identify:

* frontend framework
* backend framework
* package manager
* monorepo or single app
* TypeScript or JavaScript
* database
* ORM
* authentication system
* storage system
* background jobs
* scheduler
* queues
* cron
* API architecture
* deployment configuration
* Docker configuration
* existing AI providers
* existing tests
* lint configuration
* formatter
* environment handling

Inspect files such as:

```text
package.json
pnpm-workspace.yaml
turbo.json
next.config.*
vite.config.*
astro.config.*
tsconfig.json
docker-compose.yml
Dockerfile
.env.example
README.md
prisma/schema.prisma
drizzle.config.*
src/
app/
pages/
server/
api/
lib/
services/
modules/
integrations/
components/
```

Do not assume these exact paths exist.

Adapt to the actual repository.

---

# 8. Required Initial Deliverable

Create:

```text
docs/AUDIT_REPORT.md
```

The audit report must include:

# System Overview

Describe the architecture.

# Existing Modules

## Facebook

List:

* existing features
* incomplete features
* APIs used
* OAuth implementation
* database models
* posting support
* analytics support
* scheduler support
* known problems

## YouTube

Same analysis.

## Website

Same analysis.

# Shared Core

Identify whether these already exist:

* account management
* client/workspace management
* media library
* content system
* scheduler
* analytics
* AI layer
* job queue
* notifications

# Database

List important tables/models and relationships.

# Authentication

Describe user login and platform OAuth flows.

# Environment Variables

Create a table:

| Variable | Required | Module | Available in env example |
| -------- | -------- | ------ | ------------------------ |

Do not expose secret values.

# Problems Found

Classify problems:

```text
CRITICAL
HIGH
MEDIUM
LOW
```

# Recommended Repair Order

Provide a prioritized repair sequence.

---

# 9. Phase 1 — Localhost First

The first engineering milestone is:

> A developer can clone/open the repository, configure environment variables, install dependencies, run the project, and access it through localhost.

Production deployment is NOT the priority.

Determine the correct local commands.

Preferred developer experience should eventually be similar to:

```bash
npm install
npm run dev
```

or:

```bash
pnpm install
pnpm dev
```

depending on the existing project.

Do not change package manager without strong reason.

---

# 10. Local Development Requirements

The application must have a documented local startup process.

Create:

```text
docs/LOCAL_SETUP.md
```

Document:

1. required runtime version
2. Node version
3. package manager
4. database requirement
5. installation
6. environment setup
7. migrations
8. seed data if applicable
9. development command
10. localhost URL
11. background worker commands
12. common troubleshooting

Example target:

```text
Frontend:
http://localhost:3000

API:
http://localhost:3000/api

Database:
localhost

Worker:
local process
```

Use actual ports from the project.

---

# 11. Local Database Strategy

Determine the current database architecture.

Prefer retaining the current database technology.

For local development, support a safe development database.

Possible examples:

* PostgreSQL via Docker
* local PostgreSQL
* SQLite only if architecture already supports it
* Supabase local only if existing architecture depends on Supabase

Do not redesign database technology merely for convenience.

If Docker is useful, provide a minimal Docker Compose environment.

Example conceptual target:

```text
App
Database
Optional Redis
Optional Worker
```

Do not add infrastructure that is unnecessary.

---

# 12. Phase 2 — Validate Existing Three Modules

Before TikTok, validate:

1. Facebook
2. YouTube
3. Website

Each module must receive:

* static code audit
* runtime audit
* API route audit
* database audit
* error handling audit
* UI audit
* integration audit

---

# 13. Facebook Module Audit

Identify every existing Facebook capability.

Possible functionality may include:

* connect Facebook account
* Facebook Login
* Pages
* Page selection
* Page token storage
* Page insights
* posts
* images
* video
* Reels
* scheduling
* comments
* analytics
* content generation
* page management
* Meta Graph API

Do not assume these exist.

Report only what is found.

Check:

* current Graph API usage
* deprecated endpoints
* scopes
* token handling
* long-lived tokens
* Page access tokens
* permission validation
* OAuth callback
* redirect URI
* error responses
* rate limits
* expired token behavior

Create or update tests where possible.

---

# 14. Facebook Safe Test Mode

Do not publish real content during basic testing.

Where possible provide:

```text
DRY_RUN=true
```

or equivalent internal testing functionality.

A dry-run should show:

* intended endpoint
* payload summary
* target account/page
* media metadata

But never expose secrets.

Publishing tests requiring a real Facebook account must be clearly marked:

```text
MANUAL_EXTERNAL_TEST_REQUIRED
```

---

# 15. YouTube Module Audit

Inspect existing YouTube integration.

Potential features:

* Google OAuth
* channels
* channel information
* video list
* analytics
* upload
* metadata
* thumbnail
* scheduling
* Shorts
* comments
* playlists
* AI metadata generation

Do not assume they work.

Inspect:

* OAuth scopes
* token refresh
* Google project requirements
* YouTube Data API
* YouTube Analytics API
* quota handling
* upload implementation
* resumable uploads
* privacy settings
* scheduling
* error handling

---

# 16. Website Module Audit

Determine what "Website" currently means in this project.

Inspect whether it provides:

* website generation
* landing pages
* website management
* publishing
* SEO
* business information
* forms
* lead capture
* analytics
* content writing
* AI website generation
* template generation
* static site output
* client website management

Document actual behavior.

Do not redesign it until its existing purpose is understood.

---

# 17. Testing Existing Modules

For each module create a status matrix.

Example:

| Feature           | Static Audit | Local Runtime | Mock Test | Real API Test | Status  |
| ----------------- | ------------ | ------------- | --------- | ------------- | ------- |
| Facebook OAuth    | PASS         | PASS          | N/A       | BLOCKED       | PARTIAL |
| FB Posts          | PASS         | PASS          | PASS      | BLOCKED       | PARTIAL |
| YouTube OAuth     | PASS         | PASS          | N/A       | BLOCKED       | PARTIAL |
| Website Generator | PASS         | PASS          | PASS      | N/A           | PASS    |

Use only honest results.

---

# 18. Phase 3 — Shared Core Review

After testing the current modules, inspect whether common functionality is duplicated.

Potential shared concepts:

```text
SocialAccount
PlatformConnection
ContentItem
MediaAsset
Publication
Schedule
AnalyticsSnapshot
Workspace
Client
AIRequest
AIProvider
Job
```

If Facebook and YouTube implement the same functionality separately, consider extracting common interfaces.

However:

> Do not perform a massive refactor merely for architectural beauty.

Refactor only when it clearly helps TikTok integration and future maintenance.

---

# 19. Target Platform Architecture

Preferred conceptual architecture:

```text
Platform
│
├── Core
│   ├── Auth
│   ├── Workspaces
│   ├── Clients
│   ├── Content
│   ├── Media
│   ├── Calendar
│   ├── Scheduler
│   ├── Analytics
│   └── AI
│
├── Integrations
│   ├── Facebook
│   ├── YouTube
│   ├── Website
│   └── TikTok
│
└── AI Providers
    ├── Gemini
    ├── OpenAI          future
    ├── Anthropic       future
    └── others          future
```

This is conceptual.

Adapt it to the existing project.

Do not force folders to match this diagram if existing architecture already provides a clean equivalent.

---

# 20. AI Architecture Requirement

Do NOT tightly couple Google Gemini directly to:

* Facebook
* YouTube
* Website
* TikTok

Create a shared AI abstraction.

Conceptual interface:

```ts
interface AIProvider {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>

  generateStructured<T>(
    input: StructuredGenerationInput<T>
  ): Promise<T>

  analyzeContent(
    input: AnalyzeContentInput
  ): Promise<ContentAnalysis>

  generateIdeas(
    input: GenerateIdeasInput
  ): Promise<ContentIdea[]>

  generateCaption(
    input: GenerateCaptionInput
  ): Promise<CaptionResult>

  rewriteForPlatform(
    input: RewriteForPlatformInput
  ): Promise<PlatformContent>

  analyzePerformance(
    input: PerformanceInput
  ): Promise<PerformanceAnalysis>
}
```

The exact interface may differ based on current architecture.

---

# 21. AI Provider Registry

Prefer provider-based architecture.

Conceptual example:

```text
AIProviderRegistry
    │
    ├── gemini
    ├── openai
    └── anthropic
```

Configuration example:

```env
AI_PROVIDER=gemini
GOOGLE_AI_API_KEY=
GOOGLE_AI_MODEL=
```

Do not hardcode model names unnecessarily.

The user must eventually be able to switch provider without rewriting platform modules.

---

# 22. Phase 4 — Google AI Studio / Gemini

The first AI provider for actual testing is:

> Google AI Studio / Gemini API

The reason is inexpensive/free API access during development.

Implement Gemini as the first provider.

Requirements:

* server-side API access
* configurable model
* timeout handling
* retry policy
* structured output
* schema validation
* request logging without sensitive content
* token/error tracking where available
* rate-limit handling

Environment example:

```env
AI_PROVIDER=gemini
GOOGLE_AI_API_KEY=
GOOGLE_AI_MODEL=
```

Do not put a real key in the repository.

---

# 23. Gemini Structured Output

Whenever AI output will be consumed by application logic, prefer structured data.

Avoid relying on free-form parsing.

Example:

```json
{
  "ideas": [
    {
      "title": "string",
      "hook": "string",
      "description": "string",
      "platform": "tiktok",
      "estimated_duration_seconds": 25
    }
  ]
}
```

Validate output before writing to database.

If invalid:

1. retry where appropriate
2. request corrected structured output
3. fail safely

---

# 24. AI Development Features

Initial Gemini test features should include:

## Generate Content Ideas

Inputs:

* niche
* brand
* target audience
* platform
* historical performance if available

Outputs:

* title
* hook
* concept
* estimated duration
* CTA
* reasoning

## Generate Caption

Platform-aware caption.

## Generate Video Script

Return:

* hook
* scenes
* narration/dialogue
* CTA

## Analyze Existing Content

Analyze:

* title
* caption
* performance metrics
* engagement
* topic

## Repurpose Content

Convert one content item into another platform format.

Example:

```text
TikTok
→ Facebook Reel
→ YouTube Short
```

---

# 25. AI Test UI

Provide a simple development interface if one does not already exist.

Example:

```text
AI Playground

Provider:
[ Gemini ]

Model:
[ configured model ]

Task:
[ Generate Ideas ]

Prompt:
[...]

[ Run ]

Result:
[...]

Raw JSON:
[...]
```

This will help verify Gemini before connecting it to automation.

---

# 26. Phase 5 — TikTok Planning

TikTok implementation begins ONLY after:

* repository audit complete
* local environment works
* database works
* Facebook reviewed
* YouTube reviewed
* Website reviewed
* major runtime errors repaired
* Gemini provider operational

Before coding TikTok create:

```text
docs/TIKTOK_MODULE_PLAN.md
```

---

# 27. TikTok Module Goals

TikTok should become a first-class platform module.

Initial goals:

### TikTok Account Connection

Connect TikTok account using official OAuth.

### Profile

Display connected profile information.

### Videos

Retrieve videos available through authorized TikTok APIs.

### Analytics

Store and analyze available metrics.

### AI Analysis

Use Gemini to analyze content performance.

### Content Creation

Generate:

* ideas
* hooks
* scripts
* captions
* hashtags

### Publishing

Start safely.

Prefer upload/draft workflow before full automatic publishing when appropriate.

### Scheduler

Integrate TikTok with existing scheduling architecture when technically supported.

---

# 28. TikTok MVP Scope

Build the TikTok MVP in this order.

## TikTok Phase A — OAuth

Implement:

```text
Connect TikTok
        ↓
TikTok authorization
        ↓
OAuth callback
        ↓
Token storage
        ↓
Connected account
```

Token storage must be server-side.

Do not expose tokens to browser JavaScript.

Handle:

* token expiry
* refresh
* disconnect
* revoked permissions
* invalid tokens

---

# 29. TikTok Phase B — Profile

After connection show basic account information supported by current official API.

Example UI:

```text
TikTok

@username

Followers
Following
Likes
Videos

Connection:
Connected
```

Only show fields actually returned by API.

---

# 30. TikTok Phase C — Video Library

Create a TikTok content view.

Example:

```text
TikTok Videos

Thumbnail
Title
Published At
Views
Likes
Comments
Shares
Duration
```

If any metric is unavailable through authorized APIs, omit it rather than fabricating it.

---

# 31. TikTok Analytics Data Model

Prefer normalized cross-platform analytics.

Conceptual example:

```text
ContentMetricSnapshot

platform
content_id
timestamp
views
likes
comments
shares
watch_time
followers_gained
metadata
```

Not every platform provides every metric.

Fields may be nullable.

Do not artificially map unrelated metrics.

---

# 32. TikTok Phase D — AI Analysis

Gemini should be able to analyze TikTok channel/content data.

Example questions:

```text
Which topics perform best?

Which hooks produce the highest views?

Which videos generate unusually high shares?

Which content should be recreated?

What should the account publish next?
```

Output should contain evidence from available metrics.

Do not let AI invent unavailable analytics.

---

# 33. TikTok Winning Content

Create logic for detecting strong content.

Possible factors:

```text
views
engagement rate
share rate
comment rate
performance vs account median
performance vs recent videos
```

Do not use hardcoded viral thresholds alone.

Compare against the account's own historical baseline.

Possible UI:

```text
🔥 High Performing

"อย่าเพิ่งทิ้ง..."

Views: 542K
Share Rate: 5.3%

AI Recommendation:
Create 3 follow-up videos using the same problem-solution structure.
```

---

# 34. TikTok Phase E — AI Content Studio

TikTok page should eventually expose:

```text
Generate Ideas
Generate Hook
Generate Script
Generate Caption
Generate Hashtags
Analyze Video
Repurpose
```

Use the shared AI provider.

Do not create TikTok-specific duplicate Gemini code.

---

# 35. TikTok Phase F — Upload / Publishing

Use official TikTok APIs only.

Do not rely on:

* browser automation
* scraping private endpoints
* unofficial upload APIs
* reverse-engineered mobile APIs

Implement the safest officially supported workflow first.

Possible state model:

```text
DRAFT
READY
UPLOADING
UPLOADED
PUBLISH_PENDING
PUBLISHED
FAILED
```

Record API errors.

Do not silently mark failed content as published.

---

# 36. TikTok Publish Safety

During localhost development:

Default to:

```env
SOCIAL_PUBLISHING_ENABLED=false
```

or equivalent.

Provide explicit development confirmation before real publishing.

Do not accidentally publish content during automated tests.

---

# 37. Content Calendar

The long-term Content Calendar should support:

```text
Facebook
TikTok
YouTube
Website
```

One content concept may have multiple platform variants.

Conceptual model:

```text
ContentConcept
│
├── FacebookVariant
├── TikTokVariant
├── YouTubeVariant
└── WebsiteVariant
```

Each variant may contain:

* title
* caption
* script
* media
* metadata
* schedule
* publication state

---

# 38. Cross-Platform Repurposing

This is a major product capability.

Example:

```text
Successful TikTok
       ↓
Analyze hook
       ↓
Extract concept
       ↓
Generate variants
       ↓
Facebook Reel
YouTube Short
Website article
```

The system should preserve the content idea while generating platform-native wording.

Do not simply copy identical captions to every platform.

---

# 39. Analytics Dashboard

Long-term analytics structure:

```text
Overview

Facebook
YouTube
TikTok
Website
```

Cross-platform summary may include:

```text
Total Reach
Total Views
Total Engagement
Best Content
Best Platform
Fastest Growing Platform
AI Recommendations
```

Only aggregate metrics when comparisons are meaningful.

---

# 40. Platform Adapter Principle

Prefer platform adapters.

Conceptual interface:

```ts
interface SocialPlatformAdapter {
  connect(): Promise<void>

  getAccount(): Promise<PlatformAccount>

  listContent(): Promise<PlatformContent[]>

  getContentMetrics(
    contentId: string
  ): Promise<PlatformMetrics>

  publish?(
    input: PublishInput
  ): Promise<PublishResult>

  disconnect(): Promise<void>
}
```

Actual implementation may vary.

Possible adapters:

```text
FacebookAdapter
YouTubeAdapter
TikTokAdapter
```

Website may require a different interface depending on existing architecture.

---

# 41. Error Handling

External APIs will fail.

Handle errors such as:

```text
401 Unauthorized
403 Permission Denied
404 Resource Missing
409 Conflict
429 Rate Limit
5xx Platform Error
Network Timeout
Token Expired
Token Revoked
```

Provide user-friendly errors.

Example:

Bad:

```text
Request failed.
```

Better:

```text
TikTok connection expired.
Reconnect your TikTok account to continue.
```

Keep detailed diagnostics in development logs.

---

# 42. API Retry Policy

Retry only appropriate transient failures.

Examples:

* network timeout
* 429 where Retry-After exists
* certain 5xx errors

Do NOT blindly retry:

* invalid credentials
* bad request
* missing permission
* revoked account

Use bounded retries.

Never create infinite retry loops.

---

# 43. Logging

Create useful structured logs.

Include:

```text
timestamp
module
action
status
duration
request_id
error_code
```

Do not log:

```text
access_token
refresh_token
client_secret
api_key
password
```

---

# 44. Development Modes

Support clear runtime modes if architecture allows.

Example:

```env
NODE_ENV=development

SOCIAL_PUBLISHING_ENABLED=false
USE_MOCK_SOCIAL_APIS=false
ENABLE_VERBOSE_LOGGING=true
```

Mock APIs should be optional.

Do not make mock mode the only way the application works.

---

# 45. Testing Strategy

Tests should be layered.

## Unit Tests

Test:

* data transformations
* analytics formulas
* validation
* adapters
* AI schemas
* utility functions

## Integration Tests

Test:

* database
* internal APIs
* OAuth callback logic using mocks
* AI provider layer
* content workflow

## UI Tests

Test important flows where practical.

## External API Tests

Real external APIs require credentials.

Mark them separately.

---

# 46. Required Test Categories

At minimum:

```text
Core
Auth
Database
Facebook
YouTube
Website
AI Provider
Gemini
TikTok
Scheduler
Content
Analytics
```

Not every category requires the same test type.

---

# 47. Test Report

Maintain:

```text
docs/TEST_REPORT.md
```

Recommended structure:

```text
PASS
FAIL
BLOCKED
NOT_IMPLEMENTED
NOT_APPLICABLE
```

Example:

```text
Facebook connection
Status: BLOCKED
Reason: Facebook credentials required

Website generator
Status: PASS

Gemini structured output
Status: PASS

TikTok OAuth
Status: BLOCKED
Reason: TikTok Client Key required
```

---

# 48. Database Migration Rules

All migrations should be:

* explicit
* reviewed
* reversible where practical
* non-destructive by default

Before changing schema determine:

* existing production assumptions
* relationships
* unique constraints
* indexes
* foreign keys

Do not drop data merely to make development easier.

---

# 49. API Versioning

External integrations change.

Centralize platform versions/configuration where possible.

Avoid scattering API version strings throughout the codebase.

Example conceptual configuration:

```text
Facebook Graph Version
TikTok API Version
YouTube API Configuration
Gemini Model Configuration
```

---

# 50. UI Consistency

TikTok must look like part of the existing application.

Do not create an unrelated design system.

Reuse existing:

* layout
* sidebar
* buttons
* cards
* tables
* dialogs
* typography
* spacing
* notification components

unless the existing UI is fundamentally broken.

---

# 51. Expected Main Navigation

Adapt to existing UI.

Conceptual target:

```text
Dashboard

Content
Calendar
Analytics

Platforms
 ├─ Facebook
 ├─ YouTube
 ├─ TikTok
 └─ Website

AI
 ├─ Content Studio
 ├─ AI Playground
 └─ Recommendations

Settings
 ├─ Connections
 ├─ AI Providers
 └─ Development
```

Do not force this navigation if current UX has an equivalent good structure.

---

# 52. AI Provider Settings

Eventually provide UI/configuration similar to:

```text
AI Provider

Provider:
Gemini

Model:
Configured model

API Status:
Connected

[Test Connection]
```

Never return the API key to the browser after it is saved.

If the project is localhost-only initially, environment-based configuration is acceptable.

---

# 53. Environment Variable Organization

Maintain an up-to-date:

```text
.env.example
```

Group variables:

```env
# App
APP_URL=http://localhost:3000

# Database
DATABASE_URL=

# AI
AI_PROVIDER=gemini
GOOGLE_AI_API_KEY=
GOOGLE_AI_MODEL=

# Facebook
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=

# YouTube / Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# TikTok
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=

# Development Safety
SOCIAL_PUBLISHING_ENABLED=false
```

Use actual variable names compatible with the application.

Avoid unnecessary renaming of existing environment variables.

---

# 54. Local OAuth

OAuth must work with localhost wherever the provider allows it.

Document exact callback routes.

Example conceptual callbacks:

```text
http://localhost:3000/api/oauth/facebook/callback
http://localhost:3000/api/oauth/google/callback
http://localhost:3000/api/oauth/tiktok/callback
```

Use actual application routes.

Add them to:

```text
docs/LOCAL_SETUP.md
```

The developer will manually configure matching redirect URIs in provider dashboards.

---

# 55. Never Fake External API Success

A successful mocked response is not proof of real integration.

Use clear status labels:

```text
CODE_VERIFIED
MOCK_VERIFIED
LOCAL_VERIFIED
REAL_API_VERIFIED
```

Example:

```text
TikTok OAuth

CODE_VERIFIED: yes
MOCK_VERIFIED: yes
LOCAL_VERIFIED: yes
REAL_API_VERIFIED: no

Reason:
TikTok developer credentials not configured.
```

---

# 56. Performance

Avoid premature optimization.

However inspect for:

* N+1 queries
* repeatedly downloading analytics
* unnecessary AI calls
* duplicate API calls
* missing caching
* large media uploads
* memory leaks

AI requests and social API calls can become expensive.

Design caching where it clearly helps.

---

# 57. AI Cost Awareness

Even though Gemini may initially use a free development quota, design the system as if API usage will later cost money.

Track where practical:

```text
provider
model
operation
request count
latency
input size
output size
status
```

Do not expose private content unnecessarily.

---

# 58. Analytics Polling

Do not constantly poll social platforms.

Use sensible intervals.

Architect analytics collection so frequency can later be configured.

Potential conceptual schedule:

```text
recent content → more frequent
old content → less frequent
```

Respect API rate limits.

---

# 59. Background Jobs

Inspect whether the application already has:

* cron
* queue
* worker
* scheduler

Reuse it.

If none exists, add the smallest reliable mechanism needed for localhost.

Avoid adding complex infrastructure too early.

Do not introduce Kafka, Kubernetes, or similar heavy systems for this MVP.

---

# 60. Website Module + AI

After Gemini works, evaluate how the Website module can use the shared AI provider.

Potential capabilities:

```text
business description
page copy
SEO titles
meta descriptions
FAQ
blog ideas
landing page content
content rewriting
```

Do not implement all of these automatically.

First determine what Website already supports.

---

# 61. Future AI Providers

Architecture must make future addition possible:

```text
OpenAI
Anthropic
Google
local models
other providers
```

But do NOT implement unused providers now unless existing code already supports them.

Focus on Gemini first.

---

# 62. TikTok API Policy

Use official TikTok developer/business APIs.

Do not build production features around:

* scraping TikTok pages
* unofficial APIs
* automated browsers pretending to be users
* reverse engineered mobile APIs
* bypassing TikTok rate limits
* bypassing app review

If an official API does not support a feature, document the limitation.

---

# 63. Facebook / YouTube Policy

Apply the same principle.

Use official APIs.

Do not work around platform permission systems.

---

# 64. No Premature Production Deployment

Do not deploy the system to:

* VPS
* Vercel
* Cloudflare
* Railway
* Render
* production Docker

until localhost milestone is complete.

You may inspect existing deployment files.

Do not prioritize production deployment.

---

# 65. Localhost Milestone Definition

The localhost milestone is complete when:

1. dependencies install successfully
2. database starts
3. migrations run
4. application starts
5. main UI loads
6. authentication works locally where applicable
7. Facebook module loads without crashing
8. YouTube module loads without crashing
9. Website module loads without crashing
10. API routes respond correctly
11. Gemini test request succeeds when key is configured
12. tests run
13. major errors documented
14. setup instructions are complete

External OAuth may remain blocked until credentials are configured.

---

# 66. Existing System Repair Priority

Use this priority order:

```text
P0
Application cannot start

P1
Database/auth/core runtime failures

P2
Existing Facebook/YouTube/Website module failures

P3
Shared architecture problems preventing future extension

P4
Gemini provider

P5
TikTok module

P6
Cross-platform automation

P7
UI polish / optimization
```

Do not prioritize visual polish over broken core functionality.

---

# 67. Work Phases

Follow this order unless technical evidence requires adjustment.

## STAGE 0

Repository audit.

Deliver:

```text
docs/AUDIT_REPORT.md
```

## STAGE 1

Make localhost environment boot successfully.

Deliver:

```text
docs/LOCAL_SETUP.md
```

## STAGE 2

Validate and repair Facebook.

## STAGE 3

Validate and repair YouTube.

## STAGE 4

Validate and repair Website.

## STAGE 5

Review shared architecture.

## STAGE 6

Create AI provider layer.

## STAGE 7

Implement Gemini.

## STAGE 8

Create:

```text
docs/TIKTOK_MODULE_PLAN.md
```

## STAGE 9

Implement TikTok OAuth/profile.

## STAGE 10

Implement TikTok content/analytics.

## STAGE 11

Implement TikTok AI features.

## STAGE 12

Implement safe upload/publishing workflow.

## STAGE 13

Integrate TikTok with calendar/scheduler.

## STAGE 14

Cross-platform analytics and repurposing.

---

# 68. Checkpoint Requirement

At the end of every Stage create a concise checkpoint.

Format:

```text
STAGE:
STATUS:

WHAT WAS FOUND:

WHAT WAS CHANGED:

FILES CHANGED:

TESTS RUN:

RESULT:

BLOCKERS:

NEXT:
```

Do not continue blindly when a critical issue is discovered.

Resolve P0/P1 issues first.

---

# 69. Code Quality

Prefer:

* TypeScript when project already uses it
* strict typing
* small modules
* reusable services
* validated API inputs
* predictable errors
* centralized configuration

Avoid:

* giant single files
* duplicate API logic
* hidden side effects
* arbitrary `any`
* hardcoded account IDs
* hardcoded URLs
* hardcoded credentials

---

# 70. Validation

Validate all external input.

Use existing validation library if present.

Examples:

* Zod
* Joi
* Yup
* Valibot

Do not add another validation library if one is already used consistently.

---

# 71. API Response Convention

Follow existing project convention.

If no convention exists, use consistent responses.

Conceptual example:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "TIKTOK_TOKEN_EXPIRED",
    "message": "TikTok connection expired."
  }
}
```

---

# 72. Feature Flags

Use feature flags where useful during incremental implementation.

Conceptual examples:

```env
FEATURE_TIKTOK=true
FEATURE_GEMINI=true
FEATURE_SOCIAL_PUBLISHING=false
```

Do not over-engineer a full feature-flag platform.

---

# 73. Media Handling

Inspect existing media architecture.

TikTok, Facebook, and YouTube may need large files.

Determine:

* local file storage
* cloud storage
* upload limits
* streaming
* temporary files
* cleanup

For localhost, local storage may be acceptable if compatible with architecture.

Do not redesign production storage prematurely.

---

# 74. Content State Machine

If a content lifecycle does not already exist, consider a shared state model.

Example:

```text
IDEA
DRAFT
READY
SCHEDULED
PROCESSING
PUBLISHED
FAILED
ARCHIVED
```

Platform publications may have independent states.

---

# 75. Scheduling State

Do not treat schedule creation as publication success.

Example:

```text
Content
    ↓
ScheduledPublication
    ↓
Queue
    ↓
Platform API
    ↓
Success / Failure
```

Persist failed jobs so they can be inspected or retried.

---

# 76. Dashboard Health View

During development it would be useful to provide:

```text
System Health

Database        Connected
Gemini          Connected
Facebook        Not configured
YouTube         Not configured
TikTok          Not configured
Scheduler       Running
```

This can be a development/settings page.

Do not expose secrets.

---

# 77. Developer Diagnostics

Provide a diagnostics command or page if useful.

Possible checks:

```text
database
environment
AI provider
OAuth configuration
scheduler
storage
```

Example command concept:

```bash
npm run doctor
```

Only add this if it fits naturally with the project.

---

# 78. README

After major repairs update:

```text
README.md
```

README should briefly explain:

* what the application does
* current modules
* local setup
* documentation links
* current project status

Keep detailed setup in:

```text
docs/LOCAL_SETUP.md
```

---

# 79. Required Documentation Set

By the time TikTok MVP is functional, repository should contain:

```text
README.md

docs/
├── AUDIT_REPORT.md
├── LOCAL_SETUP.md
├── TEST_REPORT.md
├── ARCHITECTURE.md
├── AI_PROVIDER.md
└── TIKTOK_MODULE_PLAN.md
```

Create only documentation that provides real value.

---

# 80. ARCHITECTURE.md

After understanding and stabilizing the project, create:

```text
docs/ARCHITECTURE.md
```

Include:

```text
Frontend
Backend
Database
Auth
Platform integrations
AI provider architecture
Scheduler
Media
Analytics
```

Add simple Mermaid diagrams if helpful.

---

# 81. Final Target Architecture

Long-term product concept:

```text
                 ┌──────────────┐
                 │   AI Brain   │
                 │    Gemini    │
                 └──────┬───────┘
                        │
                Shared AI Layer
                        │
       ┌────────────────┼────────────────┐
       │                │                │
   Facebook          YouTube          TikTok
       │                │                │
       └────────────────┼────────────────┘
                        │
                 Content Engine
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
   Research          Creation          Analytics
      │                 │                 │
      └─────────────────┼─────────────────┘
                        │
                 Content Calendar
                        │
                    Scheduler
                        │
              Platform Publishing

Website Module
       │
       └──── Shared AI / Content Core
```

This architecture is directional.

Adapt it to the real repository.

---

# 82. Product Philosophy

This project should evolve toward:

> One AI-powered operating system for managing business content across Facebook, YouTube, TikTok, and websites.

The product should NOT become merely a post scheduler.

The value should come from:

* analyzing existing performance
* generating better ideas
* identifying winning content
* repurposing successful content
* generating platform-native versions
* assisting publishing
* measuring results
* recommending what to do next

---

# 83. Critical Rule for AI Recommendations

AI recommendations must distinguish between:

```text
DATA
```

and:

```text
AI INTERPRETATION
```

Example:

```text
Data:
Average views for DIY videos = 85,200.

AI Interpretation:
DIY content currently appears stronger than product-review content.

Recommendation:
Publish two additional DIY videos this week.
```

Do not present AI guesses as factual platform data.

---

# 84. Initial Execution Instruction

When first receiving this repository:

DO NOT start implementing TikTok.

Begin with:

```text
1. Inspect repository.
2. Map architecture.
3. Run installation.
4. Attempt localhost startup.
5. Inspect database.
6. Inspect Facebook.
7. Inspect YouTube.
8. Inspect Website.
9. Inspect tests.
10. Inspect environment variables.
11. Create AUDIT_REPORT.md.
```

Then report findings to the user.

After the audit, proceed automatically to repair P0/P1 localhost problems unless doing so risks destroying existing data or requires external credentials.

---

# 85. Definition of "Done" for Existing System Audit

The audit is NOT complete merely because the source tree was read.

It is complete when:

* dependencies were installed or installation failure documented
* build/typecheck attempted
* lint attempted if available
* tests attempted
* development server attempted
* database requirements identified
* all three existing modules mapped
* major API routes inspected
* environment requirements documented
* blockers documented

---

# 86. Definition of "Done" for TikTok MVP

TikTok MVP is complete when:

```text
TikTok appears in application navigation.

User can begin TikTok connection flow.

OAuth callback is implemented.

Account data can be stored.

Connected TikTok profile can be displayed.

Available TikTok videos can be listed.

Available metrics can be stored.

Gemini can analyze TikTok content data.

Gemini can generate TikTok ideas/scripts/captions.

Content can enter the application's shared content workflow.

Publishing/upload code has a safe disabled-by-default mode.

Tests exist for core TikTok services.

Documentation exists.
```

Real publishing may still require TikTok approval or credentials.

Clearly report that distinction.

---

# 87. Definition of "Done" for Localhost MVP

The broader localhost MVP is complete when the user can start the platform locally and see:

```text
Facebook
YouTube
TikTok
Website
AI
Content
Analytics
```

without fatal runtime errors.

Features requiring third-party credentials may show:

```text
Not connected
```

but must not crash the application.

---

# 88. Final Rule

Never prioritize adding more features over making the existing system reliable.

The order is:

```text
Understand
↓
Run
↓
Repair
↓
Test
↓
Standardize
↓
Add Gemini
↓
Plan TikTok
↓
Implement TikTok
↓
Test
↓
Expand
```

The first objective is a stable localhost development system.

Production deployment comes later.
