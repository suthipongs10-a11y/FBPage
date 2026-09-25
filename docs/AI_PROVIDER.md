# AI provider / Gemini

TikTok uses the existing `AiGatewayService` and `packages/ai-core` Gemini adapter. The same gateway continues to serve Facebook, YouTube and website tasks. Gemini configuration is independent of Google OAuth credentials used by YouTube/Search Console.

## Configuration

Set `GOOGLE_AI_API_KEY` in the root `.env`, or save a workspace-specific Gemini key on the existing AI Models page. Workspace keys are encrypted and take priority over platform environment keys. Choose provider/model per AI role on that page: TikTok studio uses `content`, TikTok analysis uses `analysis`. Existing explicit role selections remain authoritative. `GOOGLE_AI_MODEL` optionally overrides the auto-selected Gemini default; otherwise the existing adapter default remains.

For automatic provider selection, configured workspace keys take priority; Gemini is the first environment-key candidate. Other existing providers and fallback behavior remain available. A missing Gemini key is not replaced with a fabricated successful response. Test using the existing provider test action before live content generation.

## TikTok tasks

- Ideas, hook, script, caption, hashtags and repurpose use structured JSON validation and save a ContentItem draft with provider/model/prompt version and missing-fact notes.
- Studio can target a brand before a TikTok account is connected. Gemini still requires a real configured key; manually writing/reviewing/exporting a brand draft requires no AI key.
- Brand knowledge and source content are treated as data, limited in size and scoped to the same workspace/brand. Unknown business facts must be marked `[ต้องยืนยัน]` and surfaced to the user.
- Analysis receives computed observations and may return interpretations/recommendations only with video IDs from that dataset. It must disclose data limitations and cannot create watch-time, audience or retention statistics.
- Human review is required before submitting a TikTok draft for approval. AI output does not approve or send a video. Editing an approved draft expires the old approval.

The existing gateway records AiTaskLog, usage, model and errors, applies budget checks and structured-output retries. TikTok stores generated content; analysis responses are shown in the current view, while the shared task log retains the execution record.

## Verification status

Local integration tests call the actual shared Gemini adapter against a loopback HTTP fixture, including Gemini API-key header and response envelope, saved drafts, malformed/unsupported evidence rejection, and successful evidence-based analysis. This verifies application integration, not real model access or model quality.

**Real Google AI Studio / Gemini: BLOCKED_BY_CREDENTIALS.** No API key was supplied. After adding a key, use the existing AI Models test, generate a short draft and check its facts before review/approval. Never put real keys in source, screenshots or test fixtures.
