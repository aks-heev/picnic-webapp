/* ============================================================
   Region scope shared by revenue-dashboard, views (/bookings…) and calendar.
   Each region is a separate book — the pages never mix NCR and Jaipur money.

   Picked by ?region=ncr|jaipur, else the last choice (localStorage), else NCR.
   Switching reloads the page with ?region=…, so load() runs once per region
   and nothing cached from the other book can leak into the numbers.

   City values must match venues.city exactly (CLAUDE.md: use venues.city for
   location routing, never the venues.team_id → teams.city join).
   ============================================================ */
(function () {
  const REGIONS = {
    ncr:    { label: 'Gurugram & Delhi', short: 'NCR',    cities: ['Gurugram', 'Delhi'] },
    jaipur: { label: 'Jaipur',           short: 'Jaipur', cities: ['Jaipur'] },
  };
  const KEY = 'tps-dash-region';
  let key = null;
  try { key = new URLSearchParams(location.search).get('region'); } catch (e) {}
  if (!REGIONS[key]) { try { key = localStorage.getItem(KEY); } catch (e) {} }
  if (!REGIONS[key]) key = 'ncr';
  try { localStorage.setItem(KEY, key); } catch (e) {}

  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const css = document.createElement('style');
  css.textContent = `
    .rgn { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--hair, #e6ddd1);
           border-radius: 999px; background: var(--card, #fff); vertical-align: middle; margin-right: 6px; }
    .rgn button { font: 600 11.5px/1 var(--sans, sans-serif); border: 0; background: none; cursor: pointer;
                  padding: 5px 10px; border-radius: 999px; color: var(--muted, #6b6259); }
    .rgn button.on { background: var(--terracotta, #b8552a); color: #fff; }
    .rgn button:focus-visible { outline: 2px solid var(--terracotta, #b8552a); outline-offset: 1px; }`;
  document.head.appendChild(css);

  window.TPS_REGION = {
    key,
    label: REGIONS[key].label,
    short: REGIONS[key].short,
    cities: REGIONS[key].cities.slice(),
    /* Expense rows carry a free-text city from the sheet. A blank city is
       treated as NCR — every expense entered so far is NCR, and the Jaipur
       workbook that would have held Jaipur's has been dead since 2026-06-24. */
    hasCity(city) {
      const c = String(city || '').trim().toLowerCase();
      if (!c) return key === 'ncr';
      return REGIONS[key].cities.some(x => x.toLowerCase() === c);
    },
    switcherHtml() {
      return `<span class="rgn" role="group" aria-label="Region">` +
        Object.entries(REGIONS).map(([k, r]) =>
          `<button type="button" class="${k === key ? 'on' : ''}" aria-pressed="${k === key}" ` +
          `onclick="TPS_REGION.set('${k}')">${esc(r.short)}</button>`).join('') + `</span>`;
    },
    set(k) {
      if (!REGIONS[k] || k === key) return;
      try { localStorage.setItem(KEY, k); } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.set('region', k);
      location.href = u.toString();
    },
  };
})();
