# Skills Audit — 2026-07-16

Scope: 38 personal skills audited individually; 7 plugin packs judged as packs (individual plugin skills aren't editable). Evidence base: CLAUDE.md session handoffs (06-22 → 07-16), git log (~90 commits), docs/ (44 files), live skill sources.

## The repeated hand-done work (what the history actually shows)

Five workflows recur across nearly every session, each re-derived from handoff prose instead of running from a spec:

1. **Backend ship** — fetch live edge fn (drift), edit, esbuild check, deploy, sync local, migration + repo file, DROP-not-overload RPCs, DO-block rollback tests. Done ≥6 times (v21/v28/v29/v30/v31, lead-digest, manual-booking RPC).
2. **Live smoke test** — temp rows → invoke via production path → assert exact response → delete + verify 0 residue. Done ≥5 times.
3. **Session handoff** — the dense CLAUDE.md entry with 🔴 lessons, UNCOMMITTED list, git block, CONTINUE FROM. Every session; format lives only by imitation.
4. **Lead/funnel pull with exclusions** — team phones, "Test" names, phone+date dedup, n-tiny caveat, mark-followed-up. ≥3 sessions.
5. **Live-state verification before building** — cache-busted fetch, get_edge_function, SQL, git show. The single most repeated *lesson* (stale 07-12 handoff cost a session; stale web_fetch caused a wrong SEO diagnosis; GSC audit line was stale at write-time).

All five are now rebuilt as installable skills: `picnic-backend-ship`, `picnic-smoke-test`, `picnic-session-handoff`, `picnic-lead-ops`, `picnic-live-verify`.

## Personal skills (38) — keep / fix / merge / remove

**Keep (23):**

- `plan-optimizer` — KEEP: highest proven ROI in the project (74→92, 80→91, 63→86 runs); don't touch.
- `compact` — KEEP: used 07-16 to prune handoffs; pairs with picnic-session-handoff.
- `git-commands` — KEEP: sound and used every session; repo-specific git landmines now live in the Standing Rules block instead of bloating a generic skill.
- `docx` / `xlsx` / `pptx` / `pdf` — KEEP ×4: format engines with real usage (GBP playbook, PDF redesign).
- `skill-creator` — KEEP: maintains this whole system.
- `schedule` — KEEP: recurring-task asks keep appearing (digest, reminders).
- `consolidate-memory` — KEEP: memory hygiene; worth running quarterly.
- `code-review` — KEEP: pre-commit review of app.js-sized changes is cheap insurance.
- `ui-animation` — KEEP: webapp motion/CSS work is live.
- `article-writing` — KEEP: Phase-5 blog queue (Jaipur posts) is the next content track.
- `content-engine` — KEEP: executes the terracottage 30-day IG calendar.
- `marketing-campaign` — KEEP: terracottage launch orchestration layer.
- `carousel` — KEEP: IG carousel generator; complements (not duplicates) content-engine.
- `last30days` — KEEP: social listening for content research; heavy (96 files) but only loads on trigger.
- `deep-research` — KEEP: the engine research-ops routes to; note it expects firecrawl/exa MCPs that aren't connected.
- `research-ops` — KEEP: the single research entry point; everything else routes through it.
- `competitive-platform-analysis` + `competitive-report-structure` — KEEP ×2: two-step pipeline with real output (Loviesta/KarmaChalets brief 07-14).
- `product-lens` — KEEP: the product-diagnostic genre (06-22 doc) recurs.
- `contract-review` — KEEP: venue partnership/lease paperwork is plausible; zero cost while idle.
- `email-ops` — KEEP: Gmail MCP is connected; team@ triage fits.
- `google-workspace-ops` — KEEP: Drive folder/footage reviews recur (terracottage).
- `llm-council` — KEEP: absorbs `council` (below).

**Fix (2):**

- `watch` — FIX: works but re-learns its environment every run; its SKILL.md should carry the known env facts (yt-dlp at `~/.local/bin` needs PATH export, no Whisper key → frames-only, copy frames /tmp→outputs before Read). Currently those live only in a handoff.
- `brand-voice` — FIX (by using it): the blog voice was explicitly signed off 07-11 but never captured as a profile. Run it once over the 4 published posts so Phase-5 posts don't drift.

**Merge (2):**

- `council` → MERGE into `llm-council`: both declare the identical mandatory triggers ("council this", "pressure-test this") — which one loads is a coin flip. llm-council is the richer methodology; delete council.
- `market-research` → MERGE into `research-ops`: research-ops already claims to orchestrate it, and both trigger on "research"; keeping both invites collisions. Fold its TAM/SAM framing into research-ops if wanted.

**Remove candidates (6) — recommendations only, nothing deleted:**

- `fable` — REMOVE, strongly: it "activates" a model mode by loading a stored copy of a system prompt (with a knowledge cutoff that contradicts the real one) and instructs itself to auto-invoke at conversation start. Redundant — this product already runs the model it claims to unlock — and a self-invoking behavioral-override skill is exactly the shape prompt-injection abuse takes. Highest-priority cut.
- `brand-discovery` — REMOVE: multi-session brand-identity interview; both brands already have shipped identities (logo, voice, positioning). Shelf-ware.
- `investor-materials` — REMOVE: zero fundraising signal in two months of history.
- `investor-outreach` — REMOVE: same.
- `setup-cowork` — REMOVE: onboarding one-shot; you're onboarded.
- `caveman` — REMOVE: token-compression gimmick, no usage evidence. Keep only if you actually enjoy it.
- `morning` — FIX-or-REMOVE: generic calendar/email brief with no calendar connected. Either repoint it at your real morning surface (lead-digest results + PostHog traffic + upcoming bookings) or cut it.

## Plugin packs — verdicts

- `claude-seo` (28 skills) — KEEP: SEO is an active growth track (GSC, GBP, blog); you'll realistically use ~6 sub-skills (seo-page, seo-local, seo-google, seo-schema, seo-sitemap, seo-plan) and the rest only cost anything when triggered.
- `design` (7) — KEEP: design-critique, ux-copy, accessibility-review map directly to the webapp work (mobile passes, booking-flow copy).
- `product-management` (9) — KEEP: write-spec matches your SPEC_*.md habit; metrics-review and roadmap-update fit. Note most of its MCPs (Linear, Figma, etc.) are unauthenticated — the skills still work standalone.
- `agent-browser` (1) — KEEP: browser automation is load-bearing (GBP dashboard audit, live-site checks).
- `cowork-plugin-management` (2) — KEEP: needed to maintain plugins/skills.
- `operations` (10) — REMOVE candidate: SOC-2/CAB/vendor-review/capacity-planning is enterprise ops machinery for a two-person business; the one plausible skill (runbook) is superseded by the picnic-* skills.
- `finance` (8) — REMOVE candidate: SOX 404 testing, GAAP statements, journal entries — wrong-sized; nothing in the history touches bookkeeping. Revisit if/when real accounting lands here.

## Net effect if all recommendations are taken

38 personal skills → 29 (–2 merged, –6 removed, –1 morning if cut) plus 5 new picnic-* skills ≈ 34, but with zero trigger collisions and the five most-repeated workflows runnable by a cheaper model from spec instead of re-derived from handoff prose. Plugin surface drops from 7 packs to 5.

*Deletions are the user's action (Settings → Capabilities for skills; plugin manager for packs). Nothing was deleted in producing this audit.*
