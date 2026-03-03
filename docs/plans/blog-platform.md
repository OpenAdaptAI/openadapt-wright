# blog.openadapt.ai Planning Document

**Date**: 2026-03-03
**Status**: Draft
**Author**: OpenAdapt Team

---

## 1. Goals

1. Launch a blog at `blog.openadapt.ai` for publishing guides, tutorials, and project updates.
2. Publish the first article: "Restoring macOS Desktop Folder from iCloud."
3. Attach OpenAdapt recordings to articles so readers can replay or automate the described tasks.
4. Integrate with the existing OpenAdapt automation stack (herald for social media distribution, crier for Telegram-based approval).
5. Keep costs near zero, hosting open-source-friendly, and the workflow developer-native (Git, Markdown, PRs).

---

## 2. Platform Comparison

### 2.1 Hugo + Cloudflare Pages (RECOMMENDED)

| Aspect | Detail |
|---|---|
| **Generator** | Hugo (Go-based, fastest SSG, sub-second builds for thousands of pages) |
| **Hosting** | Cloudflare Pages free tier: unlimited bandwidth, unlimited sites, 500 builds/month, custom domains, free SSL, global CDN |
| **Content format** | Markdown files in a Git repo (e.g., `OpenAdaptAI/blog.openadapt.ai`) |
| **Theme** | PaperMod, Blowfish, or Congo -- all actively maintained, minimal, fast |
| **Deploy** | Push to `main` triggers Cloudflare Pages build automatically via GitHub integration |
| **Custom domain** | CNAME `blog.openadapt.ai` pointing to `<project>.pages.dev`; Cloudflare handles SSL |
| **Cost** | $0/month (within free tier for any reasonable traffic) |

**Pros**:
- Zero ongoing cost.
- Content is plain Markdown in Git -- anyone can contribute via PR.
- Hugo's template system supports custom shortcodes for embedding recordings.
- Cloudflare Pages provides unlimited bandwidth, no throttling, and edge caching worldwide.
- Build/deploy takes seconds. Preview deploys for every PR branch.
- Full ownership of content (no vendor lock-in).
- Hugo has the largest theme ecosystem of any SSG.

**Cons**:
- No built-in CMS UI (authors must be comfortable with Git/Markdown, or use a headless CMS layer like Decap CMS).
- Hugo's Go templating syntax has a learning curve for custom layouts.
- No built-in newsletter/subscription (would need a separate service).

### 2.2 Astro + Cloudflare Pages

| Aspect | Detail |
|---|---|
| **Generator** | Astro (JS/TS-based, Islands architecture, zero JS by default) |
| **Hosting** | Same Cloudflare Pages free tier |
| **Content format** | MDX files with Content Collections (type-safe frontmatter) |
| **Cost** | $0/month |

**Pros**:
- MDX allows embedding React/Vue/Svelte components directly in posts (useful for interactive recording viewers).
- Content Collections provide schema validation for frontmatter.
- Modern developer experience (TypeScript, JSX).
- Growing ecosystem with strong blog starter templates (AstroPaper, Stablo).

**Cons**:
- Slower builds than Hugo (still fast, but measurably slower for large sites).
- Heavier toolchain (Node.js, npm/pnpm).
- Newer ecosystem; fewer themes and community resources than Hugo.
- Component islands add complexity if you just want static Markdown content.

### 2.3 Ghost (Self-Hosted)

| Aspect | Detail |
|---|---|
| **Platform** | Ghost CMS (Node.js, full CMS with editor, membership, newsletters) |
| **Hosting** | Self-hosted on a $5-10/month VPS (DigitalOcean, Hetzner) or $4/month on Coolify/Dokku |
| **Cost** | ~$5-10/month for VPS + maintenance time |

**Pros**:
- Rich WYSIWYG editor (non-technical contributors can write without Git).
- Built-in newsletter/membership system.
- SEO tools, social cards, and analytics built in.
- Beautiful default themes.

**Cons**:
- Ongoing server maintenance (updates, backups, SSL renewal if not using Cloudflare).
- $5-10/month ongoing cost.
- Content lives in a database, not in Git (harder to version, review via PR, or automate).
- Embedding custom recording widgets requires Ghost theme customization.
- Overkill for a project that values simplicity and developer tooling.

### 2.4 Ghost (Managed / Ghost Pro)

| Aspect | Detail |
|---|---|
| **Platform** | Ghost Pro managed hosting |
| **Cost** | $15/month (Starter), $29/month (Publisher) |

**Pros**:
- Zero maintenance -- Ghost team handles updates, backups, scaling.
- All Ghost features out of the box.

**Cons**:
- $180-348/year for a blog that may publish monthly.
- Same content-in-database problem as self-hosted Ghost.
- Custom domain setup is straightforward but adds vendor dependency.

### 2.5 Substack (Custom Domain)

| Aspect | Detail |
|---|---|
| **Platform** | Substack newsletter/blog platform |
| **Custom domain** | One-time $50 fee; must use `www.blog.openadapt.ai` prefix |
| **Cost** | Free (Substack takes 10% of paid subscription revenue, if any) |

**Pros**:
- Zero maintenance.
- Built-in email delivery, subscriber management, discovery network.
- Simple writing interface.

**Cons**:
- Very limited customization (no custom CSS, no shortcodes, no embedded widgets).
- Cannot embed OpenAdapt recordings or interactive content.
- Content is locked inside Substack's platform (export is possible but lossy).
- Loses Substack discovery network benefit with custom domain.
- `www.` prefix requirement is awkward for `blog.openadapt.ai`.
- No Git-based workflow; not developer-friendly.
- 10% revenue cut if paid subscriptions are ever enabled.

### 2.6 Next.js Custom Blog

| Aspect | Detail |
|---|---|
| **Framework** | Next.js (the same framework powering openadapt.ai) |
| **Hosting** | Vercel free tier or Cloudflare Pages |
| **Cost** | $0/month |

**Pros**:
- Consistent tech stack with the main openadapt.ai site.
- Maximum flexibility for custom recording viewer components.
- MDX support with full React component embedding.

**Cons**:
- Must build everything from scratch (layouts, RSS, sitemap, SEO, pagination).
- Highest development effort of all options.
- Overkill unless the blog needs heavy interactivity on every page.

---

## 3. Recommendation: Hugo + Cloudflare Pages

**Hugo + Cloudflare Pages** is the recommended platform for the following reasons:

1. **Cost**: $0/month. Cloudflare Pages free tier has no bandwidth limits, no build minute caps that matter for a blog, and free SSL on custom domains.

2. **Simplicity**: Content is Markdown in a Git repo. Publishing is `git push`. Reviewing drafts is a GitHub PR. This fits the open-source, developer-native workflow the project already uses across all `openadapt-*` repos.

3. **Speed**: Hugo builds in milliseconds. Cloudflare's edge network serves pages with sub-50ms TTFB globally.

4. **Extensibility**: Hugo shortcodes allow embedding custom HTML/JS widgets for OpenAdapt recordings without touching the theme. Example: `{{</* recording id="04d9aeaf" */>}}` could render an interactive recording viewer.

5. **No vendor lock-in**: Content is plain Markdown files. Migrating to any other SSG (Astro, Jekyll, 11ty) would require minimal effort.

6. **Mature ecosystem**: Hugo has hundreds of themes, well-documented shortcode and partial systems, and a large community.

7. **Herald/crier compatibility**: Since content lives in Git, herald can detect new blog posts via GitHub releases or merged PRs (its existing `collect` pipeline) and compose social media announcements. No API integration needed -- the Git history IS the API.

### Why not Astro?

Astro is a strong alternative and would be the second choice. It offers better component embedding via MDX. However, for a blog that primarily publishes Markdown articles with occasional embedded recordings, Hugo's simplicity and build speed win. If the blog evolves to need heavy interactive content on every page, migrating to Astro is straightforward since content is already Markdown.

### Why not Ghost?

Ghost's WYSIWYG editor is nice, but the project's contributors are developers comfortable with Markdown and Git. The database-backed content model conflicts with the PR-based review workflow used everywhere else. The ongoing hosting cost, while small, is nonzero and adds maintenance burden.

---

## 4. DNS / Domain Setup

### Prerequisites
- Access to the DNS provider managing `openadapt.ai` (the main site uses Next.js with static export; the DNS provider needs to be identified -- likely wherever the `.ai` domain was registered).

### Steps

1. **Create Cloudflare Pages project**:
   ```bash
   # In the blog repo after initial Hugo setup
   # Connect via Cloudflare dashboard: Pages > Create project > Connect to Git
   # Build command: hugo --minify
   # Build output directory: public
   # Environment variable: HUGO_VERSION = 0.145.0
   ```

2. **Add custom domain in Cloudflare Pages**:
   - Go to the Pages project > Custom domains > Add `blog.openadapt.ai`.
   - Cloudflare will provide a CNAME target (e.g., `<project>.pages.dev`).

3. **Add CNAME record at the DNS provider**:
   ```
   blog.openadapt.ai.  CNAME  <project>.pages.dev.
   ```
   - If the domain DNS is already on Cloudflare, this is automatic.
   - If DNS is elsewhere (e.g., the `.ai` registrar), add the CNAME record there.

4. **SSL**: Cloudflare Pages issues a free SSL certificate automatically once the CNAME is verified. No additional setup needed.

5. **Verification**: After DNS propagation (minutes to hours), `https://blog.openadapt.ai` will serve the Hugo site.

---

## 5. Repository Structure

Create a new repo: `OpenAdaptAI/blog.openadapt.ai`

```
blog.openadapt.ai/
  archetypes/
    default.md              # Template for new posts
  assets/
    css/
      custom.css            # Minor style overrides
  content/
    posts/
      2026-03-restore-macos-desktop-icloud/
        index.md            # Article content
        images/             # Post-specific images
        recordings/         # OpenAdapt recording files (.json, .zip)
      _index.md             # Blog listing page
  data/
    recordings/             # Shared recording metadata (optional)
  layouts/
    shortcodes/
      recording.html        # {{</* recording id="..." */>}} shortcode
      recording-step.html   # {{</* recording-step src="..." caption="..." */>}}
  static/
    recordings/             # Compiled recording viewer assets (JS/CSS)
  config/
    _default/
      hugo.toml             # Site config
      menus.toml            # Navigation
      params.toml           # Theme parameters
  .github/
    workflows/
      deploy.yml            # (Optional) CI checks; Cloudflare Pages auto-deploys
      notify-herald.yml     # Trigger herald on new post merge
  README.md
```

### Content frontmatter convention

```yaml
---
title: "Restoring macOS Desktop Folder from iCloud"
date: 2026-03-05
draft: false
tags: ["macos", "icloud", "desktop", "recovery"]
categories: ["Guides"]
recording_id: "abc123de"        # OpenAdapt recording ID
recording_steps: 15             # Number of steps in the recording
summary: >
  Step-by-step guide to recovering your Desktop folder after
  iCloud Drive sync issues, with an OpenAdapt recording you
  can replay to automate the fix.
---
```

---

## 6. OpenAdapt Recording Integration

### 6.1 What a recording contains

An OpenAdapt recording consists of:
- A sequence of before/after screenshot pairs (PNGs).
- Action metadata (click coordinates, keystrokes, text input).
- A textual step-by-step description (generated by VLM annotation).

### 6.2 Embedding approach

**Option A -- Static image gallery with step descriptions (recommended for v1)**:

Create a Hugo shortcode that renders a scrollable step-by-step viewer:

```html
<!-- layouts/shortcodes/recording.html -->
{{ $id := .Get "id" }}
{{ $dir := printf "recordings/%s" $id }}
<div class="oa-recording" data-recording-id="{{ $id }}">
  <h3>OpenAdapt Recording</h3>
  <p class="oa-recording-meta">
    This guide includes an OpenAdapt recording. You can view each
    step below or <a href="/recordings/{{ $id }}/recording.zip">download
    the full recording</a> to replay it with OpenAdapt.
  </p>
  <div class="oa-steps">
    {{ range $i, $step := (index $.Page.Params "recording_steps_data") }}
    <div class="oa-step">
      <div class="oa-step-number">Step {{ add $i 1 }}</div>
      <img src="{{ $step.screenshot }}" alt="Step {{ add $i 1 }}" loading="lazy" />
      <p>{{ $step.description }}</p>
    </div>
    {{ end }}
  </div>
</div>
```

Usage in a post:

```markdown
Follow the steps below, or use the OpenAdapt recording to automate them:

{{</* recording id="abc123de" */>}}
```

**Option B -- Interactive JS viewer (future enhancement)**:

Build a small JavaScript widget (could live in `openadapt-viewer` repo) that:
- Loads recording JSON from a URL.
- Renders a before/after screenshot slider for each step.
- Shows action overlays (click targets, drag paths).
- Provides a "Download & Replay with OpenAdapt" button.

This widget would be built once and included as a static asset in the blog.

### 6.3 Recording file hosting

Recordings contain many PNGs and can be large. Options:

| Approach | Pros | Cons |
|---|---|---|
| **Git LFS in blog repo** | Simple, versioned | LFS bandwidth limits on GitHub free tier (1GB/month) |
| **GitHub Releases** | Free, no bandwidth limits for public repos | Less convenient to reference from Hugo |
| **Cloudflare R2** | Free egress, 10GB free storage | Requires R2 bucket setup |
| **Inline in post directory** | Simplest Hugo integration | Bloats Git repo |

**Recommendation**: For v1, store compressed recording bundles (`.zip`) as GitHub Release assets on the blog repo, and include only the key screenshots (2-4 per recording) directly in the post directory. Link to the full recording download from the release.

---

## 7. Content Workflow

### 7.1 Writing and review

```
Author writes post     Pushes branch      PR review          Merge to main
in Markdown        --> to GitHub      --> (text + images) --> triggers deploy
                                          via GitHub PR
```

1. **Create branch**: `git checkout -b post/restore-macos-desktop`
2. **Write content**: Edit `content/posts/2026-03-restore-macos-desktop-icloud/index.md`
3. **Add images**: Place screenshots in the post's `images/` subdirectory.
4. **Attach recording**: Reference recording ID in frontmatter; include key screenshots.
5. **Preview locally**: `hugo server -D` (serves at `localhost:1313` with live reload).
6. **Push and open PR**: Standard GitHub PR. Cloudflare Pages creates a preview deploy on the PR branch (e.g., `https://<hash>.blog-openadapt-ai.pages.dev`).
7. **Review**: Team reviews content, screenshots, recording references.
8. **Merge**: Squash-merge to `main`. Cloudflare Pages auto-deploys to `blog.openadapt.ai`.

### 7.2 Social media distribution via herald

When a new post merges to `main`, trigger herald to announce it:

**Option A -- GitHub Actions workflow (recommended)**:

```yaml
# .github/workflows/notify-herald.yml
name: Announce new blog post
on:
  push:
    branches: [main]
    paths: ['content/posts/**']

jobs:
  announce:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Detect new post
        id: detect
        run: |
          NEW_POST=$(git diff --name-only HEAD~1 HEAD -- content/posts/ \
            | grep 'index.md' | head -1)
          if [ -n "$NEW_POST" ]; then
            TITLE=$(grep '^title:' "$NEW_POST" | sed 's/title: *"//;s/"$//')
            SLUG=$(dirname "$NEW_POST" | xargs basename)
            echo "title=$TITLE" >> "$GITHUB_OUTPUT"
            echo "url=https://blog.openadapt.ai/posts/$SLUG/" >> "$GITHUB_OUTPUT"
            echo "found=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Announce via herald
        if: steps.detect.outputs.found == 'true'
        run: |
          pip install herald-announce
          herald publish \
            --content-type spotlight \
            --title "${{ steps.detect.outputs.title }}" \
            --url "${{ steps.detect.outputs.url }}" \
            --repos OpenAdaptAI/blog.openadapt.ai
        env:
          HERALD_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          HERALD_DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
          HERALD_TWITTER_CONSUMER_KEY: ${{ secrets.TWITTER_CONSUMER_KEY }}
          HERALD_TWITTER_CONSUMER_SECRET: ${{ secrets.TWITTER_CONSUMER_SECRET }}
          HERALD_TWITTER_ACCESS_TOKEN: ${{ secrets.TWITTER_ACCESS_TOKEN }}
          HERALD_TWITTER_ACCESS_TOKEN_SECRET: ${{ secrets.TWITTER_ACCESS_TOKEN_SECRET }}
          HERALD_LINKEDIN_ACCESS_TOKEN: ${{ secrets.LINKEDIN_ACCESS_TOKEN }}
```

**Option B -- Crier watches the blog repo**:

Add `OpenAdaptAI/blog.openadapt.ai` to crier's `CRIER_REPOS` list. Crier will detect merged PRs that add new posts, score them for interest, draft announcements, and send them to Telegram for approval before posting via herald.

This is the more hands-off approach: crier handles the "should we post?" decision and human review loop automatically.

### 7.3 Recommended combined approach

Use **both**:
- **Crier** as the default, always-on watcher. It monitors the blog repo alongside all other OpenAdapt repos. New posts automatically trigger draft announcements for Telegram approval.
- **Herald direct** (via the GitHub Actions workflow) as a manual fallback or for urgent announcements that should bypass the interest-scoring step.

---

## 8. Cost Summary

| Component | Monthly Cost |
|---|---|
| Cloudflare Pages hosting | $0 |
| Custom domain DNS (CNAME) | $0 (part of existing domain) |
| SSL certificate | $0 (Cloudflare automatic) |
| Hugo (open source) | $0 |
| GitHub repo (public) | $0 |
| Herald social media posting | $0 (uses existing API keys) |
| LLM calls for herald/crier | ~$0.01-0.05 per announcement |
| Recording file hosting (GitHub Releases) | $0 |
| **Total** | **~$0/month** |

---

## 9. Implementation Roadmap

### Phase 1: Foundation (1-2 days)

- [ ] Create `OpenAdaptAI/blog.openadapt.ai` GitHub repo.
- [ ] Initialize Hugo project with a clean theme (PaperMod or Congo).
- [ ] Configure `hugo.toml` with site metadata, OpenAdapt branding.
- [ ] Set up Cloudflare Pages project connected to the repo.
- [ ] Add CNAME record for `blog.openadapt.ai`.
- [ ] Verify the site is live at `https://blog.openadapt.ai`.

### Phase 2: First Post (1 day)

- [ ] Write "Restoring macOS Desktop Folder from iCloud" article.
- [ ] Record the task with OpenAdapt (local demo via openadapt-capture or manual screenshots).
- [ ] Create the `recording` shortcode for embedding step-by-step screenshots.
- [ ] Add recording screenshots and ZIP to the post.
- [ ] Publish via PR merge.

### Phase 3: Herald/Crier Integration (1 day)

- [ ] Add `notify-herald.yml` GitHub Actions workflow to the blog repo.
- [ ] Add `OpenAdaptAI/blog.openadapt.ai` to crier's watched repos.
- [ ] Test the end-to-end flow: merge post PR, verify crier sends Telegram draft, approve, verify social media posts.

### Phase 4: Enhancements (ongoing)

- [ ] Build interactive recording viewer widget (JS-based before/after slider).
- [ ] Add RSS feed (Hugo generates this automatically with most themes).
- [ ] Add "Run with OpenAdapt" button that deep-links to the OpenAdapt desktop app or web installer.
- [ ] Add optional Decap CMS (formerly Netlify CMS) for non-developer contributors.
- [ ] Consider Cloudflare R2 for large recording file hosting if GitHub Release approach hits limits.
- [ ] Add search (Pagefind -- a lightweight static search index that integrates well with Hugo).

---

## 10. Alternative Hosting: Netlify or Vercel

If Cloudflare Pages is not preferred for any reason, both Netlify and Vercel offer comparable free tiers:

| Provider | Free Tier Limits | Custom Domain | Build Minutes |
|---|---|---|---|
| Cloudflare Pages | Unlimited bandwidth, 500 builds/mo | Yes, free SSL | 500/mo |
| Netlify | 100GB bandwidth/mo, 300 build minutes/mo | Yes, free SSL | 300/mo |
| Vercel | 100GB bandwidth/mo | Yes, free SSL | 6000 min/mo |
| GitHub Pages | 100GB bandwidth/mo, 10 builds/hr | Yes (CNAME), free SSL | N/A (Actions minutes) |

Cloudflare Pages is recommended due to unlimited bandwidth and the best CDN performance, but any of these would work.

---

## 11. Open Questions

1. **DNS provider**: Where is `openadapt.ai` currently registered, and who manages DNS? This determines how to add the `blog` CNAME record.
2. **OpenAdapt recording format**: Is there a standardized export format for recordings that the blog widget should consume? If not, define one.
3. **Non-developer contributors**: Will non-developers need to write blog posts? If yes, adding Decap CMS (a Git-backed headless CMS with a web UI) should be prioritized in Phase 4.
4. **Newsletter**: Is email newsletter distribution desired? If so, a service like Buttondown ($0 for <100 subscribers) or Mailchimp free tier could be added, with a subscription form embedded in the blog.
