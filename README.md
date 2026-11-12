# factful.app

The website for Factful, a daily fact app for iPhone. Static HTML, CSS and JavaScript, no build step, served by
GitHub Pages from `main` with the custom domain in `CNAME`.

- `index.html` is the homepage; the hero pad tears through real facts from `assets/facts.json`.
- `privacy.html`, `terms.html` and `support.html` are linked from the app and App Store Connect: keep their paths.
- Fonts (Newsreader, OFL) are self-hosted so the site makes no third-party requests.
- `assets/facts.json` is exported from the app's library; the social card comes from `tools/make-og.swift` in the app repo.

Preview locally: `python3 -m http.server 8765`, then open http://localhost:8765.

## Fact pages

`facts/`, `today/`, `sitemap.xml` and `assets/facts/` are built by `scripts/build-facts.mjs` (Node 18+ and ffmpeg, no
npm dependencies) from the Factful repo's records: one page per fact Factful has posted on TikTok and Instagram, never a
fact that has not been posted. Don't edit those files by hand; change the script or `assets/facts.css`, and build again.

The PC publishes them each night at 23:45, after it commits the day's records (factful D-067). Factful's `fact-pages`
job runs the PC line below in `~/projects/factful-website` and pushes what changed. A hold on factful from the phone
stops it. To build by hand:

    git -C ~/factful fetch && node scripts/build-facts.mjs ~/factful --ref origin/rebuild-11    # the Mac
    node scripts/build-facts.mjs ~/projects/factful                                            # the PC, its checkout

- It reads `studio/records/posts.jsonl`, each run's `treatment.json` and `truth.json`, and `content/library`, from the
  ref given (or the working tree), and writes nothing in that repo.
- A run makes a page only when its truth gate passed with every result ok, on every line of its treatment as it stands,
  and the posted claim is the checked headline. Every word of a fact comes from that checked text or the post record.
  Anything else is skipped, and the script says why.
- It is idempotent: it rewrites only files whose content changed and never deletes one. `--check` writes nothing and
  exits 1 if a build would change a file.
- `scripts/fact-pages.json` holds each run's URL slug and subject, so a published URL never moves. The build adds an
  entry for each new run, and the PC publishes its page the same night. An entry written ahead (a better slug, or
  `skip` with `why`) is kept. A `title` can change any time; a page already up stays until its folder is removed by
  hand.
- Pictures are made once from the studio's assets into `assets/facts/` with ffmpeg; those made before 2026-11-12 used
  macOS `sips` and are kept. The studio's images are not in git, so the PC has the ones copied to it (Factful's
  `studio/scripts/assets-to-pc.sh`). A page whose picture is missing there is built without it, and gains it on the
  first build after it arrives. ffmpeg cannot read a source over about 268 megapixels; make that one on the Mac.
- A route's globe is drawn once from world-atlas's 1:50m land shapes in `scripts/data/` (ISC; the data is Natural
  Earth's, public domain).
- Every App Store link uses `APP_STORE_PROVIDER_TOKEN` at the top of the script. While it is empty they are the plain
  store URL; with the provider token (`pt=`) from App Store Connect they become the campaign link `ct=web-fact`.
