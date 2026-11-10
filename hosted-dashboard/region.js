/* ============================================================
   Region scope shared by revenue-dashboard, views (/bookings…) and calendar.
   Each region is a separate book — the pages never mix NCR and Jaipur money.

   Picked by ?region=ncr|jaipur, else the last choice (localStorage), else NCR.
   Switching reloads the page with ?region=…, so load() runs once per region
   and nothing cached from the other book can leak into the numbers.

   City values must match venues.city exactly (CLAUDE.md: use venues.city for
   location routing, never the venues.team_id → teams.city join).

   ACCESS (RBAC v2, docs/RBAC_PLAN_v2_2026-11-10.md): TPS_REGION.authorize()
   asks the database who the signed-in person is (rpc my_access) and limits
   the switch to their regions. It is the front door only: what each person
   can READ is decided by the rbac_* RLS policies, not by this file.
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
    access: null,
    allowed: Object.keys(REGIONS),
    /* Returns the my_access() object, null when this account may not use the
       page, or 'redirect' when it is reloading into one of the person's own
       regions. opts.roles limits the page to those roles. */
    async authorize(sb, opts) {
      let acc = null;
      try {
        const { data, error } = await sb.rpc('my_access');
        if (!error) acc = data;
      } catch (e) { acc = null; }
      if (!acc || !acc.role) return null;
      if (opts && opts.roles && !opts.roles.includes(acc.role)) return null;
      const allowed = acc.role === 'owner'
        ? Object.keys(REGIONS)
        : (acc.regions || []).filter(r => REGIONS[r]);
      if (!allowed.length) return null;
      this.access = acc;
      this.allowed = allowed;
      if (!allowed.includes(key)) { this.set(allowed[0], true); return 'redirect'; }
      return acc;
    },
    switcherHtml() {
      const shown = Object.entries(REGIONS).filter(([k]) => this.allowed.includes(k));
      if (shown.length < 2) return '';
      return `<span class="rgn" role="group" aria-label="Region">` +
        shown.map(([k, r]) =>
          `<button type="button" class="${k === key ? 'on' : ''}" aria-pressed="${k === key}" ` +
          `onclick="TPS_REGION.set('${k}')">${esc(r.short)}</button>`).join('') + `</span>`;
    },
    set(k, force) {
      if (!REGIONS[k] || (k === key && !force)) return;
      if (!this.allowed.includes(k)) return;
      try { localStorage.setItem(KEY, k); } catch (e) {}
      const u = new URL(location.href);
      u.searchParams.set('region', k);
      location.href = u.toString();
    },
  };
})();
