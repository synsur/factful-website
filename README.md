# factful.app

The website for Factful, a daily fact app for iPhone. Static HTML, CSS and JavaScript, no build step, served by
GitHub Pages from `main` with the custom domain in `CNAME`.

- `index.html` is the homepage; the hero pad tears through real facts from `assets/facts.json`.
- `privacy.html`, `terms.html` and `support.html` are linked from the app and App Store Connect: keep their paths.
- Fonts (Newsreader, OFL) are self-hosted so the site makes no third-party requests.
- `assets/facts.json` is exported from the app's library; the social card comes from `tools/make-og.swift` in the app repo.

Preview locally: `python3 -m http.server 8765`, then open http://localhost:8765.
