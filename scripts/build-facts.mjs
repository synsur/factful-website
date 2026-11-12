#!/usr/bin/env node
// factful.app's fact pages, built from the Factful studio's records.
//
//   node scripts/build-facts.mjs <factful repo> [--ref <git ref>] [--check]
//
// One page per piece already posted to TikTok and Instagram (studio/records/posts.jsonl), and never an unposted
// library fact. Each page carries the claim as posted, its explanation, the source it was checked against and when,
// the subject, and links to the posts. Every word of a fact comes from checked text: the library record
// (content/library) for a fact with an id, or for a lab post the treatment's own lines, which the truth gate passed
// (studio/runs/<run>/truth.json). A run that fails any check is skipped and named, never published half-checked.
//
// It also writes /facts/ (every fact), a page per subject, /today/ (the latest post) and /sitemap.xml. Run it again
// after each post. It is idempotent, and a page's URL never changes once scripts/fact-pages.json records its slug.
//
// --ref reads the studio's files from a git ref instead of the working tree, e.g. origin/rebuild-11, the branch the
// PC commits the records to (fetch first). Pictures come from the working tree's studio/public/assets, whose images git
// does not hold: a picture not yet in assets/facts/ is made there with ffmpeg, or the page is built without it and the
// script says so. A route's globe is drawn the same once, from world-atlas's 1:50m land shapes, which travel with this
// script (scripts/data/land-50m.json, ISC; Natural Earth's data is public domain). --check builds everything in memory,
// writes nothing, and exits 1 if any file would change.
//
// The PC runs this each night after it commits the day's records, and pushes what changed (factful D-067).
//
// Node 18 or later and ffmpeg with ffprobe; no npm dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://factful.app';
const TZ = 'America/Toronto'; // the studio's day (factful's kontrol.yaml): a post's date is its date there

// The App Store link on every page. Fill in Factful's provider token (App Store Connect › App Analytics › Campaign
// links: the number after pt=) and these pages link with the campaign ct=web-fact; while it is empty they use the plain
// store URL. Run the script again after changing it.
const APP_STORE_PROVIDER_TOKEN = '';
const APP_ID = '6746733914';
const APP_STORE = APP_STORE_PROVIDER_TOKEN
  ? `https://apps.apple.com/app/apple-store/id${APP_ID}?pt=${encodeURIComponent(APP_STORE_PROVIDER_TOKEN)}&ct=web-fact&mt=8`
  : `https://apps.apple.com/us/app/factful-daily-facts/id${APP_ID}`;
const APP_NAME = 'Factful - Daily Facts'; // the App Store name: "Factful" alone collides with Rosling's Factfulness
const HELP = 'help@factful.app';
const ACCOUNTS = { tiktok: 'https://www.tiktok.com/@factful.app', instagram: 'https://www.instagram.com/app.factful/' };
const PLATFORMS = { tiktok: 'TikTok', instagram: 'Instagram' };

// The app's seven subjects (content/GUIDE.md), with the glyphs site.js draws for them.
const SUBJECTS = {
  science: 'Science', history: 'History', nature: 'Nature', space: 'Space',
  technology: 'Technology', psychology: 'Psychology', geography: 'Geography',
};
const GLYPHS = {
  science: 'M9 3h6M10 3v6.2L4.8 18.1A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.9L14 9.2V3M7.4 15h9.2',
  history: 'M3 21h18M5 18h14M6.5 18v-7.5M10 18v-7.5M14 18v-7.5M17.5 18v-7.5M4 10.5h16L12 4z',
  nature: 'M5 20c0-9 5.5-14.5 15-15 0 9.5-5.5 15-15 15zM5 20l8.5-8.5',
  space: 'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0zM2.8 16.3c-.9-1.7 3.1-4.9 8.9-7s10.6-2.4 11.5-.7',
  technology: 'M7 7h10v10H7zM10 10h4v4h-4zM9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4',
  psychology: 'M12 12a1 1 0 0 1 2 0 2 2 0 0 1-4 0 3 3 0 0 1 6 0 4 4 0 0 1-8 0 5 5 0 0 1 10 0',
  geography: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
};

const LEDGER = 'scripts/fact-pages.json';
const PICTURES = 'assets/facts';
const RESERVED = new Set([...Object.keys(SUBJECTS), 'index', 'today', 'all']);
const MARK = '<!-- Built by scripts/build-facts.mjs from the Factful studio\'s records. Change the script, not this file. -->';

const USAGE = `Usage: node scripts/build-facts.mjs <factful repo> [--ref <git ref>] [--check]

  <factful repo>  the Factful repo (it reads studio/records, studio/runs and content/library; it writes nothing there)
  --ref <ref>     read those files from this git ref, e.g. origin/rebuild-11 (fetch first), not the working tree
  --check         build in memory, write nothing, exit 1 if any file would change`;

// ---------------------------------------------------------------------------------------------------------------------
// Arguments. Anything unrecognised stops the script: an unknown flag is never taken as "go".

function die(message) {
  console.error(`build-facts: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { repo: null, ref: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (a === '--check') o.check = true;
    else if (a === '--ref') { o.ref = argv[++i]; if (!o.ref || o.ref.startsWith('-')) die('--ref needs a git ref'); }
    else if (a.startsWith('--ref=')) o.ref = a.slice('--ref='.length);
    else if (a.startsWith('-')) die(`unknown option ${a}\n\n${USAGE}`);
    else if (!o.repo) o.repo = path.resolve(a);
    else die(`one repo path only, got a second: ${a}\n\n${USAGE}`);
  }
  if (!o.repo) die(`which Factful repo?\n\n${USAGE}`);
  if (!fs.existsSync(path.join(o.repo, 'studio', 'records'))) die(`${o.repo} has no studio/records: is it the Factful repo?`);
  return o;
}

/** Reads a file of the Factful repo, from the working tree or from one commit, so a build sees one consistent state. */
function studioReader(repo, ref) {
  if (!ref) {
    return {
      label: `${repo} (working tree)`,
      read: (p) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return null; } },
    };
  }
  const rev = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8' });
  if (rev.status !== 0) die(`${repo} has no git ref ${ref}`);
  const sha = rev.stdout.trim();
  return {
    label: `${repo} at ${ref} (${sha.slice(0, 7)})`,
    read(p) {
      const r = spawnSync('git', ['-C', repo, 'show', `${sha}:${p}`], { encoding: 'utf8', maxBuffer: 256 << 20 });
      return r.status === 0 ? r.stdout : null;
    },
  };
}

const parse = (text, what) => {
  try { return JSON.parse(text); } catch (e) { throw new Error(`${what} is not valid JSON: ${e.message}`); }
};

// ---------------------------------------------------------------------------------------------------------------------
// Dates. A post's day is its day in Toronto; a library record's `verified` is already a day.

/** A moment in the studio's time with its offset, so the date in the markup is the date the page shows. */
function stampOf(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const offset = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.replace('GMT', '');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

function dayOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`not a time: ${iso}`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());
const noon = (day) => new Date(`${day}T12:00:00Z`);
const fmtDay = (day, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(noon(day));
const longDate = (day) => fmtDay(day, { dateStyle: 'long' }); // September 29, 2026, as the app prints it
const weekday = (day) => fmtDay(day, { weekday: 'long' });
const monthOf = (day) => fmtDay(day, { month: 'long' });
const shortMonth = (day) => fmtDay(day, { month: 'short' });
const yearOf = (day) => day.slice(0, 4);
const dayNumber = (day) => String(Number(day.slice(8, 10)));
const dayOfYear = (day) => Math.round((noon(day) - Date.UTC(Number(day.slice(0, 4)), 0, 1, 12)) / 86400000) + 1;

// ---------------------------------------------------------------------------------------------------------------------
// Text.

const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => html(s).replace(/"/g, '&quot;');
const jsonld = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

function slugify(s, maxWords = 9) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’‘]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(/\s+/).slice(0, maxWords).join('-');
}

/** Sentences, split only where a stop is followed by a space, so 13.8 and 11:59:33 stay whole. */
const sentences = (text) => String(text).split(/(?<=[.!?…]["”’)]?)\s+/).filter(Boolean);

/** A description of at most `max` characters: whole sentences while they fit, else cut at a word. */
function summary(texts, max = 160) {
  let out = '';
  for (const s of texts.flatMap(sentences)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length <= max) { out = next; continue; }
    if (out.length >= 90) break;
    const cut = next.slice(0, max - 1);
    return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:–—-]+$/, '')}…`;
  }
  return out;
}

/** A source's name, from its URL: Wikipedia and Wikisource pages by their titles, anything else by its site. */
function sourceFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return { publisher: url, title: null, url }; }
  const wiki = /^[a-z-]+\.(wikipedia|wikisource)\.org$/.exec(u.hostname);
  if (wiki && u.pathname.startsWith('/wiki/')) {
    const title = decodeURIComponent(u.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
    return { publisher: wiki[1] === 'wikipedia' ? 'Wikipedia' : 'Wikisource', title, url };
  }
  return { publisher: u.hostname.replace(/^www\./, ''), title: null, url };
}

/** A treatment's source line, `Publisher, "Title"` or just `Publisher`. */
function sourceFromLine(line, url) {
  const m = /^(.+?),\s*"(.+)"$/.exec(String(line ?? '').trim());
  return m ? { publisher: m[1], title: m[2], url } : { publisher: String(line ?? '').trim() || sourceFromUrl(url).publisher, title: null, url };
}

// ---------------------------------------------------------------------------------------------------------------------
// The ledger: the URL slug and subject each posted run got, so a published URL never moves.

function loadLedger() {
  const file = path.join(SITE, LEDGER);
  if (!fs.existsSync(file)) return { about: '', pages: {} };
  const l = parse(fs.readFileSync(file, 'utf8'), LEDGER);
  if (!l.pages || typeof l.pages !== 'object') throw new Error(`${LEDGER} has no "pages"`);
  return l;
}

function ledgerText(ledger) {
  const pages = {};
  for (const run of Object.keys(ledger.pages).sort()) pages[run] = ledger.pages[run];
  return `${JSON.stringify({
    about: ledger.about || 'The fact pages, one per posted run: its URL slug, never changed once live; its subject; '
      + 'optionally a <title> in place of the posted claim; and "skip" with "why" to leave a run off the site. '
      + 'scripts/build-facts.mjs adds an entry for each new post and never rewrites one.',
    pages,
  }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// One run: its posts, its checked text, and the page made of them, or the reason it gets none.

function postsByRun(text) {
  const runs = new Map();
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const row = parse(line, `posts.jsonl line ${i + 1}`);
    if (!row.run) return;
    if (!runs.has(row.run)) runs.set(row.run, []);
    runs.get(row.run).push(row);
  });
  return runs;
}

/** The truth gate's verdict: passed, with every result ok, and a result for each line the script has now. */
function gate(truth, t) {
  if (!truth) return 'it has no truth.json: the truth gate never ran';
  if (truth.verdict !== 'pass') return `the truth gate's verdict is "${truth.verdict}"`;
  const bad = (truth.results ?? []).filter((r) => r.status !== 'ok');
  if (bad.length) return `the truth gate has ${bad.length} result(s) that are not ok (${bad[0].where})`;
  const lines = new Set((truth.results ?? []).map((r) => r.where).filter((w) => /^line \d+$/.test(w)));
  for (let i = 1; i <= (t.lines ?? []).length; i++) {
    if (!lines.has(`line ${i}`)) return `truth.json has no result for line ${i}: the treatment changed after the gate ran`;
  }
  return null;
}

/** The pictures a run's treatment showed, with the caption and credit its gate checked. */
function figuresOf(t, truth) {
  const out = { lead: null, after: [], details: [], test: null };
  const plate = (o) => (o?.asset ? { kind: 'plate', asset: o.asset, caption: o.caption ?? null, credit: o.credit ?? null, crop: o.crop ?? null } : null);
  if (t.fact) {
    const scenes = t.scenes ?? [];
    const scale = scenes.find((s) => s.kind === 'scale' && s.shape === 'circle' && s.items?.length > 1 && s.items.every((it) => it.photo?.asset));
    const picture = scenes.find((s) => s.kind === 'picture' && s.asset && s.caption);
    const photo = scenes.find((s) => s.photo?.asset && s.photo.caption);
    if (scale) {
      out.lead = {
        kind: 'scale',
        credit: scale.items[0].photo.credit ?? null,
        items: scale.items.map((it) => ({ label: it.label, display: it.display, value: it.value, asset: it.photo.asset, crop: it.photo.crop ?? null })),
      };
    } else if (picture) out.lead = plate(picture);
    else if (photo) out.lead = plate(photo.photo);
    return out;
  }
  if (t.plates) out.lead = plate(t.plates);
  else if (t.zoom) {
    out.lead = plate(t.zoom);
    out.details = (t.zoom.stops ?? []).filter((s) => s.label && s.rect).map((s) => ({ asset: t.zoom.asset, rect: s.rect, label: s.label, mark: s.mark ?? null }));
  } else if (t.document) out.lead = plate(t.document);
  else if (t.route?.points?.length >= 2) {
    // A route is drawn only when the gate checked every place on it; a total it did not check is left off.
    const ok = new Set((truth?.results ?? []).filter((r) => r.status === 'ok').map((r) => r.where));
    if (t.route.points.every((_, i) => ok.has(`place ${i + 1}`))) {
      out.lead = {
        kind: 'route',
        points: t.route.points.map(({ name, lon, lat }) => ({ name, lon, lat })),
        totals: [['Distance', t.route.distance, 'distance'], ['Time', t.route.duration, 'duration']]
          .filter(([, v, where]) => v && Number.isFinite(v.value) && v.unit && ok.has(where)).map(([label, v]) => ({ label, ...v })),
      };
    }
  }
  // A calendar's pictures belong to its events; the page draws the calendar itself, as a timeline.
  if (t.try) {
    if (t.try.test === 'blind-spot') out.test = 'blind-spot';
    else out.test = { unsupported: t.try.test };
    if (t.try.explain) out.after.push(plate(t.try.explain));
  }
  out.after = out.after.filter(Boolean);
  return out;
}

/** A lab treatment's lines as the page's text: the headline left out, instructions as steps, quotes together, a
 * calendar as a timeline, and the rest as paragraphs, broken where the voice took a long beat. */
function labText(t, headline) {
  const blocks = [];
  const steps = [];
  const urls = [];
  const lines = t.lines ?? [];
  let k = 0;
  while (k < lines.length && lines[k].text === headline) k++;
  let para = null;
  const flush = () => { if (para) blocks.push({ type: 'p', text: para.join(' '), lines: para }); para = null; };
  for (let j = k; j < lines.length; j++) {
    const l = lines[j];
    if (l.url) urls.push(l.url);
    if (l.kind === 'instruction') { flush(); steps.push(l.text); continue; }
    if (l.quote) {
      flush();
      const group = [l];
      while (lines[j + 1]?.quote && lines[j + 1].group === l.group) { group.push(lines[++j]); if (lines[j].url) urls.push(lines[j].url); }
      const title = group.filter((g) => !/[a-z]/.test(g.text)).map((g) => g.text).join(' ');
      const text = group.filter((g) => /[a-z]/.test(g.text)).map((g) => g.text).join(' ');
      blocks.push({ type: 'quote', title, text, cite: group.find((g) => g.url)?.url ?? null });
      continue;
    }
    if (t.calendar && l.kind === 'claim' && lines[j + 1]?.kind === 'mapped' && lines[j + 1].group === l.group) {
      flush();
      const item = { claim: l.text, when: lines[++j].text };
      const last = blocks[blocks.length - 1];
      if (last?.type === 'timeline') last.items.push(item); else blocks.push({ type: 'timeline', items: [item] });
      continue;
    }
    const gap = l.gap ?? 0;
    if (para && (gap >= 1 || (gap >= 0.5 && para.join(' ').length >= 60))) flush();
    (para ??= []).push(l.text);
  }
  flush();
  // The first paragraph reads as the standfirst, as a library record's hook does. A long one gives it only its
  // first lines, about two sentences' worth, and keeps the rest; the words and their order never change.
  const first = blocks[0];
  if (first?.type === 'p' && first.text.length <= 170) blocks[0] = { type: 'stand', text: first.text };
  else if (first?.type === 'p') {
    let n = 1;
    while (n < first.lines.length - 1 && first.lines.slice(0, n + 1).join(' ').length <= 120) n++;
    blocks.splice(0, 1, { type: 'stand', text: first.lines.slice(0, n).join(' ') },
      ...(n < first.lines.length ? [{ type: 'p', text: first.lines.slice(n).join(' ') }] : []));
  }
  // A paragraph that closes a timeline is its payoff.
  const last = blocks[blocks.length - 1];
  if (last?.type === 'p' && blocks[blocks.length - 2]?.type === 'timeline') blocks[blocks.length - 1] = { type: 'payoff', text: last.text };
  return { blocks, steps, urls };
}

function buildRun(run, rows, read, entry) {
  if (entry?.skip) return { skip: `the ledger skips it: ${entry.why ?? 'no reason given'}` };
  const kinds = new Set(rows.map((r) => r.kind));
  if (kinds.size !== 1 || !kinds.has('value')) return { skip: `its posts are ${[...kinds].join('/')}, not a value post` };
  const hooks = new Set(rows.map((r) => r.hook));
  if (hooks.size !== 1) return { skip: 'its posts carry different claims' };
  const headline = rows[0].hook;
  if (!headline) return { skip: 'its posts record no claim' };

  const links = {};
  for (const r of [...rows].sort((a, b) => Date.parse(a.posted_at) - Date.parse(b.posted_at))) {
    if (PLATFORMS[r.platform] && !links[r.platform] && /^https:\/\//.test(r.url ?? '')) links[r.platform] = r.url;
  }
  if (!Object.keys(links).length) return { skip: 'no TikTok or Instagram post with a URL' };
  const posted = rows.map((r) => r.posted_at).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  if (!posted) return { skip: 'no post time' };

  const tText = read(`studio/runs/${run}/treatment.json`);
  if (!tText) return { skip: 'no treatment.json at this ref' };
  const t = parse(tText, `${run}/treatment.json`);
  const truthText = read(`studio/runs/${run}/truth.json`);
  const failed = gate(truthText ? parse(truthText, `${run}/truth.json`) : null, t);
  if (failed) return { skip: failed };
  if (t.headline !== headline) return { skip: `the posted claim "${headline}" is not the checked headline "${t.headline}"` };
  const truth = parse(truthText, `${run}/truth.json`);

  const figures = figuresOf(t, truth);
  if (figures.test?.unsupported) return { skip: `its test "${figures.test.unsupported}" is not drawn on the web yet` };

  const ids = rows[0].fact_ids ?? [];
  let model;
  if (ids.length) {
    if (ids.length > 1) return { skip: `one post with ${ids.length} library facts: a page holds one` };
    const id = ids[0];
    const cat = id.replace(/-\d+$/, '');
    const libText = read(`content/library/${cat}.json`);
    const record = libText ? parse(libText, `content/library/${cat}.json`).find((r) => r.id === id) : null;
    if (!record) return { skip: `library fact ${id} not found` };
    if (!SUBJECTS[record.category]) return { skip: `library fact ${id} has no known subject` };
    if (!isDay(record.verified)) return { skip: `library fact ${id} has no checked date` };
    if (!record.source?.url || !record.detail) return { skip: `library fact ${id} has no source or explanation` };
    const blocks = [];
    if (record.hook && record.hook !== headline) blocks.push({ type: 'stand', text: record.hook });
    blocks.push({ type: 'p', text: record.detail });
    model = {
      factId: id,
      subject: record.category,
      autoSlugFrom: record.hook || headline,
      blocks, steps: [],
      source: { publisher: record.source.publisher, title: record.source.title ?? null, url: record.source.url },
      also: [],
      checked: record.verified,
    };
  } else {
    if (!t.sourceUrl) return { skip: 'its treatment names no source URL' };
    if (!truth.checked) return { skip: 'truth.json has no checked time' };
    const { blocks, steps, urls } = labText(t, headline);
    if (!blocks.length) return { skip: 'its checked lines leave no explanation once the claim is the headline' };
    const seen = new Set([t.sourceUrl]);
    const also = [];
    for (const u of urls) if (!seen.has(u)) { seen.add(u); also.push(sourceFromUrl(u)); }
    model = {
      factId: null,
      subject: null,
      autoSlugFrom: headline,
      blocks, steps,
      source: sourceFromLine(t.source, t.sourceUrl),
      also,
      checked: dayOf(truth.checked),
    };
    const pkgText = read(`studio/runs/${run}/package.json`);
    const pkg = pkgText ? parse(pkgText, `${run}/package.json`) : {};
    const tags = ['tiktok', 'instagram', 'youtube'].flatMap((p) => pkg[p]?.hashtags ?? []).map((h) => String(h).replace(/^#/, '').toLowerCase());
    model.subjectHint = [t.category, t.subject, ...tags].find((s) => SUBJECTS[s]) ?? null;
  }
  if (/\bth(?:is|ese)\b/i.test(headline) && !figures.lead && !figures.test) {
    model.warning = `its claim points at something ("${headline}") and the treatment has no picture the page can show`;
  }
  return { page: { run, headline, posted, stamp: stampOf(posted), day: dayOf(posted), links, profile: t.profile ?? rows[0].profile ?? null, figures, ...model } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pictures: web copies in assets/facts/, each with a small record of where it came from. They are made once, on the
// machine that holds the studio's assets, and never remade.

// ffmpeg rather than macOS `sips`, which made the pictures up to 2026-11-11: the PC builds these pages each night and
// has no sips. Both machines have ffmpeg. A picture already made is never made again, so the switch changed none.
const ffmpegAvailable = (() => {
  let known;
  return () => (known ??= ['ffmpeg', 'ffprobe'].every((t) => spawnSync(t, ['-version'], { encoding: 'utf8' }).status === 0));
})();

// Pixel formats that can carry transparency, as ffprobe names them (pal8: a palette PNG may hold transparent entries).
const ALPHA_FORMATS = /^(rgba|bgra|argb|abgr|ya8|ya16|rgba64|bgra64|yuva|gbrap|pal8)/;

// ffprobe reads 0×0 for an image it cannot decode: one over about 268 megapixels, like the 30000×29560 Holbein plate
// (its pictures were made with sips before the switch), or a file that is not an image.
function imageInfo(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt',
    '-of', 'json', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let st = {};
  try { st = JSON.parse(r.stdout || '{}').streams?.[0] ?? {}; } catch { st = {}; }
  return { width: Number(st.width) || 0, height: Number(st.height) || 0, alpha: ALPHA_FORMATS.test(st.pix_fmt ?? '') };
}

function ffmpeg(args) {
  // -nostdin: run from a script piped over ssh, ffmpeg would otherwise read the rest of that script as input.
  const r = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args.map(String)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
}

// JPEG quality for ffmpeg's encoder (-q:v, 2 best to 31 worst). At 3, on five of the pictures sips made at 76
// (2026-11-12), ffmpeg kept their sizes in pixels exactly, looked the same side by side at full size, and wrote files
// 11–56% smaller. The sources are sRGB, and ffmpeg writes no colour profile, which browsers read as sRGB.
const JPEG_Q = 3;

const PICTURE_LICENCES = /^(public domain|cc0|cc by \d(\.\d)?)$/i;

function picture(name, { asset, rect = null, max = 1200 }, ctx) {
  const base = path.join(SITE, PICTURES, name);
  if (fs.existsSync(`${base}.json`)) {
    const meta = parse(fs.readFileSync(`${base}.json`, 'utf8'), `${PICTURES}/${name}.json`);
    if (fs.existsSync(path.join(SITE, PICTURES, meta.file))) return meta;
  }
  if (ctx.check) { ctx.notes.push(`picture ${name} is not in ${PICTURES}/`); return null; }
  const recText = (() => { try { return fs.readFileSync(path.join(ctx.repo, 'studio/public/assets', `${asset}.json`), 'utf8'); } catch { return null; } })();
  if (!recText) { ctx.notes.push(`picture ${name}: ${asset}'s record is not on this machine (studio/public/assets)`); return null; }
  const rec = parse(recText, `${asset}.json`);
  if (!PICTURE_LICENCES.test(rec.licence ?? '')) { ctx.notes.push(`picture ${name}: its licence "${rec.licence}" is not one these pages reuse`); return null; }
  const src = path.join(ctx.repo, 'studio/public/assets', rec.file);
  if (!fs.existsSync(src)) { ctx.notes.push(`picture ${name}: ${rec.file} is not on this machine`); return null; }
  if (!ffmpegAvailable()) { ctx.notes.push(`picture ${name}: making it needs ffmpeg and ffprobe on this machine`); return null; }

  const info = imageInfo(src);
  if (!info.width || !info.height) {
    ctx.notes.push(`picture ${name}: ffmpeg cannot read ${rec.file} (over its size limit of about 268 megapixels, or not an image)`);
    return null;
  }
  const ext = /\.png$/i.test(rec.file) && info.alpha ? '.png' : '.jpg';
  const out = `${base}${ext}`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // One pass: the crop at full resolution, then the longer side down to `max` (Lanczos). An offset is never less
  // than one pixel, as it was with sips, so a crop made on either tool covers the same pixels.
  const filters = [];
  let w = info.width;
  let h = info.height;
  if (rect) {
    const x = Math.max(1, Math.round(rect.x * info.width));
    const y = Math.max(1, Math.round(rect.y * info.height));
    w = Math.min(info.width - x, Math.round(rect.w * info.width));
    h = Math.min(info.height - y, Math.round(rect.h * info.height));
    filters.push(`crop=${w}:${h}:${x}:${y}`);
  }
  if (Math.max(w, h) > max) filters.push(`${w >= h ? `scale=${max}:-2` : `scale=-2:${max}`}:flags=lanczos`);
  ffmpeg(['-i', src, ...(filters.length ? ['-vf', filters.join(',')] : []), '-frames:v', '1', '-update', '1',
    ...(ext === '.png' ? [] : ['-q:v', JPEG_Q]), out]);
  const made = imageInfo(out);
  const meta = {
    file: path.basename(out), width: made.width, height: made.height, asset, rect,
    original: rec.title ?? null, page: rec.page ?? null, source: rec.source ?? null,
    licence: rec.licence, licenceUrl: rec.licenceUrl ?? null,
  };
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(meta, null, 2)}\n`);
  ctx.notes.push(`made ${PICTURES}/${meta.file} (${made.width}×${made.height})`);
  return meta;
}

// A route on a globe, as the V14 engine draws it (studio/src/engines/lab/Route.tsx): the Natural Earth land shapes the
// studio already has (world-atlas, 1:50m), seen from above the middle of the route, with great circles between the
// places named. Drawn once into an SVG with no dependency; a picture of the route, so it is never redrawn by hand.
const RAD = Math.PI / 180;
const toVec = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const toLonLat = ([x, y, z]) => [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];

function greatCircle(a, b, n) {
  const A = toVec(a), B = toVec(b);
  const d = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n;
    const fa = d ? Math.sin((1 - t) * d) / Math.sin(d) : 1 - t;
    const fb = d ? Math.sin(t * d) / Math.sin(d) : t;
    return toLonLat([0, 1, 2].map((i) => fa * A[i] + fb * B[i]));
  });
}

/** The polygons of a TopoJSON land object, as rings of [lon, lat]. */
function topoRings(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
  const ring = (ids) => ids.flatMap((i, k) => { const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i]; return k ? a.slice(1) : a; });
  return topo.objects.land.geometries.flatMap((g) => (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []).flat().map(ring));
}

function globeSvg(points, topo, size = 640) {
  const stops = points.map((p) => [p.lon, p.lat]);
  const line = stops.slice(1).flatMap((b, i) => greatCircle(stops[i], b, 72).slice(i ? 1 : 0));
  const [l0, p0] = toLonLat(line.map(toVec).reduce((s, v) => s.map((x, i) => x + v[i]), [0, 0, 0]));
  const R = size * 0.44, c = size / 2;
  const sp0 = Math.sin(p0 * RAD), cp0 = Math.cos(p0 * RAD);
  // Orthographic; a point beyond the horizon is laid on the rim, which is where a clipped coast would run.
  const proj = ([lon, lat]) => {
    const l = (lon - l0) * RAD, p = lat * RAD;
    const cosc = sp0 * Math.sin(p) + cp0 * Math.cos(p) * Math.cos(l);
    let x = Math.cos(p) * Math.sin(l), y = cp0 * Math.sin(p) - sp0 * Math.cos(p) * Math.cos(l);
    if (cosc < 0) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; }
    return { x: c + R * x, y: c - R * y, cosc };
  };
  if (line.some((pt) => proj(pt).cosc < 0.05)) return null; // a route this long needs the turning globe of the video
  const n = (v) => Number(v.toFixed(1));
  const d = (pts, close, step = 1) => {
    let out = '', last = null;
    pts.forEach((q, i) => {
      if (last && i < pts.length - 1 && Math.hypot(q.x - last.x, q.y - last.y) < step) return;
      out += `${out ? 'L' : 'M'}${n(q.x)} ${n(q.y)}`;
      last = q;
    });
    return out + (close ? 'Z' : '');
  };
  const land = topoRings(topo).map((r) => r.map(proj)).filter((r) => r.some((q) => q.cosc >= 0)).map((r) => d(r, true)).join('');
  let grid = '';
  const visible = (coords) => {
    let run = [];
    const end = () => { if (run.length > 1) grid += d(run, false, 2); run = []; };
    for (const q of coords.map(proj)) { if (q.cosc >= 0) run.push(q); else end(); }
    end();
  };
  for (let lon = -180; lon < 180; lon += 15) visible(Array.from({ length: 81 }, (_, k) => [lon, -80 + k * 2]));
  for (let lat = -75; lat <= 75; lat += 15) visible(Array.from({ length: 181 }, (_, k) => [-180 + k * 2, lat]));
  // Each name sits square to the line where it passes, on the side with room, so the line never crosses a name.
  const FONT = 19;
  const marks = points.map((p, i) => {
    const q = proj([p.lon, p.lat]);
    const end = i === 0 || i === points.length - 1;
    const a = proj(line[Math.max(0, i * 72 - 6)]), b = proj(line[Math.min(line.length - 1, i * 72 + 6)]);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    if (nx < 0) { nx = -nx; ny = -ny; }
    const name = p.name.toUpperCase();
    if (q.x + 16 + name.length * FONT * 0.78 > size - 8) { nx = -nx; ny = -ny; }
    const tx = q.x + nx * 16, ty = q.y + ny * 16 + (ny > 0.35 ? FONT * 0.75 : ny < -0.35 ? 0 : FONT * 0.36);
    return `<circle class="${end ? 'end' : 'via'}" cx="${n(q.x)}" cy="${n(q.y)}" r="${end ? 8 : 6.5}"/><text x="${n(tx)}" y="${n(ty)}" text-anchor="${nx >= 0 ? 'start' : 'end'}">${html(name)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<defs><radialGradient id="sea" cx="42%" cy="38%" r="70%"><stop offset="0" stop-color="#2b4256"/><stop offset="1" stop-color="#13202b"/></radialGradient>
<style>text{font:800 19px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;letter-spacing:2px;fill:#f2ece0;stroke:#12100e;stroke-width:5px;paint-order:stroke;stroke-linejoin:round}.end{fill:#f2ece0;stroke:#f2694b;stroke-width:3px}.via{fill:#12100e;stroke:#f2694b;stroke-width:2.5px}</style></defs>
<rect width="${size}" height="${size}" fill="#12100e"/>
<circle cx="${c}" cy="${c}" r="${n(R + 7)}" fill="none" stroke="rgba(242,236,224,.08)" stroke-width="14"/>
<circle cx="${c}" cy="${c}" r="${n(R)}" fill="url(#sea)"/>
<path d="${grid}" fill="none" stroke="rgba(242,236,224,.09)" stroke-width="1"/>
<path d="${land}" fill="#d9cbb2" stroke="#b9a98c" stroke-width=".6" stroke-linejoin="round"/>
<path d="${d(line.map(proj), false, 0.3)}" fill="none" stroke="#f2694b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
${marks}
</svg>
`;
}

function routeMap(run, fig, ctx) {
  const file = `route-${run}.svg`;
  const meta = { file, width: 640, height: 640 };
  const out = path.join(SITE, PICTURES, file);
  if (fs.existsSync(out)) return meta;
  if (ctx.check) { ctx.notes.push(`map ${file} is not in ${PICTURES}/`); return null; }
  const landFile = path.join(SITE, 'scripts/data/land-50m.json');
  if (!fs.existsSync(landFile)) { ctx.notes.push(`map ${file}: scripts/data/land-50m.json is missing`); return null; }
  const svg = globeSvg(fig.points, parse(fs.readFileSync(landFile, 'utf8'), 'world-atlas/land-50m.json'));
  if (!svg) { ctx.notes.push(`map ${file}: the route runs past the horizon of one view of the globe`); return null; }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, svg);
  ctx.notes.push(`made ${PICTURES}/${file} (${Math.round(svg.length / 1024)} KB)`);
  return meta;
}

function resolvePictures(page, ctx) {
  const f = page.figures;
  if (f.lead?.kind === 'route') {
    f.lead.pic = routeMap(page.run, f.lead, ctx);
    if (!f.lead.pic) f.lead = null;
  } else if (f.lead?.kind === 'plate') {
    f.lead.pic = picture(f.lead.asset, { asset: f.lead.asset }, ctx);
    if (!f.lead.pic) f.lead = null;
  } else if (f.lead?.kind === 'scale') {
    for (const it of f.lead.items) it.pic = picture(it.asset, { asset: it.asset }, ctx);
    if (f.lead.items.some((it) => !it.pic)) f.lead = null;
  }
  f.after = f.after.map((a) => ({ ...a, pic: picture(a.asset, { asset: a.asset }, ctx) })).filter((a) => a.pic);
  f.details = f.details.map((d) => ({ ...d, pic: picture(`${d.asset}--${slugify(d.label)}`, { asset: d.asset, rect: d.rect, max: 1000 }, ctx) })).filter((d) => d.pic);
}

// ---------------------------------------------------------------------------------------------------------------------
// Markup.

const urlOf = (p) => `${ORIGIN}${p}`;
const factPath = (page) => `/facts/${page.slug}/`;
const subjectPath = (s) => `/facts/${s}/`;
const picSrc = (pic) => `/${PICTURES}/${pic.file}`;

function categoryLabel(subject, { link = false, tag = 'span' } = {}) {
  const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${GLYPHS[subject]}"/></svg>`;
  const inner = `${svg}${html(SUBJECTS[subject])}`;
  return link
    ? `<a class="cat" href="${subjectPath(subject)}" style="color: var(--${subject})">${inner}</a>`
    : `<${tag} class="cat" style="color: var(--${subject})">${inner}</${tag}>`;
}

function head({ title, description, canonical, type = 'website', published = null, section = null, data }) {
  const og = [
    ['og:type', type], ['og:site_name', 'Factful'], ['og:url', canonical], ['og:title', title.og],
    ['og:description', description], ['og:image', `${ORIGIN}/assets/img/og.png`], ['og:image:width', '1200'], ['og:image:height', '630'],
    ...(published ? [['article:published_time', published]] : []), ...(section ? [['article:section', section]] : []),
  ];
  return `<!doctype html>
<html lang="en">
${MARK}
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${html(title.page)}</title>
<meta name="description" content="${attr(description)}">
<link rel="canonical" href="${attr(canonical)}">
<meta name="theme-color" content="#eee7da" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#12100e" media="(prefers-color-scheme: dark)">
<meta name="apple-itunes-app" content="app-id=${APP_ID}">
${og.map(([k, v]) => `<meta property="${k}" content="${attr(v)}">`).join('\n')}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(title.og)}">
<meta name="twitter:description" content="${attr(description)}">
<meta name="twitter:image" content="${ORIGIN}/assets/img/og.png">
<link rel="icon" href="/assets/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/newsreader-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/facts.css">
<script type="application/ld+json">${jsonld(data)}</script>
</head>`;
}

function bar(current) {
  const here = (k) => (current === k ? ' aria-current="page"' : '');
  return `<header class="bar">
  <div class="wrap">
    <a class="wordmark" href="/" aria-label="Factful home"><img src="/assets/img/apple-touch-icon.png" alt="" width="30" height="30">Factful</a>
    <nav aria-label="Main">
      <a href="/facts/"${here('facts')}>Facts</a>
      <a href="/today/" class="hide-sm"${here('today')}>Today</a>
      <a class="pill" href="${attr(APP_STORE)}">Get the app</a>
    </nav>
  </div>
</header>`;
}

const FOOTER = `<footer>
  <div class="wrap">
    <span>Factful, by Vickio Labs Inc.</span>
    <nav aria-label="Footer"><a href="/facts/">Facts</a><a href="/support.html">Support</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></nav>
  </div>
</footer>`;

const OFFER = `<aside class="offer" aria-labelledby="offer-title">
  <div class="offer-band" aria-hidden="true">Factful · Daily facts</div>
  <div class="offer-body">
    <img class="offer-icon" src="/assets/img/icon-512.png" alt="" width="64" height="64" loading="lazy">
    <p class="offer-name"><strong>${html(APP_NAME)}</strong>, the iPhone app</p>
    <h2 id="offer-title">A fact a day keeps the <em>brainrot away.</em></h2>
    <p class="offer-copy">Surprising, sourced facts on your lock screen. Every fact checked against its source.</p>
    <div class="offer-cta">
      <a class="badge" href="${attr(APP_STORE)}"><img src="/assets/img/app-store-badge-black.svg" alt="Download on the App Store" width="162" height="54"></a>
      <span>Free on the App Store.</span>
    </div>
  </div>
</aside>`;

function page({ head: h, current, main }) {
  return `${h}
<body>
${bar(current)}

${main}

${FOOTER}
</body>
</html>
`;
}

const ORG = {
  '@type': 'Organization', '@id': `${ORIGIN}/#factful`, name: 'Factful', url: `${ORIGIN}/`,
  logo: { '@type': 'ImageObject', url: `${ORIGIN}/assets/img/icon-512.png`, width: 512, height: 512 },
  sameAs: [ACCOUNTS.tiktok, ACCOUNTS.instagram],
};
const APP = {
  '@type': 'SoftwareApplication', '@id': `${ORIGIN}/#app`, name: APP_NAME, alternateName: 'Factful',
  operatingSystem: 'iOS', applicationCategory: 'EducationApplication',
  description: 'Surprising, sourced facts on your lock screen. Every fact checked against its source.',
  url: `${ORIGIN}/`, installUrl: APP_STORE, sameAs: [`https://apps.apple.com/us/app/factful-daily-facts/id${APP_ID}`],
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'Vickio Labs Inc.' },
};

function cropStyle(crop) {
  const pct = (n) => `${Number((n * 100).toFixed(3))}%`;
  return `width: ${pct(1 / crop.w)}; height: ${pct(1 / crop.h)}; left: ${pct(-crop.x / crop.w)}; top: ${pct(-crop.y / crop.h)}`;
}

function credit(fig, pics) {
  const links = pics.filter((p) => p.page).map((p, i, all) => `<a href="${attr(p.page)}" rel="noopener">${html(all.length > 1 ? fig.names?.[i] ?? p.source : p.source ?? 'Source')}</a>`);
  const licence = pics.find((p) => /^cc by/i.test(p.licence) && p.licenceUrl);
  // A public-domain or CC0 picture says so, unless its credit already does.
  const free = pics.find((p) => /^(public domain|cc0)$/i.test(p.licence ?? ''))?.licence;
  const plain = free && !(fig.credit ?? '').toLowerCase().includes(free.toLowerCase()) && (free === 'Public domain' ? 'public domain' : free);
  return [fig.credit && html(fig.credit), plain, links.length && (pics.length > 1 ? `${html(pics[0].source ?? 'Wikimedia Commons')}: ${links.join(', ')}` : links[0]),
    licence && `<a href="${attr(licence.licenceUrl)}" rel="noopener license">${html(licence.licence)}</a>`].filter(Boolean).join(' · ');
}

function plateHtml(fig, { eager = false } = {}) {
  const p = fig.pic;
  const load = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  const img = (style) => `<img src="${picSrc(p)}" alt="${attr(fig.caption ?? '')}" width="${p.width}" height="${p.height}" ${load} decoding="async"${style ? ` style="${style}"` : ''}>`;
  const ratio = fig.crop ? (fig.crop.w * p.width) / (fig.crop.h * p.height) : p.width / p.height;
  const frame = fig.crop
    ? `<div class="frame"><div class="pic crop" style="aspect-ratio: ${Number(ratio.toFixed(4))}">${img(cropStyle(fig.crop))}</div></div>`
    : `<div class="frame"><div class="pic">${img()}</div></div>`;
  return `<figure class="plate${ratio < 0.85 ? ' tall' : ''}">
      ${frame}
      <figcaption>${fig.caption ? html(fig.caption) : ''}<small>${credit(fig, [p])}</small></figcaption>
    </figure>`;
}

function scaleHtml(fig) {
  const max = Math.max(...fig.items.map((it) => it.value));
  const bodies = fig.items.map((it) => {
    const p = it.pic;
    const style = it.crop ? cropStyle(it.crop) : 'width: 100%; height: 100%; left: 0; top: 0';
    return `<div class="orb" style="--d: ${Number(((it.value / max) * 100).toFixed(2))}%">
          <div class="disc"><img src="${picSrc(p)}" alt="${attr(it.label)}" width="${p.width}" height="${p.height}" fetchpriority="high" decoding="async" style="${style}"></div>
          <b>${html(it.label)}</b><span>${html(it.display)}</span>
        </div>`;
  }).join('\n        ');
  return `<figure class="plate scale">
      <div class="scale-row">
        ${bodies}
      </div>
      <figcaption><small>${credit({ ...fig, names: fig.items.map((it) => it.label) }, fig.items.map((it) => it.pic))}</small></figcaption>
    </figure>`;
}

function routeHtml(fig) {
  const names = fig.points.map((p) => p.name);
  const alt = `A globe with the route from ${names[0]}${names.length > 2 ? ` via ${names.slice(1, -1).join(', ')}` : ''} to ${names[names.length - 1]}`;
  // As the video counted them: approximate, rounded down, "1 day" not "1 days".
  const totals = fig.totals.map((t) => {
    const v = Math.floor(t.value + 1e-9);
    return `<div><dt>${html(t.label)}, approx.</dt><dd>${v.toLocaleString('en-US')} <span>${html(v === 1 ? t.unit.replace(/s$/, '') : t.unit)}</span></dd></div>`;
  }).join('');
  return `<figure class="plate route">
      <div class="route-card">
        <img src="${picSrc(fig.pic)}" alt="${attr(alt)}" width="${fig.pic.width}" height="${fig.pic.height}" fetchpriority="high" decoding="async">
        ${totals ? `<dl class="totals">${totals}</dl>` : ''}
      </div>
      <figcaption>Route simplified: great circles between the places named.<small>Land: Natural Earth · public domain</small></figcaption>
    </figure>`;
}

function detailsHtml(details) {
  const figs = details.map((d) => {
    const p = d.pic;
    let mark = '';
    if (d.mark) {
      // The circle the video drew, in the cut's own units: x across 0..100, y down 0..100·h/w; r is a share of the width.
      const h = (100 * p.height) / p.width;
      const cx = ((d.mark.x - d.rect.x) / d.rect.w) * 100;
      const cy = ((d.mark.y - d.rect.y) / d.rect.h) * h;
      const r = (d.mark.r / d.rect.w) * 100;
      mark = `<svg class="mark" viewBox="0 0 100 ${Number(h.toFixed(3))}" aria-hidden="true"><circle cx="${Number(cx.toFixed(2))}" cy="${Number(cy.toFixed(2))}" r="${Number(r.toFixed(2))}"/></svg>`;
    }
    return `<figure>
        <a class="frame" href="${picSrc(p)}" aria-label="${attr(`${d.label}, full size`)}"><img src="${picSrc(p)}" alt="${attr(d.label)}" width="${p.width}" height="${p.height}" loading="lazy" decoding="async">${mark}</a>
        <figcaption>${html(d.label)}</figcaption>
      </figure>`;
  });
  return `<div class="details">
      ${figs.join('\n      ')}
    </div>`;
}

function blocksHtml(blocks) {
  return blocks.map((b) => {
    if (b.type === 'stand') return `<p class="stand">${html(b.text)}</p>`;
    if (b.type === 'payoff') return `<p class="stand payoff">${html(b.text)}</p>`;
    if (b.type === 'p') return `<p>${html(b.text)}</p>`;
    if (b.type === 'quote') {
      return `<blockquote class="pull"${b.cite ? ` cite="${attr(b.cite)}"` : ''}>
      ${b.title ? `<p class="pull-title">${html(b.title)}</p>` : ''}${b.text ? `<p>${html(b.text)}</p>` : ''}
    </blockquote>`;
    }
    if (b.type === 'timeline') {
      return `<ol class="timeline">
      ${b.items.map((it) => `<li><p class="claim">${html(it.claim)}</p><p class="when">${html(it.when)}</p></li>`).join('\n      ')}
    </ol>`;
    }
    throw new Error(`unknown block ${b.type}`);
  }).join('\n    ');
}

function folio(p, { level = 'h1', today = false } = {}) {
  const posts = Object.entries(p.links).map(([k, u]) => `<a href="${attr(u)}" rel="noopener">${PLATFORMS[k]} <span aria-hidden="true">↗</span></a>`).join('');
  const foot = today
    ? `<div class="foot"><a class="why-link" href="${factPath(p)}">Why it's true <span aria-hidden="true">→</span></a><span class="posts">${posts}</span></div>`
    : `<div class="foot"><span>Posted on</span>${posts}</div>`;
  return `<article class="folio${today ? ' is-today' : ''}">
        <div class="head"><span class="caps">${weekday(p.day)}</span><span class="no">No. ${dayOfYear(p.day)}</span></div>
        <div class="date"><span class="day">${dayNumber(p.day)}</span><span class="month">${monthOf(p.day)} <span class="year">${yearOf(p.day)}</span></span></div>
        <hr>
        ${categoryLabel(p.subject, { link: !today })}
        <${level} class="claim">${html(p.headline)}</${level}>
        ${foot}
      </article>`;
}

function sourcesHtml(p) {
  const also = p.also.length
    ? `
      <h3 class="caps">Also checked against</h3>
      <ul class="also">
        ${p.also.map((s) => `<li><a href="${attr(s.url)}" rel="noopener"><b>${html(s.publisher)}</b>${s.title ? ` <span>${html(s.title)}</span>` : ''} <span aria-hidden="true">↗</span></a></li>`).join('\n        ')}
      </ul>`
    : '';
  return `<section class="sources" aria-labelledby="source-title">
      <h2 class="caps" id="source-title">Source</h2>
      <p class="pub">${html(p.source.publisher)}</p>
      ${p.source.title ? `<p class="title">${html(p.source.title)}</p>` : ''}
      <a class="read" href="${attr(p.source.url)}" rel="noopener">Read the source <span aria-hidden="true">↗</span></a>
      <p class="checked">Checked against the source on <time datetime="${p.checked}">${longDate(p.checked)}</time>.</p>${also}
    </section>`;
}

function entryHtml(p) {
  return `<li><a class="entry" href="${factPath(p)}">
          <time class="entry-date" datetime="${p.day}" title="${attr(longDate(p.day))}"><b>${dayNumber(p.day)}</b><span>${shortMonth(p.day)}</span></time>
          <span class="entry-main">
            ${categoryLabel(p.subject)}
            <span class="entry-claim">${html(p.headline)}</span>
            <span class="entry-meta">Checked against ${html(p.source.publisher)}</span>
          </span>
        </a></li>`;
}

function subjectsNav(pages, current) {
  const counts = {};
  for (const p of pages) counts[p.subject] = (counts[p.subject] ?? 0) + 1;
  const subjects = Object.keys(SUBJECTS).filter((s) => counts[s]);
  const item = (href, label, n, on, style = '') => `<a href="${href}"${on ? ' aria-current="page"' : ''}${style}>${label}<span>${n}</span></a>`;
  return `<nav class="subjects" aria-label="Subjects">
        ${[item('/facts/', 'All', pages.length, current === null),
    ...subjects.map((s) => item(subjectPath(s), html(SUBJECTS[s]), counts[s], current === s, ` style="--c: var(--${s})"`))].join('\n        ')}
      </nav>`;
}

function monthsHtml(pages) {
  const months = [];
  for (const p of pages) {
    const key = p.day.slice(0, 7);
    if (months[months.length - 1]?.key !== key) months.push({ key, day: p.day, pages: [] });
    months[months.length - 1].pages.push(p);
  }
  return months.map((m) => `<section class="month" aria-labelledby="m-${m.key}">
        <h2 id="m-${m.key}">${monthOf(m.day)} <em>${yearOf(m.day)}</em></h2>
        <ul class="entries">
        ${m.pages.map(entryHtml).join('\n        ')}
        </ul>
      </section>`).join('\n      ');
}

function factPage(p, all) {
  const url = urlOf(factPath(p));
  const f = p.figures;
  const lead = !f.lead ? '' : f.lead.kind === 'scale' ? scaleHtml(f.lead) : f.lead.kind === 'route' ? routeHtml(f.lead) : plateHtml(f.lead, { eager: true });
  const after = f.after.map((a) => plateHtml(a)).join('\n    ');
  const tryIt = f.test === 'blind-spot'
    ? `<section class="try" aria-labelledby="try-title">
    <h2 class="caps kicker" id="try-title">Try it</h2>
    <div class="spot" aria-hidden="true"><div class="spot-card"><i class="cross"></i><i class="dot"></i></div></div>
    ${p.steps.length ? `<ol class="steps">
      ${p.steps.map((s) => `<li>${html(s)}</li>`).join('\n      ')}
    </ol>` : ''}
  </section>`
    : (p.steps.length ? `<ol class="steps">${p.steps.map((s) => `<li>${html(s)}</li>`).join('')}</ol>` : '');
  const mail = `mailto:${HELP}?subject=${encodeURIComponent(`Fact ${p.factId ?? p.slug} looks wrong`)}&body=${encodeURIComponent(`${url}\n\n`)}`;
  const same = all.filter((q) => q !== p && q.subject === p.subject);
  const more = [...same, ...all.filter((q) => q !== p && q.subject !== p.subject)].slice(0, 3);
  // Named for the subject only when every entry is from it, never over a mix.
  const moreTitle = more.every((q) => q.subject === p.subject) ? `More ${SUBJECTS[p.subject].toLowerCase()}` : 'More facts';
  const images = [f.lead?.pic, ...(f.lead?.items ?? []).map((it) => it.pic), ...f.after.map((a) => a.pic), ...f.details.map((d) => d.pic)]
    .filter((pic) => pic && !pic.file.endsWith('.svg')).map((pic) => urlOf(picSrc(pic)));
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article', '@id': `${url}#fact`, url, mainEntityOfPage: url,
        headline: p.headline, description: p.description, articleSection: SUBJECTS[p.subject],
        datePublished: p.stamp, dateModified: p.stamp, inLanguage: 'en', isAccessibleForFree: true,
        image: images.length ? images : [`${ORIGIN}/assets/img/og.png`],
        author: { '@id': ORG['@id'], '@type': 'Organization', name: 'Factful', url: `${ORIGIN}/` },
        publisher: ORG,
        citation: [p.source, ...p.also].map((s) => ({
          '@type': 'CreativeWork', name: s.title ?? s.publisher, url: s.url,
          ...(s.title ? { publisher: { '@type': 'Organization', name: s.publisher } } : {}),
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Facts', item: urlOf('/facts/') },
          { '@type': 'ListItem', position: 2, name: SUBJECTS[p.subject], item: urlOf(subjectPath(p.subject)) },
          { '@type': 'ListItem', position: 3, name: p.headline, item: url },
        ],
      },
    ],
  };
  const main = `<main class="fact-page">
  <div class="wrap fact-grid">
    <div class="fact-aside">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/facts/">Facts</a><span aria-hidden="true">/</span><a href="${subjectPath(p.subject)}">${html(SUBJECTS[p.subject])}</a></nav>
      <div class="folio-wrap">
      ${folio(p)}
      </div>
    </div>

    <div class="fact-body">
  ${tryIt}
  <section class="story" aria-labelledby="why-title">
    <h2 class="caps kicker" id="why-title">Why it's true</h2>
    ${lead}
    ${blocksHtml(p.blocks)}
    ${f.details.length ? detailsHtml(f.details) : ''}
    ${after}
  </section>

    ${sourcesHtml(p)}

    <p class="report"><a href="${attr(mail)}">Spot an error? Tell us</a></p>

    ${OFFER}
    </div>
  </div>

  <section class="shelf" aria-labelledby="more-title">
    <div class="wrap">
      <h2 class="caps kicker" id="more-title">${html(moreTitle)}</h2>
      <ul class="entries">
        ${more.map(entryHtml).join('\n        ')}
      </ul>
      <p class="all"><a href="/facts/">Every fact we've posted <span aria-hidden="true">→</span></a></p>
    </div>
  </section>
</main>`;
  return page({
    head: head({
      title: { page: `${p.title ?? p.headline} | Factful`, og: p.headline },
      description: p.description, canonical: url, type: 'article', published: p.stamp, section: SUBJECTS[p.subject], data,
    }),
    current: null,
    main: main.replace(/\n\s*\n(\s*\n)+/g, '\n\n'),
  });
}

function listData(pathname, name, description, pages, extra = []) {
  const url = urlOf(pathname);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', '@id': `${url}#page`, url, name, description, inLanguage: 'en',
        mainEntity: {
          '@type': 'ItemList', numberOfItems: pages.length,
          itemListElement: pages.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: urlOf(factPath(p)), name: p.headline })),
        },
      },
      ...extra,
    ],
  };
}

/** The latest fact as the page on top of the pad, one link to its own page. */
function latestLeaf(p) {
  return `<div class="folio-wrap"><a class="folio latest-card" href="${factPath(p)}">
          <span class="head"><span class="caps">${weekday(p.day)}</span><span class="no">No. ${dayOfYear(p.day)}</span></span>
          <time class="date" datetime="${p.day}"><span class="day">${dayNumber(p.day)}</span><span class="month">${monthOf(p.day)} <span class="year">${yearOf(p.day)}</span></span></time>
          <span class="rule" aria-hidden="true"></span>
          ${categoryLabel(p.subject)}
          <span class="claim">${html(p.headline)}</span>
          <span class="foot"><span class="go">Why it's true <span aria-hidden="true">→</span></span><span class="src">Checked against ${html(p.source.publisher)}</span></span>
        </a></div>`;
}

function indexPage(pages) {
  const description = `Every fact Factful has posted on TikTok and Instagram, with the source it was checked against. ${pages.length} so far.`;
  const latest = pages[0];
  const main = `<main class="archive">
  <div class="wrap">
    <div class="archive-top">
      <header class="archive-head">
        <span class="caps kicker">Every fact we've posted</span>
        <h1>Sounds fake. <em>It's true.</em></h1>
        <p class="lede">Every fact Factful has posted on TikTok and Instagram, each with the source it was checked against and the day it was checked.</p>
        <p class="aside"><strong>${html(APP_NAME)}</strong>, the iPhone app, puts surprising, sourced facts on your lock screen. <a href="${attr(APP_STORE)}">Free on the App Store.</a></p>
      </header>

      ${subjectsNav(pages, null)}

      <section class="latest" aria-labelledby="latest-title">
        <h2 class="caps kicker" id="latest-title">Latest</h2>
        ${latestLeaf(latest)}
        <p class="all"><a href="/today/">Today's page <span aria-hidden="true">→</span></a></p>
      </section>
    </div>

    ${monthsHtml(pages)}
  </div>
  <div class="wrap">
    ${OFFER}
  </div>
</main>`;
  return page({
    head: head({
      title: { page: 'Facts: sounds fake, it\'s true | Factful', og: 'Sounds fake. It\'s true.' },
      description, canonical: urlOf('/facts/'),
      data: listData('/facts/', 'Facts', description, pages, [
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Facts', item: urlOf('/facts/') }] },
        ORG, APP,
      ]),
    }),
    current: 'facts',
    main,
  });
}

function subjectPage(subject, pages, all) {
  const name = SUBJECTS[subject];
  const n = pages.length;
  const description = `${n} ${n === 1 ? 'fact' : 'facts'} about ${name.toLowerCase()} that Factful has posted, each with the source it was checked against.`;
  const main = `<main class="archive">
  <div class="wrap">
    <header class="archive-head">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/facts/">Facts</a><span aria-hidden="true">/</span><span>${html(name)}</span></nav>
      <h1 class="subject-title" style="--c: var(--${subject})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${GLYPHS[subject]}"/></svg>${html(name)}</h1>
      <p class="lede">${html(description)}</p>
    </header>

    ${subjectsNav(all, subject)}

    ${monthsHtml(pages)}
  </div>
  <div class="wrap">
    ${OFFER}
  </div>
</main>`;
  return page({
    head: head({
      title: { page: `${name} facts | Factful`, og: `${name} facts` },
      description, canonical: urlOf(subjectPath(subject)),
      data: listData(subjectPath(subject), `${name} facts`, description, pages, [{
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Facts', item: urlOf('/facts/') },
          { '@type': 'ListItem', position: 2, name, item: urlOf(subjectPath(subject)) },
        ],
      }]),
    }),
    current: null,
    main,
  });
}

function todayPage(pages) {
  const p = pages[0];
  const description = `The latest fact Factful posted, on ${longDate(p.day)}: ${p.headline}`;
  const roman = (() => {
    let v = Number(yearOf(p.day));
    let out = '';
    for (const [n, s] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
      while (v >= n) { out += s; v -= n; }
    }
    return out;
  })();
  const earlier = pages.slice(1, 4);
  const main = `<main class="today">
  <div class="wrap">
    <header class="today-head">
      <span class="caps kicker">Today's page</span>
      <p class="lede">The latest fact we posted, on <time datetime="${p.day}">${longDate(p.day)}</time>.</p>
    </header>
    <div class="today-pad">
      <div class="today-binding" aria-hidden="true">FACTFUL · ${roman}</div>
      ${folio(p, { today: true })}
      <div class="today-edge" aria-hidden="true"></div>
      <div class="today-edge e2" aria-hidden="true"></div>
    </div>
    <p class="today-source">Source: ${html(p.source.publisher)}${p.source.title ? `, ${html(p.source.title)}` : ''}. Checked against the source on <time datetime="${p.checked}">${longDate(p.checked)}</time>.</p>
  </div>

  ${earlier.length ? `<section class="shelf" aria-labelledby="earlier-title">
    <div class="wrap">
      <h2 class="caps kicker" id="earlier-title">Earlier</h2>
      <ul class="entries">
        ${earlier.map(entryHtml).join('\n        ')}
      </ul>
      <p class="all"><a href="/facts/">Every fact we've posted <span aria-hidden="true">→</span></a></p>
    </div>
  </section>` : ''}
  <div class="wrap">
    ${OFFER}
  </div>
</main>`;
  return page({
    head: head({
      title: { page: 'Today\'s page | Factful', og: p.headline },
      description, canonical: urlOf('/today/'),
      data: {
        '@context': 'https://schema.org',
        '@type': 'WebPage', '@id': `${urlOf('/today/')}#page`, url: urlOf('/today/'), name: 'Today\'s page', description, inLanguage: 'en',
        mainEntity: { '@type': 'Article', '@id': `${urlOf(factPath(p))}#fact`, url: urlOf(factPath(p)), headline: p.headline, datePublished: p.stamp },
      },
    }),
    current: 'today',
    main,
  });
}

function sitemap(pages, subjects) {
  const statics = fs.readdirSync(SITE).filter((f) => f.endsWith('.html') && f !== '404.html').sort()
    .map((f) => ({ loc: urlOf(f === 'index.html' ? '/' : `/${f}`) }));
  const latest = pages[0].day;
  const urls = [
    ...statics.filter((u) => u.loc === urlOf('/')),
    { loc: urlOf('/facts/'), lastmod: latest },
    { loc: urlOf('/today/'), lastmod: latest },
    ...subjects.map((s) => ({ loc: urlOf(subjectPath(s)), lastmod: pages.find((p) => p.subject === s).day })),
    ...pages.map((p) => ({ loc: urlOf(factPath(p)), lastmod: p.day })),
    ...statics.filter((u) => u.loc !== urlOf('/')),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${html(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const studio = studioReader(opts.repo, opts.ref);
  const postsText = studio.read('studio/records/posts.jsonl');
  if (!postsText) die(`no studio/records/posts.jsonl in ${studio.label}`);
  const runs = postsByRun(postsText);
  const ledger = loadLedger();
  const before = ledgerText(ledger);
  const ctx = { repo: opts.repo, check: opts.check, notes: [] };

  const pages = [];
  const skipped = [];
  for (const [run, rows] of runs) {
    let built;
    try { built = buildRun(run, rows, studio.read, ledger.pages[run]); } catch (e) { built = { skip: e.message }; }
    if (built.skip) { skipped.push({ run, why: built.skip }); continue; }
    pages.push(built.page);
  }

  // Slugs and subjects: the ledger's, or new ones recorded now and kept from then on.
  const taken = new Set(Object.values(ledger.pages).map((e) => e.slug).filter(Boolean));
  for (const p of pages.sort((a, b) => Date.parse(a.posted) - Date.parse(b.posted))) {
    const entry = ledger.pages[p.run] ?? {};
    if (!entry.subject) {
      const subject = p.subject ?? p.subjectHint;
      if (!subject) { skipped.push({ run: p.run, why: `no subject: add one to ${LEDGER} ("subject": one of ${Object.keys(SUBJECTS).join(', ')})` }); p.drop = true; continue; }
      entry.subject = subject;
    }
    if (!SUBJECTS[entry.subject]) { skipped.push({ run: p.run, why: `${LEDGER} gives it the unknown subject "${entry.subject}"` }); p.drop = true; continue; }
    if (p.subject && p.subject !== entry.subject) ctx.notes.push(`${p.run}: the library says ${p.subject}, the ledger says ${entry.subject}; the ledger wins`);
    if (!entry.slug) {
      const base = slugify(p.autoSlugFrom) || slugify(p.run);
      let slug = RESERVED.has(base) ? `${base}-fact` : base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      entry.slug = slug;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) || RESERVED.has(entry.slug)) {
      skipped.push({ run: p.run, why: `${LEDGER} gives it the unusable slug "${entry.slug}"` }); p.drop = true; continue;
    }
    taken.add(entry.slug);
    ledger.pages[p.run] = entry;
    Object.assign(p, { slug: entry.slug, subject: entry.subject, title: entry.title ?? null });
  }
  const live = pages.filter((p) => !p.drop).sort((a, b) => Date.parse(b.posted) - Date.parse(a.posted));
  const slugs = live.map((p) => p.slug);
  if (new Set(slugs).size !== slugs.length) die(`two runs share a slug in ${LEDGER}`);
  if (!live.length) die('no run makes a page');

  for (const p of live) {
    resolvePictures(p, ctx);
    const words = p.blocks.flatMap((b) => (b.type === 'timeline' ? b.items.flatMap((it) => [it.claim, it.when]) : b.type === 'quote' ? [b.text] : [b.text]));
    p.description = summary(p.steps.length ? [...p.steps, ...words] : words);
    if (p.warning) ctx.notes.push(`${p.run}: ${p.warning}`);
  }

  const subjects = Object.keys(SUBJECTS).filter((s) => live.some((p) => p.subject === s));
  const files = new Map();
  for (const p of live) files.set(`facts/${p.slug}/index.html`, factPage(p, live));
  files.set('facts/index.html', indexPage(live));
  for (const s of subjects) files.set(`facts/${s}/index.html`, subjectPage(s, live.filter((p) => p.subject === s), live));
  files.set('today/index.html', todayPage(live));
  files.set('sitemap.xml', sitemap(live, subjects));
  const after = ledgerText(ledger);
  if (after !== before) files.set(LEDGER, after);

  // Pages this build does not make but an earlier one did: reported, never deleted, since removing one unpublishes it.
  const made = new Set([...files.keys()].map((f) => f.split('/').slice(0, 2).join('/')));
  const stray = fs.existsSync(path.join(SITE, 'facts'))
    ? fs.readdirSync(path.join(SITE, 'facts'), { withFileTypes: true }).filter((d) => d.isDirectory() && !made.has(`facts/${d.name}`))
      .filter((d) => { try { return fs.readFileSync(path.join(SITE, 'facts', d.name, 'index.html'), 'utf8').includes(MARK); } catch { return false; } })
      .map((d) => `facts/${d.name}/`)
    : [];

  const changed = [];
  for (const [rel, content] of files) {
    const file = path.join(SITE, rel);
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (old === content) continue;
    changed.push(rel);
    if (!opts.check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }

  console.log(`Read ${studio.label}: ${runs.size} posted runs.`);
  console.log(`${live.length} fact pages, ${subjects.length} subjects (${subjects.join(', ')}), latest ${live[0].day}.`);
  for (const p of live) console.log(`  /facts/${p.slug}/  ${p.subject.padEnd(10)} ${p.headline}`);
  for (const s of skipped) console.log(`  skipped ${s.run}: ${s.why}`);
  for (const n of ctx.notes) console.log(`  note: ${n}`);
  for (const s of stray) console.log(`  note: ${s} was built before but not by this run; remove it by hand if that is meant`);
  if (opts.check) {
    console.log(changed.length ? `Would change ${changed.length} file(s): ${changed.join(', ')}` : 'Up to date: nothing would change.');
    process.exit(changed.length ? 1 : 0);
  }
  console.log(changed.length ? `Wrote ${changed.length} file(s): ${changed.join(', ')}` : 'Up to date: nothing changed.');
}

main();
