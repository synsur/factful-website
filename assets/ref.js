// On a visit that came from ChatGPT, the App Store links' campaign becomes chatgpt-<campaign> (ct=web-fact becomes
// chatgpt-web-fact), so App Store Connect's Campaigns page counts the downloads that came through ChatGPT on their own.
// ChatGPT adds utm_source=chatgpt.com to the links it cites. The mark lasts for this tab only (sessionStorage), and
// nothing is sent anywhere: the only change is to the links on the page.
(() => {
  let from = false;
  try {
    const src = new URLSearchParams(location.search).get('utm_source') || '';
    const ref = document.referrer ? new URL(document.referrer).hostname : '';
    from = /(^|\.)(chatgpt\.com|openai\.com)$/.test(src) || /(^|\.)(chatgpt\.com|openai\.com)$/.test(ref);
    if (from) sessionStorage.setItem('from-chatgpt', '1');
    else from = sessionStorage.getItem('from-chatgpt') === '1';
  } catch (e) { /* storage blocked: only this page's links are marked */ }
  if (!from) return;
  for (const a of document.querySelectorAll('a[href*="apps.apple.com"]')) {
    try {
      const u = new URL(a.href);
      const ct = u.searchParams.get('ct');
      if (!ct || ct.startsWith('chatgpt-')) continue;
      u.searchParams.set('ct', `chatgpt-${ct}`.slice(0, 40)); // Apple keeps the first 40 characters
      a.href = u.toString();
    } catch (e) { /* leave a link it cannot read as it is */ }
  }
})();
