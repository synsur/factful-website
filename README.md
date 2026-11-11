# factful.app

The website for Factful, a daily fact app for iPhone. Static HTML, CSS and JavaScript, no build step, served by
GitHub Pages from `main` with the custom domain in `CNAME`.

- `index.html` is the homepage; the hero pad tears through real facts from `assets/facts.json`.
- `privacy.html`, `terms.html` and `support.html` are linked from the app and App Store Connect: keep their paths.
- Fonts (Newsreader, OFL) are self-hosted so the site makes no third-party requests.
- `assets/facts.json` is exported from the app's library; the social card comes from `tools/make-og.swift` in the app repo.

Preview locally: `python3 -m http.server 8765`, then open http://localhost:8765.

## Fact pages

`facts/`, `today/`, `sitemap.xml` and `assets/facts/` are built by `scripts/build-facts.mjs` (Node 18+, no
dependencies) from the Factful repo's records: one page per fact Factful has posted on TikTok and Instagram, never a
fact that has not been posted. Don't edit those files by hand; change the script or `assets/facts.css`, and build again.

After each post, one command adds its page:

    git -C ~/factful fetch && node scripts/build-facts.mjs ~/factful --ref origin/rebuild-11    # the Mac
    node scripts/build-facts.mjs ~/projects/factful                                            # the PC, its checkout

- It reads `studio/records/posts.jsonl`, each run's `treatment.json` and `truth.json`, and `content/library`, from the
  ref given (or the working tree), and writes nothing in that repo.
- A run makes a page only when its truth gate passed with every result ok, on every line of its treatment as it stands,
  and the posted claim is the checked headline. Every word of a fact comes from that checked text or the post record.
  Anything else is skipped, and the script says why.
- It is idempotent: it rewrites only files whose content changed and never deletes one. `--check` writes nothing and
  exits 1 if a build would change a file.
- `scripts/fact-pages.json` holds each run's URL slug and subject, so a published URL never moves. The script adds an
  entry for a new run, which can be edited (a better slug, a `title`, or `skip` with `why`) before the page goes live.
- Pictures are copied once from the studio's assets into `assets/facts/`, resized with macOS `sips`, so a page whose
  picture is new is built on the Mac. A route's globe is drawn once from the studio's `world-atlas` land shapes.
- Every App Store link uses `APP_STORE_PROVIDER_TOKEN` at the top of the script. While it is empty they are the plain
  store URL; with the provider token (`pt=`) from App Store Connect they become the campaign link `ct=web-fact`.
