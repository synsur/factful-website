// Factful — the pad you can tear, and a few quiet reveals.
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (selector, root = document) => root.querySelector(selector);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
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

  function categoryLabel(category) {
    const label = el('span', 'cat');
    label.style.color = `var(--${category})`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', GLYPHS[category] || '');
    svg.append(path);
    label.append(svg, document.createTextNode(category));
    return label;
  }

  function roman(value) {
    const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [n, s] of table) while (value >= n) { out += s; value -= n; }
    return out;
  }

  // ---------- Sound: the app's own paper tear and chime ----------
  const sound = {
    on: true,
    context: null,
    buffers: {},
    init() {
      try { this.on = localStorage.getItem('factful-sound') !== 'off'; } catch { /* private mode */ }
      const button = $('#sound');
      if (!button) return;
      button.setAttribute('aria-pressed', String(this.on));
      button.addEventListener('click', () => {
        this.on = !this.on;
        button.setAttribute('aria-pressed', String(this.on));
        try { localStorage.setItem('factful-sound', this.on ? 'on' : 'off'); } catch { /* ignore */ }
        if (this.on) this.play('tick');
      });
    },
    async unlock() {
      if (this.context || !this.on) return;
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      await Promise.all(['tear', 'chime', 'tick'].map(async (name) => {
        try {
          const data = await (await fetch(`assets/media/${name}.mp3`)).arrayBuffer();
          this.buffers[name] = await this.context.decodeAudioData(data);
        } catch { /* sound is a nicety */ }
      }));
    },
    play(name, volume = 1) {
      if (!this.on || !this.context || !this.buffers[name]) return;
      if (this.context.state === 'suspended') this.context.resume();
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      gain.gain.value = volume;
      source.buffer = this.buffers[name];
      source.connect(gain).connect(this.context.destination);
      source.start();
    },
  };

  // ---------- The pad ----------
  function seededShuffle(items, seed) {
    const out = items.slice();
    let s = seed >>> 0;
    const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  async function pad() {
    const padEl = $('#pad');
    const leavesEl = $('#leaves');
    if (!padEl || !leavesEl) return;
    let facts;
    try {
      facts = await (await fetch('assets/facts.json')).json();
    } catch {
      return; // the noscript page stands in
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dayNumber = Math.floor(today.getTime() / 86400000);
    // Today's page is a headliner: short, needs no context, lands in three seconds, and isn't used elsewhere on
    // the page. Same for everyone all day, rotating daily from the first on launch day (2026-09-30 is day 20726).
    // The rest of the deck follows in a daily order.
    const headliners = ['history-0013', 'history-0026', 'nature-0024', 'psychology-0001', 'science-0072',
                        'nature-0032', 'technology-0062']
      .map((id) => facts.find((f) => f.id === id)).filter(Boolean);
    const best = headliners.length ? headliners : facts.slice(0, 38);
    const first = best[(((dayNumber - 20726) % best.length) + best.length) % best.length];
    const deck = [first, ...seededShuffle(facts.filter((f) => f !== first), dayNumber)];

    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
    const month = new Intl.DateTimeFormat(undefined, { month: 'long' });
    const dayOfYear = (date) => Math.round((date - new Date(date.getFullYear(), 0, 1, 12)) / 86400000) + 1;
    const dateFor = (index) => {
      const date = new Date(today);
      date.setDate(date.getDate() + index);
      return date;
    };

    $('#year-roman').textContent = roman(today.getFullYear());

    let index = 0;
    let top = null;
    let under = null;
    let busy = false;

    function build(i) {
      const fact = deck[i % deck.length];
      const date = dateFor(i);
      const leaf = el('article', 'leaf');
      leaf.setAttribute('aria-hidden', 'true');
      const head = el('div', 'head');
      head.append(el('span', 'caps', weekday.format(date)), el('span', 'no', `No. ${dayOfYear(date)}`));
      const dateRow = el('div', 'date');
      dateRow.append(el('span', 'day', String(date.getDate())), el('span', 'month', month.format(date)));
      const foot = el('div', 'foot');
      const why = el('button', 'why');
      why.type = 'button';
      why.append(document.createTextNode("Why it's true"), el('span', '', '→'));
      why.addEventListener('click', () => openWhy(fact));
      foot.append(why, el('span', 'count', i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `In ${i} days`));
      leaf.append(head, dateRow, el('hr'), categoryLabel(fact.c), el('p', 'hook', fact.h), foot);
      return leaf;
    }

    function announce() {
      const fact = deck[index % deck.length];
      const date = dateFor(index);
      $('#pad-status').textContent = `${weekday.format(date)} ${date.getDate()} ${month.format(date)}: ${fact.h}`;
    }

    function render() {
      under = build(index + 1);
      top = build(index);
      top.removeAttribute('aria-hidden');
      top.style.zIndex = 2;
      under.style.zIndex = 1;
      leavesEl.append(under, top);
      attach(top);
      announce();
    }

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let dx = 0;
    let dy = 0;

    function transformFor(x, y) {
      const pull = Math.max(0, y);
      const side = x >= 0 ? 1 : -1;
      const rotation = Math.min(20, pull * 0.05 + Math.abs(x) * 0.045) * side;
      top.style.transformOrigin = side > 0 ? 'top left' : 'top right';
      return `translate(${(x * 0.18).toFixed(1)}px, ${(pull * 0.22).toFixed(1)}px) rotate(${rotation.toFixed(2)}deg)`;
    }

    function attach(leaf) {
      leaf.addEventListener('pointerdown', (event) => {
        if (busy || event.target.closest('button')) return;
        sound.unlock();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        dx = dy = 0;
        leaf.setPointerCapture(event.pointerId);
        leaf.style.transition = 'none';
        leaf.classList.add('torn');
        leaf.style.boxShadow = '0 1.4rem 2.6rem rgba(var(--shadow), .24)';
      });
      leaf.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        dx = event.clientX - startX;
        dy = event.clientY - startY;
        leaf.style.transform = transformFor(dx, dy);
      });
      const release = () => {
        if (!dragging) return;
        dragging = false;
        if (dy > 110 || Math.abs(dx) > 130) {
          tear(dx >= 0 ? 1 : -1);
        } else {
          leaf.style.transition = 'transform .45s cubic-bezier(.2,.9,.25,1.15), box-shadow .3s';
          leaf.style.transform = '';
          leaf.style.boxShadow = '';
          leaf.classList.remove('torn');
        }
      };
      leaf.addEventListener('pointerup', release);
      leaf.addEventListener('pointercancel', release);
    }

    function tear(side = 1) {
      if (busy || !top) return;
      busy = true;
      sound.unlock().then(() => sound.play('tear', 0.9));
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* ignore */ } }
      const leaf = top;
      leaf.classList.add('torn');
      if (reduceMotion) {
        leaf.style.transition = 'opacity .25s ease-out';
        leaf.style.opacity = '0';
      } else {
        leaf.style.transformOrigin = side > 0 ? 'top left' : 'top right';
        leaf.style.transition = 'transform .5s cubic-bezier(.55,0,.8,.25), opacity .5s ease-in';
        leaf.style.transform = `translate(${side * 260}px, 110vh) rotate(${side * 34}deg)`;
        leaf.style.opacity = '0';
      }
      setTimeout(() => {
        leaf.remove();
        index += 1;
        top = under;
        top.removeAttribute('aria-hidden');
        top.style.zIndex = 2;
        if (!reduceMotion) top.animate([{ transform: 'scale(.985) translateY(4px)' }, { transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
        under = build(index + 1);
        under.style.zIndex = 1;
        leavesEl.insertBefore(under, top);
        attach(top);
        announce();
        if (index === 1) sound.play('chime', 0.55);
        busy = false;
      }, reduceMotion ? 260 : 480);
    }

    padEl.addEventListener('keydown', (event) => {
      if (['Enter', ' ', 'ArrowDown'].includes(event.key) && event.target === padEl) {
        event.preventDefault();
        tear(1);
      }
    });
    $('#tear-button').addEventListener('click', () => tear(1));

    render();
    ribbon(facts);
  }

  // ---------- Why it's true ----------
  function openWhy(fact) {
    const dialog = $('#why');
    if (!dialog) return;
    const label = $('#why-cat');
    label.replaceWith(Object.assign(categoryLabel(fact.c), { id: 'why-cat' }));
    $('#why-hook').textContent = fact.h;
    $('#why-detail').textContent = fact.d;
    $('#why-pub').textContent = fact.s.p;
    $('#why-title').textContent = fact.s.t;
    $('#why-link').href = fact.s.u;
    sound.play('tick', 0.6);
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }
  document.addEventListener('click', (event) => {
    const dialog = $('#why');
    if (!dialog || !dialog.open) return;
    if (event.target.closest('[data-close]') || event.target === dialog) dialog.close();
  });

  // ---------- Ribbon of facts ----------
  function ribbon(facts) {
    const rows = [$('#row-a'), $('#row-b')];
    if (!rows[0]) return;
    const pool = seededShuffle(facts, 7);
    const halves = [pool.filter((_, i) => i % 2 === 0), pool.filter((_, i) => i % 2 === 1)];
    rows.forEach((row, r) => {
      for (let pass = 0; pass < 2; pass++) { // twice, so the loop is seamless
        for (const fact of halves[r]) {
          const chip = el('div', 'chip');
          if (pass) chip.setAttribute('aria-hidden', 'true');
          chip.append(categoryLabel(fact.c), el('p', '', fact.h));
          row.append(chip);
        }
      }
    });
  }

  // ---------- Quiet reveals ----------
  function reveals() {
    const items = document.querySelectorAll('.rise');
    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach((item) => item.classList.add('in'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
    items.forEach((item) => observer.observe(item));
  }

  function chrome() {
    const bar = $('.bar');
    const onScroll = () => bar && bar.classList.toggle('scrolled', window.scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const year = $('#copyright-year');
    if (year) year.textContent = String(new Date().getFullYear());
    const lockDate = $('#lock-date');
    if (lockDate) lockDate.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
    const widgetDate = $('#widget-date');
    if (widgetDate) {
      const now = new Date();
      widgetDate.textContent = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() + ' ' + now.getDate();
    }
  }

  sound.init();
  chrome();
  reveals();
  pad();
})();
