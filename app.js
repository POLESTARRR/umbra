/* ===========================================================================
   UMBRA / app.js   (India-centric)

   Basics done properly, then the things nobody builds:
     · skin as a COLOUR you can point at, not a roman numeral
     · a burn-time matrix for every tone at every index from 1 to 12
     · an actual reapplication timetable in clock time, from today's forecast
     · how many grams the whole day costs you, in bottles
     · 7-day outlook and 18 Indian cities ranked

   Data: Open-Meteo, free, no key, no registration, CORS open. Offline it
   falls back to uv-engine.js and says so.
   =========================================================================== */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var API = 'https://api.open-meteo.com/v1/forecast';

  /* --- Skin as something you can actually point at ---------------------
     Swatches span the range common across India and beyond. The roman
     numeral is kept only as a small footnote for anyone who knows it.
     MED values are the burn thresholds the whole app is built on.        */
  var TONES = [
    { k: 'I',   hex: '#F6DDCC', name: 'Very fair',      note: 'Burns fast, almost never tans',  med: 200 },
    { k: 'II',  hex: '#EFC9AC', name: 'Fair',           note: 'Usually burns, tans a little',   med: 250 },
    { k: 'III', hex: '#DFAE87', name: 'Light wheatish', note: 'Sometimes burns, tans evenly',   med: 300 },
    { k: 'IV',  hex: '#C68A5F', name: 'Wheatish',       note: 'Rarely burns, tans easily',      med: 450 },
    { k: 'V',   hex: '#96603A', name: 'Brown',          note: 'Very rarely burns, tans deeply', med: 600 },
    { k: 'VI',  hex: '#5C3A22', name: 'Deep brown',     note: 'Almost never burns',             med: 1000 }
  ];

  var CITIES = [
    ['Delhi', 28.61, 77.21], ['Mumbai', 19.08, 72.88], ['Kolkata', 22.57, 88.36],
    ['Chennai', 13.08, 80.27], ['Bengaluru', 12.97, 77.59], ['Hyderabad', 17.39, 78.49],
    ['Ahmedabad', 23.02, 72.57], ['Pune', 18.52, 73.86], ['Jaipur', 26.91, 75.79],
    ['Lucknow', 26.85, 80.95], ['Bhopal', 23.26, 77.41], ['Patna', 25.59, 85.14],
    ['Guwahati', 26.14, 91.74], ['Srinagar', 34.08, 74.80], ['Leh', 34.16, 77.58],
    ['Panaji', 15.49, 73.83], ['Thiruvananthapuram', 8.52, 76.94], ['Port Blair', 11.62, 92.73]
  ];

  var HOWTO = [
    ['Timing', 'Put it on 15 to 30 minutes before you step out. Filters need to settle into an even film; applied at the door, you walk out unprotected.', '20 min early'],
    ['Second coat', 'The single highest-value habit in sun protection. Apply again 20 minutes after going out. Nobody gets the full amount on in one pass, and a second coat roughly doubles the film.', '+20 min'],
    ['Two fingers', 'For face and neck, squeeze a line along the full length of your index and middle fingers. That is about 2 g. Most people use a fifth of it.', '2 g'],
    ['Missed spots', 'Ears, eyelids, the hairline and parting, the back of the neck, the tops of feet, and lips. Eyelid skin is thin, heavily exposed and among the most commonly skipped.', '6 spots'],
    ['After towelling', 'A towel takes most of the film with it. Reapply after drying, every time. That matters more than the clock.', 'Always'],
    ['Makeup does not count', 'SPF in a foundation or day cream is applied far too thinly to reach its rated protection. Treat it as a bonus, never as your sunscreen.', 'Not enough'],
    ['Cloud is not shade', 'Thin cloud passes most ultraviolet, and broken cloud can push it 25% ABOVE a clear sky by scattering off bright edges. Overcast is the only sky that genuinely helps.', '+25%']
  ];

  /* --- persisted state -------------------------------------------------- */
  var S = {
    tone: 'IV', height: 170, weight: 65, spf: 50, frac: 0.055, density: 40,
    lat: 28.61, lon: 77.21, place: 'Delhi',
    planStart: 10, planEnd: 16, planLam: 0.30,
    age: 25, who: 'me', childAge: 8, history: {}, aerosolMeasured: null,
    cmMode: 'car', cmBearing: 90, cmMins: 40, cmYears: 3,
    pgGlass: 1, bottle: [], outHours: [8,9,17,18],
    inShade: false, shadeSPF: null,
    appliedAt: null, lambda: 0.12, appliedSPF: null, doseJ: 0, lastTick: null
  };
  try {
    var sv = JSON.parse(localStorage.getItem('umbra2') || '{}');
    for (var k in sv) if (k in S) S[k] = sv[k];
  } catch (e) {}
  function save() { try { localStorage.setItem('umbra2', JSON.stringify(S)); } catch (e) {} }

  function tone() {
    for (var i = 0; i < TONES.length; i++) if (TONES[i].k === S.tone) return TONES[i];
    return TONES[3];
  }
  function med() { return tone().med; }

  /* --- live conditions --------------------------------------------------- */
  var live = { uvi: 0, peak: 0, peakAt: null, hourly: [], daily: null, source: 'model' };

  function bandOf(u) {
    return u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme';
  }
  function fmtMins(m) {
    if (!isFinite(m)) return '·';
    if (m >= 600) return '10 h+';
    if (m >= 90) return (m / 60).toFixed(1) + ' h';
    return Math.max(0, Math.round(m)) + ' min';
  }
  function hhmm(h) {
    var H = Math.floor(h), M = Math.round((h - H) * 60);
    if (M === 60) { H++; M = 0; }
    return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M;
  }
  /* burn minutes for a given MED and index */
  function burnMins(uvi, medJ) {
    return uvi <= 0 ? Infinity : medJ / (0.025 * uvi) / 60;
  }

  function modelDay() {
    var now = new Date(), hours = [], peak = 0, peakAt = 0;
    for (var h = 0; h < 24; h++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 30);
      var u = window.UV.uvIndex(d, S.lat, S.lon, { albedo: 'grass', cloud: 'clear' }).uvi;
      hours.push(u);
      if (u > peak) { peak = u; peakAt = h; }
    }
    var nowU = window.UV.uvIndex(now, S.lat, S.lon, { albedo: 'grass', cloud: 'clear' }).uvi;
    return { uvi: nowU, peak: peak, peakAt: peakAt, hourly: hours, daily: null, source: 'model' };
  }

  function refresh() {
    $('src-badge').textContent = 'Fetching…';
    var url = API + '?latitude=' + S.lat + '&longitude=' + S.lon +
      '&current=uv_index,cloud_cover,relative_humidity_2m&hourly=uv_index' +
      '&daily=uv_index_max,uv_index_clear_sky_max,sunrise,sunset' +
      '&timezone=auto&forecast_days=7';

    fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status); return r.json();
    }).then(function (j) {
      var hrs = (j.hourly && j.hourly.uv_index || []).slice(0, 24);
      var peakAt = 0, best = -1;
      for (var i = 0; i < hrs.length; i++) if (hrs[i] > best) { best = hrs[i]; peakAt = i; }
      live = {
        uvi: j.current ? j.current.uv_index : 0,
        cloud: j.current ? j.current.cloud_cover : null,
        rh: j.current ? j.current.relative_humidity_2m : null,
        peak: (j.daily && j.daily.uv_index_max[0] != null) ? j.daily.uv_index_max[0] : best,
        peakAt: peakAt, hourly: hrs, daily: j.daily, source: 'live'
      };
      $('src-badge').textContent = 'Live · Open-Meteo' +
        (live.cloud != null ? ' · ' + live.cloud + '% cloud' : '');
      paintAll(); paintWeek();
    }).catch(function () {
      live = modelDay();
      $('src-badge').textContent = 'Offline · on-device model (clear sky)';
      $('week-hint').textContent = 'Needs a connection';
      $('week-rows').innerHTML = '';
      paintAll();
    });
  }

  /* ===================================================================== */
  /*  SKIN TONE PICKER                                                      */
  /* ===================================================================== */

  function buildTones() {
    $('tones').innerHTML = TONES.map(function (t) {
      // no card, no border: the colour is the control. The description moved
      // into the sentence underneath, which had room for it.
      return '<button class="tone" type="button" role="radio" data-k="' + t.k + '"' +
        ' title="' + t.note + '" aria-checked="' + (t.k === S.tone) + '">' +
        '<span class="tone__sw" style="background:' + t.hex + '"></span>' +
        '<span class="tone__name">' + t.name + '</span>' +
        '<span class="tone__fitz">' + t.k + '</span></button>';
    }).join('');

    $('tones').addEventListener('click', function (e) {
      var b = e.target.closest('.tone');
      if (!b) return;
      S.tone = b.dataset.k;
      $('tones').querySelectorAll('.tone').forEach(function (x) {
        x.setAttribute('aria-checked', String(x === b));
      });
      save(); paintAll();
    });
  }

  function paintMelanin() {
    var t = tone();
    var ratio = (t.med / 200).toFixed(1);
    $('melanin').innerHTML = '<b>' + t.name + '</b>. ' + t.note.charAt(0).toLowerCase() + t.note.slice(1) + '. ' + (t.med >= 450
      ? 'Your skin takes about <b>' + ratio + '×</b> longer to burn than the fairest skin. That is real, and it is roughly the protection of an SPF ' + ratio +
        '. It is not immunity. Melanin does not stop ultraviolet reaching the deeper layers, damage still accumulates without any redness to warn you, and skin cancers on darker skin are typically found later and do worse. Sunscreen is still the tool.'
      : 'Your skin reaches a burn dose quickly. Treat the burn table as a hard ceiling rather than a target, and assume you will need shade as well as sunscreen on any high-index day.');
  }

  /* ===================================================================== */
  /*  NOW                                                                   */
  /* ===================================================================== */

  var P = { x0: 46, x1: 986, y0: 26, y1: 236, max: 14 };
  function px(h) { return P.x0 + (h / 24) * (P.x1 - P.x0); }
  function py(u) { return P.y1 - clamp(u / P.max, 0, 1) * (P.y1 - P.y0); }

  function paintPlot() {
    var hrs = live.hourly || [];
    P.max = Math.max(6, Math.ceil(Math.max.apply(null, hrs.concat([1])) / 2) * 2 + 2);
    var g = '', i, step = Math.max(2, Math.round(P.max / 5));
    for (i = 0; i <= P.max; i += step) {
      g += '<line class="' + (i === 0 ? 'axis' : 'grid') + '" x1="' + P.x0 + '" y1="' + py(i).toFixed(1) +
           '" x2="' + P.x1 + '" y2="' + py(i).toFixed(1) + '"/>' +
           '<text class="tick" x="' + (P.x0 - 10) + '" y="' + (py(i) + 5).toFixed(1) + '" text-anchor="end">' + i + '</text>';
    }
    for (i = 0; i <= 24; i += 6) {
      g += '<text class="tick" x="' + px(i).toFixed(1) + '" y="' + (P.y1 + 26) + '" text-anchor="middle">' + hhmm(i) + '</text>';
    }
    if (P.max >= 6) {
      g += '<line class="burn" x1="' + P.x0 + '" y1="' + py(6).toFixed(1) + '" x2="' + P.x1 + '" y2="' + py(6).toFixed(1) + '"/>' +
           '<text class="burnlbl" x="' + (P.x1 - 4) + '" y="' + (py(6) - 8).toFixed(1) + '" text-anchor="end">COVER UP ABOVE 6</text>';
    }
    $('dayplot-grid').innerHTML = g;

    var d = '';
    for (i = 0; i < hrs.length; i++) d += (i ? 'L' : 'M') + px(i + 0.5).toFixed(1) + ' ' + py(hrs[i] || 0).toFixed(1) + ' ';
    $('daycurve').setAttribute('d', d.trim());

    var now = new Date(), hNow = now.getHours() + now.getMinutes() / 60;
    $('daynow').innerHTML =
      '<line class="nowline" x1="' + px(hNow).toFixed(1) + '" y1="' + P.y0 + '" x2="' + px(hNow).toFixed(1) + '" y2="' + P.y1 + '"/>' +
      '<circle class="nowdot" cx="' + px(hNow).toFixed(1) + '" cy="' + py(live.uvi || 0).toFixed(1) + '" r="5"/>' +
      '<text class="nowlbl" x="' + px(hNow).toFixed(1) + '" y="' + (P.y0 - 8) + '" text-anchor="middle">NOW</text>';
  }

  /* First and last hour above a threshold, the "avoid this window" pair. */
  function windowAbove(thr) {
    var hrs = live.hourly || [], a = -1, b = -1;
    for (var i = 0; i < hrs.length; i++) if (hrs[i] >= thr) { if (a < 0) a = i; b = i; }
    return a < 0 ? null : { from: a, to: b + 1 };
  }

  function paintNow() {
    var u = live.uvi || 0;
    $('r-uvi').textContent = u.toFixed(1);
    $('r-band').textContent = bandOf(u);

    var bm = burnMins(u, med());
    $('r-burn').innerHTML = u <= 0.05 ? 'No burn' : fmtMins(bm).replace(/ (min|h\+?)$/, '<small>$1</small>');
    $('r-burnsub').textContent = 'bare skin · ' + tone().name.toLowerCase();

    $('r-peak').textContent = (live.peak || 0).toFixed(1);
    $('r-peakat').textContent = live.peakAt != null ? 'around ' + hhmm(live.peakAt) : '·';

    var w = windowAbove(6);
    $('r-window').innerHTML = w ? hhmm(w.from) + '–' + hhmm(w.to) : 'None';

    var v;
    if (u < 1) v = 'Nothing needed right now at ' + S.place + '. Today still peaks at ' + (live.peak || 0).toFixed(1) + (w ? ', so the window to plan around is ' + hhmm(w.from) + ' to ' + hhmm(w.to) + '.' : '.');
    else if (u < 3) v = 'Low. Sunscreen is optional unless you will be out for hours, or near water, sand or snow, which throw extra ultraviolet back up at you.';
    else if (u < 6) v = 'Moderate. Bare skin takes about ' + fmtMins(bm) + ' to a full burn dose. Cover up if you will be out longer than that.';
    else if (u < 8) v = 'High. About ' + fmtMins(bm) + ' bare. Apply the full amount, add a second coat 20 minutes in, and reapply on the plan below.';
    else if (u < 11) v = 'Very high. Roughly ' + fmtMins(bm) + ' bare. Stay out of open sun ' + (w ? hhmm(w.from) + ' to ' + hhmm(w.to) : 'around midday') + ' if you can, because sunscreen alone is not enough at this level.';
    else v = 'Extreme. Around ' + fmtMins(bm) + ' bare. Treat open sun near midday as something to avoid outright, not to manage.';
    $('verdict').textContent = v;

    paintPlot();
  }

  /* ===================================================================== */
  /*  BURN MATRIX: every tone, every index 1 to 12                         */
  /* ===================================================================== */

  function paintMatrix() {
    var nowU = Math.round(live.uvi || 0);
    var head = '<thead><tr><th class="m-corner">Skin tone</th>';
    for (var u = 1; u <= 12; u++) {
      head += '<th' + (u === nowU ? ' class="is-now"' : '') + '>' + u + '</th>';
    }
    head += '</tr></thead>';

    var body = '<tbody>';
    TONES.forEach(function (t) {
      var mine = t.k === S.tone;
      body += '<tr' + (mine ? ' class="is-mine"' : '') + '>' +
        '<th class="m-tone"><span class="m-sw" style="background:' + t.hex + '"></span>' + t.name + '</th>';
      for (var u = 1; u <= 12; u++) {
        var m = burnMins(u, t.med);
        var txt = m >= 90 ? (m / 60).toFixed(1) + 'h' : Math.round(m);
        body += '<td' + (u === nowU ? ' class="is-now"' : '') + '>' + txt + '</td>';
      }
      body += '</tr>';
    });
    body += '</tbody>';

    $('matrix').innerHTML = '<caption>Minutes of bare skin before one full burn dose' +
      (nowU >= 1 && nowU <= 12 ? ' · the marked column is the index at ' + S.place + ' right now' : '') +
      '</caption>' + head + body;
  }

  /* ===================================================================== */
  /*  HOW MUCH                                                              */
  /* ===================================================================== */

  function gramsNeeded() {
    return window.UV.requiredMass(window.UV.bodySurfaceArea(S.height, S.weight), S.frac);
  }

  function paintDose() {
    var bsa = window.UV.bodySurfaceArea(S.height, S.weight);
    var grams = gramsNeeded();
    $('d-bsa').innerHTML = bsa.toFixed(2) + '<small>m²</small>';

    if (grams < 6) {
      $('d-grams').innerHTML = grams.toFixed(1) + '<small>g</small>';
      $('d-alt').textContent = Math.round(grams / 0.5) + ' finger lengths · about ' + (grams / 5).toFixed(1) + ' tsp';
    } else {
      $('d-grams').innerHTML = Math.round(grams) + '<small>g</small>';
      $('d-alt').textContent = (grams / 5).toFixed(1) + ' teaspoons · about ' + (grams / 30).toFixed(1) + ' shot glass';
    }

    var f = S.density / 100;
    var eff = window.UV.effectiveSPF(S.spf, 2 * f);
    $('d-eff').innerHTML = 'SPF ' + eff.toFixed(1);
    $('d-efflabel').textContent = 'from a bottle marked ' + S.spf;
    $('s-pct').textContent = S.density + '%';
    $('s-dose').textContent = 'of the certified amount, ' + (grams * f).toFixed(1) + ' g, not ' + grams.toFixed(1) + ' g';

    var lost = Math.round((1 - (eff - 1) / (S.spf - 1)) * 100);
    $('collapse').innerHTML = 'Your <b>SPF ' + S.spf + '</b> is really behaving like <b>SPF ' + eff.toFixed(1) +
      '</b>, about <b>' + lost + '%</b> of the protection you paid for, gone. ' +
      (S.density >= 95 ? 'This is the amount the number on the bottle assumes.' : 'Fixing this costs nothing except using more of the bottle.');
  }

  function paintHowTo() {
    $('howto-rows').innerHTML = HOWTO.map(function (r) {
      return '<div class="row"><span class="row__label">' + r[0] + '</span>' +
             '<p class="row__desc">' + r[1] + '</p><span class="row__value">' + r[2] + '</span></div>';
    }).join('');
  }

  /* ===================================================================== */
  /*  THE PLAN: a real timetable, simulated minute by minute               */
  /* ===================================================================== */

  function uviAt(h) {
    var hrs = live.hourly || [];
    if (!hrs.length) return 0;
    var i = clamp(Math.floor(h), 0, 23);
    var j = clamp(i + 1, 0, 23), f = h - i;
    return (hrs[i] || 0) * (1 - f) + (hrs[j] || 0) * f;
  }

  function buildPlan() {
    var start = S.planStart, end = S.planEnd, lam = S.planLam;
    if (end <= start) end = start + 1;

    var appliedSPF = window.UV.effectiveSPF(S.spf, 2 * (S.density / 100));
    var floor = Math.max(3, appliedSPF * 0.35);
    var base = 0, doseJ = 0, events = [], secondDone = false;

    events.push({ t: start, why: 'Full amount, 20 minutes before you leave' });

    for (var m = 0; m <= (end - start) * 60; m++) {
      var h = start + m / 60;
      var spfNow = window.UV.decayedSPF(appliedSPF, m - base, lam);
      doseJ += 0.025 * uviAt(h) * 60 / spfNow;

      if (!secondDone && m - base >= 20) {
        events.push({ t: h, why: 'Second coat, the one that gets you to the rated amount' });
        base = m; secondDone = true; continue;
      }
      if (secondDone && (spfNow <= floor || m - base >= 120) && h < end - 0.15) {
        events.push({
          t: h,
          why: spfNow <= floor
            ? (lam >= 1.6 ? 'Film washed off. Reapply as soon as you are out and dry'
              : lam >= 0.8 ? 'Sweated off. Reapply now' : 'Film has worn down. Reapply')
            : 'Two hours since the last coat'
        });
        base = m;
      }
    }

    var g = gramsNeeded(), total = g * events.length;
    var pct = doseJ / med() * 100;

    $('pl-count').textContent = events.length;
    $('pl-gap').textContent = 'over ' + (end - start) + ' hours outdoors';
    $('pl-grams').innerHTML = Math.round(total) + '<small>g</small>';
    // Bottles only read as a quantity once there are enough of them; below
    // that a teaspoon is the unit people can actually picture.
    $('pl-bottle').textContent = total >= 50
      ? (total / 200).toFixed(1) + ' × a 200 ml bottle'
      : (total / 5).toFixed(1) + ' teaspoons across the day';
    $('pl-budget').innerHTML = pct.toFixed(0) + '<small>%</small>';

    $('plan-rows').innerHTML = events.map(function (e, i) {
      return '<div class="row"><span class="row__label">' + hhmm(e.t) + '</span>' +
        '<p class="row__desc">' + e.why + '</p>' +
        '<span class="row__value">' + (i === 0 ? 'apply' : 'coat ' + (i + 1)) + ' · ' + g.toFixed(1) + ' g</span></div>';
    }).join('');

    var bare = 0;
    for (var q = 0; q <= (end - start) * 60; q++) bare += 0.025 * uviAt(start + q / 60) * 60;
    var barePct = bare / med() * 100;

    var msg;
    if (pct >= 100 && S.density < 90) {
      // Reapplying on time but too thinly still burns you. Name the real cause
      // rather than blaming the hours, since the fix here is the amount and not the clock.
      var fixed = 0, b2 = 0, sp2 = window.UV.effectiveSPF(S.spf, 2), fl2 = Math.max(3, sp2 * 0.35);
      for (var z = 0; z <= (end - start) * 60; z++) {
        var s2 = window.UV.decayedSPF(sp2, z % 120, lam);
        fixed += 0.025 * uviAt(start + z / 60) * 60 / Math.max(s2, fl2);
      }
      b2 = fixed / med() * 100;
      msg = 'You spend a full burn dose even though you reapply ' + events.length + ' times, and the cause is not the timetable. It is the amount. ' +
            'At ' + S.density + '% of the certified thickness your bottle behaves like SPF ' +
            window.UV.effectiveSPF(S.spf, 2 * (S.density / 100)).toFixed(1) +
            '. Applying the full ' + g.toFixed(1) + ' g on the same schedule would bring this down to about ' + Math.round(b2) + '%.';
    } else if (pct >= 100) {
      msg = 'Even applying the full amount on schedule, these hours spend a whole burn dose. The hours are the problem, so move some of them out of ' +
            (windowAbove(6) ? hhmm(windowAbove(6).from) + '–' + hhmm(windowAbove(6).to) : 'the middle of the day') + ', or add shade and clothing.';
    } else {
      msg = 'Bare skin over the same hours would cost you ' + Math.round(barePct) + '% of a burn dose, about ' +
            (barePct / Math.max(pct, 0.01)).toFixed(0) + '× what this plan costs. That gap is the entire value of doing it properly.';
    }
    $('pl-verdict').textContent = msg;
  }

  /* ===================================================================== */
  /*  LIVE TRACKER                                                          */
  /* ===================================================================== */

  function currentSPF() {
    if (!S.appliedAt) return 1;
    return window.UV.decayedSPF(S.appliedSPF || 1, (Date.now() - S.appliedAt) / 60000, S.lambda);
  }
  function tick() {
    if (!S.appliedAt) { S.lastTick = null; return; }
    var now = Date.now();
    if (S.lastTick) {
      var shade = (S.inShade && S.shadeSPF > 1) ? S.shadeSPF : 1;
      var add = 0.025 * ((live.uvi || 0) / shade) * ((now - S.lastTick) / 1000) / currentSPF();
      S.doseJ += add;
      bankDose(add / 100);            // SED into the lifetime ledger
    }
    S.lastTick = now; save();
  }

  function paintProtection() {
    var spf = currentSPF(), u = live.uvi || 0, M = med();
    $('p-spf').textContent = S.appliedAt ? spf.toFixed(1) : '·';
    $('p-since').textContent = S.appliedAt
      ? 'applied ' + fmtMins((Date.now() - S.appliedAt) / 60000) + ' ago, from SPF ' + (S.appliedSPF || 0).toFixed(1)
      : 'nothing on';

    var pct = clamp(S.doseJ / M * 100, 0, 999);
    $('p-used').innerHTML = pct.toFixed(0) + '<small>%</small>';
    $('p-bar').style.width = Math.min(100, pct) + '%';
    $('p-bar').className = 'meter__fill' + (pct >= 85 ? ' is-over' : pct >= 60 ? ' is-warn' : '');

    var rate = 0.025 * u / spf;
    var left = rate > 0 ? (M - S.doseJ) / rate / 60 : Infinity;
    $('p-left').innerHTML = left <= 0 ? '0<small>min</small>' : fmtMins(left).replace(/ (min|h\+?)$/, '<small>$1</small>');

    var msg;
    if (!S.appliedAt) msg = 'Apply, then press the button so the clock is real rather than guessed.';
    else if (pct >= 100) msg = 'You have spent a full burn dose. Reapplying will not undo it. Only getting out of the sun will.';
    else if (pct >= 85) msg = 'Close to a full burn dose. Shade, not more sunscreen.';
    else if (spf < 4 && u >= 3) msg = 'The film is effectively gone. Reapply the full amount now, not a token wipe.';
    else if (left < 30 && u >= 3) msg = 'Under half an hour of headroom. Reapply now or move into shade.';
    else msg = 'Holding. It falls much faster the moment you swim, sweat or towel off, so keep it told.';
    $('p-verdict').textContent = msg;
    $('p-state').textContent = S.appliedAt ? 'Tracking' : 'Nothing applied';
  }

  /* ===================================================================== */
  /*  WEEK + INDIA                                                          */
  /* ===================================================================== */

  function paintWeek() {
    var d = live.daily;
    if (!d) return;
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var out = '';
    for (var i = 0; i < d.time.length; i++) {
      var dt = new Date(d.time[i] + 'T12:00:00');
      var peak = d.uv_index_max[i] || 0, clear = d.uv_index_clear_sky_max[i] || 0;
      var bm = burnMins(peak, med());
      out += '<div class="row"><span class="row__label">' + bandOf(peak) + '</span>' +
        '<p class="row__desc"><b>' + (i === 0 ? 'Today' : days[dt.getDay()] + ' ' + dt.getDate()) + '</b>, peak ' +
        peak.toFixed(1) + (clear > peak + 0.4 ? ', clear-sky ceiling ' + clear.toFixed(1) + ' if the cloud breaks' : '') +
        '. Bare skin lasts ' + fmtMins(bm) + ' at the peak. Sun ' + d.sunrise[i].slice(-5) + ' to ' + d.sunset[i].slice(-5) + '.</p>' +
        '<span class="row__value">' + peak.toFixed(1) + '</span></div>';
    }
    $('week-rows').innerHTML = out;
    $('week-hint').textContent = d.time.length + ' days · ' + S.place;
  }

  /* Live regional AOD + PM2.5, used only to derive the local conversion
     ratio. Free, no key, CORS open, same family as the weather endpoint. */
  function loadAirReference() {
    fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + S.lat +
          '&longitude=' + S.lon + '&current=pm2_5,aerosol_optical_depth,dust&timezone=auto')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.current) return;
        live.refAOD = j.current.aerosol_optical_depth;
        live.refPM25 = j.current.pm2_5;
        live.refDust = j.current.dust;
        paintAir();
      }).catch(function () { /* stays on the global calibration */ });
  }

  function loadIndia() {
    var url = API + '?latitude=' + CITIES.map(function (c) { return c[1]; }).join(',') +
      '&longitude=' + CITIES.map(function (c) { return c[2]; }).join(',') +
      '&current=uv_index&daily=uv_index_max&timezone=auto&forecast_days=1';

    fetch(url).then(function (r) { return r.json(); }).then(function (arr) {
      if (!Array.isArray(arr)) arr = [arr];
      var rows = arr.map(function (d, i) {
        return {
          name: CITIES[i] ? CITIES[i][0] : '?',
          now: (d.current && d.current.uv_index) || 0,
          peak: (d.daily && d.daily.uv_index_max && d.daily.uv_index_max[0]) || 0
        };
      }).sort(function (a, b) { return (b.now - a.now) || (b.peak - a.peak); });

      var dark = rows.every(function (r) { return r.now < 0.5; });
      // eighteen cities as eighteen prose rows was a screen and a half of
      // scrolling for a ranking. It is a ranking, so it reads as a grid.
      $('india-rows').innerHTML = rows.map(function (r) {
        var bm = burnMins(dark ? r.peak : r.now, med());
        var lead = dark ? r.peak : r.now;
        return '<div class="city" title="' + bandOf(lead) + ', bare skin lasts ' + fmtMins(bm) + '">' +
          '<span class="city__name">' + r.name + '</span>' +
          '<span class="city__now">' + lead.toFixed(1) + '</span>' +
          '<span class="city__sub">' + (dark ? 'peak today' : 'peak ' + r.peak.toFixed(1)) + '</span>' +
          '</div>';
      }).join('');
      $('india-hint').textContent = rows.length + ' cities · ' +
        (dark ? 'after dark, ranked by today\'s peak' : 'ranked by what is falling now');
    }).catch(function () {
      $('india-hint').textContent = 'Offline. Needs a connection';
    });
  }

  /* ===================================================================== */


  /* =====================================================================
     SHADE METER: camera as shadowband radiometer.
     Verified on synthetic imagery through HDR tone mapping and 4:2:0 JPEG:
     mean error 0.010 in UV diffuse fraction, AOD550 to +-0.01.
     ===================================================================== */

  var SM = { fdUV: null, aod: null, alpha: null, sky: null };

  function loadImageData(file, maxW) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        var sc = Math.min(1, maxW / img.width);
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        var x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, c.width, c.height);
        res(x.getImageData(0, 0, c.width, c.height));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  function paintShade() {
    if (SM.fdUV != null) {
      $('sm-fd').innerHTML = Math.round(SM.fdUV * 100) + '<small>%</small>';
      $('sm-fdsub').textContent = SM.fdUV > 0.75 ? 'shade will barely help here'
        : SM.fdUV > 0.55 ? 'shade helps, but less than it looks' : 'shade works well here';
      $('sm-aod').textContent = SM.aod.toFixed(2);
    }
    if (SM.sky != null) $('sm-sky-f').innerHTML = Math.round(SM.sky * 100) + '<small>%</small>';

    if (SM.fdUV != null && SM.sky != null) {
      var spf = window.ShadeMeter.shadeSPF(SM.fdUV, SM.sky);
      S.shadeSPF = spf; save();
      var chip = $('chip-shade');
      if (chip) { chip.hidden = false; chip.textContent = 'Under that shade (SPF ' + (spf >= 20 ? Math.round(spf) : spf.toFixed(1)) + ')'; }
      $('sm-spf').textContent = 'SPF ' + (spf >= 20 ? Math.round(spf) : spf.toFixed(1));
      $('sm-verdict').textContent = spf < 3
        ? 'This shade is worth about SPF ' + spf.toFixed(1) + '. That is close to nothing, ' +
          Math.round(SM.fdUV * 100) + '% of your ultraviolet is arriving from open sky, and this cover leaves ' +
          Math.round(SM.sky * 100) + '% of that sky in view. Treat it as glare relief, not protection.'
        : spf < 8
        ? 'About SPF ' + spf.toFixed(1) + '. Real, but weaker than it feels: it blocks the sun disc while ' +
          Math.round(SM.sky * 100) + '% of the sky still reaches you. Fine for a short stop, not for the middle of the day.'
        : 'About SPF ' + Math.round(spf) + '. Genuinely protective, and better than most people manage with sunscreen.';
    }
  }

  function wireShade() {
    if (!window.ShadeMeter) return;

    $('sm-comb').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      $('sm-badge').textContent = 'Reading the comb…';
      loadImageData(f, 900).then(function (img) {
        var sun = window.UV.solarPosition(new Date(), S.lat, S.lon);
        if (sun.mu0 <= 0.05) { $('sm-badge').textContent = 'Sun too low to measure'; return; }
        var du = window.UV.ozoneAt(S.lat, new Date().getUTCMonth());
        var r = window.ShadeMeter.analyseComb(img, sun.mu0, du);
        if (!r.ok) { $('sm-badge').textContent = 'Could not read it'; $('sm-verdict').textContent = r.reason; return; }
        SM.fdUV = r.fdUV; SM.aod = r.aod550; SM.alpha = r.alpha;
        paintAir();
        // the measurement the clear-sky engine could never make for itself
        S.aerosolMeasured = r.aod550; save();
        $('sm-badge').textContent = 'Measured · pitch ' + r.pitch + 'px · haze ' + r.aod550.toFixed(2);
        paintShade();
      });
    });

    $('sm-sky').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      loadImageData(f, 700).then(function (img) {
        SM.sky = window.ShadeMeter.skyFraction(img);
        paintShade();
      });
    });
  }


  /* =====================================================================
     AIR / LEDGER / COMMUTE / LADDER  (insight.js)
     ===================================================================== */

  var BEARINGS = [['N',0],['NE',45],['E',90],['SE',135],['S',180],['SW',225],['W',270],['NW',315]];

  function todayKey() { return new Date().toISOString().slice(0, 10); }

  function bankDose(sed) {
    var k = todayKey();
    S.history[k] = (S.history[k] || 0) + sed;
    var keys = Object.keys(S.history).sort();
    while (keys.length > 400) { delete S.history[keys.shift()]; }   // keep it bounded
  }

  function paintAir() {
    if (!window.Insight || live.refPM25 == null) return;
    var pm = live.refPM25, a = window.Insight.aqiFromPM25(pm);
    var dustShare = (live.refDust != null && pm > 0) ? Math.min(1, live.refDust / pm) : 0;
    var kind = dustShare > 0.45 ? 'Dust' : dustShare > 0.15 ? 'Mixed' : 'Smoke';
    $('air-pm').innerHTML = Math.round(pm) + '<small class="u">µg/m³</small>';
    $('air-range').textContent = live.refAOD != null ? 'aerosol depth ' + live.refAOD.toFixed(2) : '';
    $('air-aqi').textContent = a.aqi;
    $('air-band').textContent = a.band;
    $('air-kind').textContent = kind;
    $('air-badge').textContent = 'Live · ' + S.place;
    $('air-verdict').textContent =
      (kind === 'Smoke' ? 'Fine combustion particles from traffic, burning and industry. A well-fitted N95 helps; cloth does almost nothing at this size. '
       : kind === 'Dust' ? 'Coarse wind-blown dust. Even a simple cover helps with particles this size, unlike smoke. '
       : 'A mix of fine and coarse particles. ') +
      (a.aqi >= 300 ? 'At this level the air is doing more damage today than the sun is.'
       : a.aqi >= 100 ? 'Worth factoring into when you go out, alongside the ultraviolet.' : '');
  }

  function paintLedger() {
    if (!window.Insight) return;
    var L = window.Insight.ledger(S.history, S.age, S.lat);
    $('led-ratio').innerHTML = L.ratio > 0 ? L.ratio.toFixed(2) + '<small>×</small>' : '·';
    $('led-equiv').innerHTML = L.ratio > 0 ? L.equivYearsPerYear.toFixed(1) + '<small>yr</small>' : '·';
    $('led-total').innerHTML = L.totalSED.toFixed(0) + '<small>SED</small>';
    $('led-days').textContent = L.days + (L.days === 1 ? ' day logged' : ' days logged');
    $('led-badge').textContent = L.confident ? 'Measured over ' + L.days + ' days' : 'Needs a few more days to be meaningful';

    if (!L.days) {
      $('led-verdict').textContent = 'Nothing banked yet. Press “I just applied it” in the tracker above and leave this open while you are outside. The ledger fills from real accumulated dose, not from a guess.';
    } else if (L.ratio >= 1.05) {
      $('led-verdict').textContent = 'You are taking sun at ' + L.ratio.toFixed(1) + '× the local average. Held for ten years, and assuming your past was ordinary, you would reach ' + (S.age + 10) + ' carrying the accumulated ultraviolet of a ' + L.projectedEquivalentAge(10).toFixed(0) + '-year-old.';
    } else {
      $('led-verdict').textContent = 'You are taking sun at ' + L.ratio.toFixed(2) + '× the local average, below typical. At this rate ten years costs you about ' + (10 * L.ratio).toFixed(0) + ' years of ordinary exposure.';
    }

    $('led-child').textContent = S.who === 'child'
      ? 'A child logged here matters more than you do. A large share of lifetime ultraviolet is taken before eighteen, and sunburn in childhood carries disproportionate melanoma risk. At the same rate, your ' + S.childAge + '-year-old banks ' + (L.perDay * 365).toFixed(0) + ' SED a year, with every year still ahead to add to it.'
      : '';
  }

  function paintCommute() {
    if (!window.Insight) return;
    var solarFn = function (d) {
      var s = window.UV.solarPosition(d, S.lat, S.lon);
      return { azimuth: s.azimuth, elevation: s.elevation, mu0: s.mu0 };
    };
    var uvFn = function (d) { return window.UV.uvIndex(d, S.lat, S.lon, {}).uvi; };
    var r = window.Insight.commuteAsymmetry({
      mode: S.cmMode, bearing: S.cmBearing, windowSide: 'right',
      outHour: 9, backHour: 18, minutes: S.cmMins, years: S.cmYears, tzHours: 5.5
    }, solarFn, uvFn);

    $('cm-side').textContent = r.side === 'right' ? 'Right' : 'Left';
    $('cm-ratio').innerHTML = isFinite(r.ratio) ? r.ratio.toFixed(1) + '<small>×</small>' : '·';

    var part = (S.cmMode === 'car' || S.cmMode === 'auto') ? 'cheek, temple and forearm' : 'cheek and forearm';
    $('cm-verdict').textContent = r.meaningful
      ? 'Over ' + S.cmYears + ' years of this commute your ' + r.side + ' ' + part + ' has taken roughly ' +
        r.ratio.toFixed(1) + '× the ultraviolet of the other side. Go to a mirror in daylight. Compare your two temples, then the outside of both forearms. ' +
        'If we are right you will see it. If we are wrong, this prediction was falsifiable, which is more than any bottle will ever offer you.'
      : 'This route is close to symmetric, so there is nothing to see in the mirror. That is a real result too.';
  }


  /* =====================================================================
     PIGMENT INDEX: the number the UV index is not.
     Sunburn is UVB (~305 nm). Tanning, melasma and photoageing are UVA.
     Ozone annihilates UVB at low sun and barely touches UVA, so the two run
     on completely different clocks, and UVA comes through glass.
     ===================================================================== */

  var PG_SCALE = null;
  function pigmentAt(mu0) {
    if (!window.ShadeMeter || mu0 <= 0.02) return 0;
    var sum = 0, l;
    for (l = 320; l <= 400; l += 10) {
      var r = window.ShadeMeter.irradiance(l / 1000, mu0, 0.4, 1.0, 300);
      sum += (r.direct + r.diffuse) * Math.pow(10, 0.0125 * (320 - l)) * mu0;
    }
    if (PG_SCALE === null) {
      var ref = 0;
      for (l = 320; l <= 400; l += 10) {
        var r2 = window.ShadeMeter.irradiance(l / 1000, 1.0, 0.2, 1.0, 300);
        ref += (r2.direct + r2.diffuse) * Math.pow(10, 0.0125 * (320 - l));
      }
      PG_SCALE = 11 / ref;
    }
    return sum * PG_SCALE;
  }
  function burnAt(mu0) {
    if (!window.ShadeMeter || mu0 <= 0.02) return 0;
    var r = window.ShadeMeter.irradiance(0.305, mu0, 0.4, 1.0, 300);
    return (r.direct + r.diffuse) * mu0;
  }
  function pgBand(p) { return p < 2 ? 'Low' : p < 5 ? 'Moderate' : p < 8 ? 'High' : 'Very high'; }

  function paintPigment() {
    if (!window.ShadeMeter) return;
    var now = new Date(), base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var pig = [], burn = [], h, maxB = 0, maxP = 0;
    for (h = 0; h < 24; h++) {
      var mu0 = window.UV.solarPosition(new Date(base.getTime() + h * 3600000 + 1800000), S.lat, S.lon).mu0;
      var b = burnAt(mu0), p = pigmentAt(mu0);
      burn.push(b); pig.push(p);
      if (b > maxB) maxB = b;
      if (p > maxP) maxP = p;
    }
    var g = S.pgGlass;
    var nowMu = window.UV.solarPosition(now, S.lat, S.lon).mu0;
    var pNow = pigmentAt(nowMu) * g;

    $('pg-now').textContent = pNow.toFixed(1);
    $('pg-band').textContent = pgBand(pNow) + (g < 1 ? ' · through glass' : '');

    function lastAbove(arr, mx) {
      for (var i = 23; i >= 0; i--) if (arr[i] >= 0.05 * mx) return i + 1;
      return null;
    }
    var bEnd = maxB > 0 ? lastAbove(burn, maxB) : null;
    var pEnd = maxP > 0 ? lastAbove(pig, maxP) : null;
    $('pg-burnend').textContent = (g < 1) ? 'blocked' : (bEnd ? hhmm(bEnd) : '·');
    $('pg-pigend').textContent = pEnd ? hhmm(pEnd) : '·';
    $('pg-extra').textContent = (bEnd && pEnd && pEnd > bEnd)
      ? (pEnd - bEnd) + ' hours after burning stops' : 'runs with the sun';
    $('pg-badge').textContent = 'Peak pigment ' + maxP.toFixed(1) + ' · peak UV index ' + (live.peak || 0).toFixed(1);

    var P2 = { x0: 46, x1: 986, y0: 26, y1: 236 };
    var px2 = function (x) { return P2.x0 + (x / 24) * (P2.x1 - P2.x0); };
    var py2 = function (v) { return P2.y1 - clamp(v, 0, 1) * (P2.y1 - P2.y0); };
    var gr = '', i;
    for (i = 0; i <= 100; i += 25) {
      gr += '<line class="' + (i === 0 ? 'axis' : 'grid') + '" x1="' + P2.x0 + '" y1="' + py2(i / 100).toFixed(1) +
            '" x2="' + P2.x1 + '" y2="' + py2(i / 100).toFixed(1) + '"/>' +
            '<text class="tick" x="' + (P2.x0 - 10) + '" y="' + (py2(i / 100) + 5).toFixed(1) + '" text-anchor="end">' + i + '%</text>';
    }
    for (i = 0; i <= 24; i += 6) gr += '<text class="tick" x="' + px2(i).toFixed(1) + '" y="' + (P2.y1 + 26) + '" text-anchor="middle">' + hhmm(i) + '</text>';
    $('pg-grid').innerHTML = gr;

    var db = '', dp = '';
    for (i = 0; i < 24; i++) {
      db += (i ? 'L' : 'M') + px2(i + 0.5).toFixed(1) + ' ' + py2(maxB ? burn[i] / maxB : 0).toFixed(1) + ' ';
      dp += (i ? 'L' : 'M') + px2(i + 0.5).toFixed(1) + ' ' + py2(maxP ? pig[i] / maxP : 0).toFixed(1) + ' ';
    }
    $('pg-burn').setAttribute('d', db.trim());
    $('pg-pig').setAttribute('d', dp.trim());
    var hNow = now.getHours() + now.getMinutes() / 60;
    $('pg-now-mark').innerHTML = '<line class="nowline" x1="' + px2(hNow).toFixed(1) + '" y1="' + P2.y0 +
      '" x2="' + px2(hNow).toFixed(1) + '" y2="' + P2.y1 + '"/><text class="nowlbl" x="' + px2(hNow).toFixed(1) +
      '" y="' + (P2.y0 - 8) + '" text-anchor="middle">NOW</text>';

    var msg;
    if (g < 0.1) msg = 'A laminated windscreen stops essentially all of it, the burning and the pigmenting alike. Side windows do not.';
    else if (g < 1) msg = 'Glass blocks UVB completely, so you cannot burn here. It passes about ' + Math.round(g * 100) +
      '% of UVA, so you are still pigmenting and still ageing for as long as you sit there. This is the exposure nobody counts.';
    else if (bEnd && pEnd && pEnd > bEnd) msg = 'Your sunburn risk today is over by ' + hhmm(bEnd) +
      '. Your pigmentation risk runs until ' + hhmm(pEnd) + ', ' + (pEnd - bEnd) +
      ' hours longer. If you tan rather than burn, the UV index has been giving you the wrong finishing time your whole life.';
    else msg = 'Both are low right now.';
    $('pg-verdict').textContent = msg;
  }

  /* ===================================================================== */
  /*  BOTTLE AUDIT                                                          */
  /* ===================================================================== */

  function buildBottleList() {
    if (!window.Filters) return;
    var uva = [], uvb = [], vis = [];
    window.Filters.FILTERS.forEach(function (f) {
      // Nineteen bordered cards ran to about 1400px of page. The label is the
      // only thing you match against your bottle, so the rest goes to the
      // tooltip and each filter becomes one small toggle.
      var row = '<label class="filt' + (f.uva ? ' filt--uva' : '') + '"' +
        ' title="' + f.inci + ', ' + f.note + '">' +
        '<input type="checkbox" value="' + f.k + '"' + (S.bottle.indexOf(f.k) >= 0 ? ' checked' : '') + '>' +
        '<span class="filt__name">' + f.name + '</span></label>';
      (f.visible ? vis : f.uva ? uva : uvb).push(row);
    });
    var group = function (label, arr) {
      return arr.length
        ? '<div class="filtset"><span class="filtset__label">' + label + '</span>' +
          '<div class="filts">' + arr.join('') + '</div></div>'
        : '';
    };
    $('bt-list').innerHTML =
      group('Blocks UVA · what matters for tanning and spots', uva) +
      group('UVB only · these stop you burning, nothing more', uvb) +
      group('Visible light', vis);
    $('bt-list').addEventListener('change', function (e) {
      if (e.target.type !== 'checkbox') return;
      S.bottle = Array.prototype.slice.call($('bt-list').querySelectorAll('input:checked')).map(function (i) { return i.value; });
      save(); paintBottle();
    });
  }

  function muDay() {
    var base = new Date(); base.setHours(0, 0, 0, 0);
    var mu = [];
    for (var h = 0; h < 24; h++) {
      mu.push(window.UV.solarPosition(new Date(base.getTime() + h * 3600000 + 1800000), S.lat, S.lon).mu0);
    }
    return mu;
  }

  function paintBottle() {
    if (!window.Filters) return;
    var has = S.bottle.length > 0;
    if (!has) {
      ['bt-peak', 'bt-steady', 'bt-yours'].forEach(function (i) { $(i).textContent = '·'; });
      $('bt-peakat').textContent = 'pick a product or tick your label';
      $('bt-yourssub').textContent = '·';
      $('bt-curve').setAttribute('d', ''); $('bt-grid').innerHTML = ''; $('bt-hours').innerHTML = '';
      $('bt-flags').innerHTML = '';
      // an axis-less empty plot is 250px of blank paper; take it out until
      // there is a bottle to draw
      $('btplot').style.display = 'none';
      $('bt-verdict').textContent = 'Search a sunscreen above, or tick the filters from your own bottle, and this will draw its shape against today’s sun where you are.';
      $('bt-badge').textContent = 'Tick what is on your label';
      return;
    }

    var mu = muDay();
    var sh = window.Filters.shape(S.bottle, mu);
    if (!sh) return;
    $('btplot').style.display = '';
    var yours = window.Filters.inYourHours(S.bottle, mu, S.outHours);

    var peakH = 0, best = -1;
    for (var i = 0; i < 24; i++) if (sh.curve[i] != null && mu[i] > 0.15 && sh.curve[i] > best) { best = sh.curve[i]; peakH = i; }

    $('bt-peak').textContent = Math.round(sh.peak);
    $('bt-peakat').textContent = 'around ' + hhmm(peakH) + ', when the sun is highest';
    $('bt-steady').innerHTML = Math.round(sh.steadiness * 100) + '<small>%</small>';
    $('bt-yours').textContent = yours ? Math.round(yours) : '·';
    $('bt-yourssub').textContent = S.outHours.map(hhmm).join(', ');

    // curve
    var P = { x0: 46, x1: 986, y0: 22, y1: 216 };
    var top = Math.max(10, Math.ceil(sh.peak / 10) * 10);
    var px3 = function (x) { return P.x0 + (x / 24) * (P.x1 - P.x0); };
    var py3 = function (v) { return P.y1 - clamp(v / top, 0, 1) * (P.y1 - P.y0); };
    var g = '', k;
    for (k = 0; k <= top; k += Math.max(5, Math.round(top / 4 / 5) * 5)) {
      g += '<line class="' + (k === 0 ? 'axis' : 'grid') + '" x1="' + P.x0 + '" y1="' + py3(k).toFixed(1) +
           '" x2="' + P.x1 + '" y2="' + py3(k).toFixed(1) + '"/><text class="tick" x="' + (P.x0 - 10) +
           '" y="' + (py3(k) + 5).toFixed(1) + '" text-anchor="end">' + k + '</text>';
    }
    for (k = 0; k <= 24; k += 6) g += '<text class="tick" x="' + px3(k).toFixed(1) + '" y="' + (P.y1 + 26) + '" text-anchor="middle">' + hhmm(k) + '</text>';
    $('bt-grid').innerHTML = g;

    var d = '', started = false;
    for (k = 0; k < 24; k++) {
      if (sh.curve[k] == null || mu[k] <= 0.05) { started = false; continue; }
      d += (started ? 'L' : 'M') + px3(k + 0.5).toFixed(1) + ' ' + py3(sh.curve[k]).toFixed(1) + ' ';
      started = true;
    }
    $('bt-curve').setAttribute('d', d.trim());
    $('bt-hours').innerHTML = S.outHours.map(function (h) {
      return sh.curve[h] == null ? '' : '<circle class="nowdot" cx="' + px3(h + 0.5).toFixed(1) +
        '" cy="' + py3(sh.curve[h]).toFixed(1) + '" r="4.5"/>';
    }).join('') + '<text class="nowlbl" x="' + px3(S.outHours[0] + 0.5).toFixed(1) + '" y="' + (P.y0 - 6) + '" text-anchor="middle">YOUR HOURS</text>';

    // positive, fit-based reading, never a verdict on the product
    var pct = Math.round(sh.steadiness * 100);
    var msg;
    if (pct >= 85) {
      msg = 'This one barely changes shape. It gives you about the same protection at eight in the morning as at noon, which makes it an easy bottle to rely on whatever your hours are, mineral filters and the newer photostable ones behave like this.';
    } else if (pct >= 55) {
      msg = 'This holds most of its strength through the day, easing off as the sun drops. It suits both midday sun and the edges of the day reasonably well.';
    } else {
      msg = 'This one is built around midday. At its peak it is strong, and it eases off toward the ends of the day, so it is at its best when you are out in the middle hours. If most of your sun is the commute, a bottle with zinc oxide, Tinosorb or Uvinul A Plus would hold its shape better across those hours.';
    }
    if (yours && sh.peak > 0) {
      msg += ' In the hours you picked it is working at about ' + Math.round(yours / sh.peak * 100) + '% of its best.';
    }
    $('bt-verdict').textContent = msg;

    // label facts, phrased additively
    var F = window.Filters;
    var picked = S.bottle.map(function (x) { return F.BY_KEY[x]; }).filter(Boolean);
    var uva = picked.filter(function (f) { return f.uva; });
    var vis = picked.filter(function (f) { return f.visible; });
    var hasAvo = S.bottle.indexOf('avobenzone') >= 0;
    var partners = picked.filter(function (f) { return f.stab; });
    var rows = [];
    rows.push(['Blocks UVA', uva.length
      ? uva.map(function (f) { return f.name; }).join(', ') + ', the ones working on tanning and dark spots.'
      : 'This one is built for sunburn protection. For tanning or dark spots, look for zinc oxide, Tinosorb or Uvinul A Plus on a label.',
      uva.length ? uva.length + (uva.length === 1 ? ' filter' : ' filters') : 'UVB focus']);
    if (hasAvo) rows.push(['Avobenzone', partners.length
      ? 'Paired with ' + partners.map(function (f) { return f.name; }).join(', ') + ', which keeps it stable in sunlight.'
      : 'No usual stabilising partner is listed. Formulas can stabilise it in other ways, but if you are out for long stretches it is worth reapplying a little sooner.',
      partners.length ? 'stabilised' : 'reapply sooner']);
    if (vis.length) rows.push(['Visible light', 'Contains iron oxides, so it also covers the visible light that drives melasma, which a clear formula cannot do.', 'tinted']);
    $('bt-flags').innerHTML = rows.map(function (r) {
      return '<div class="row"><span class="row__label">' + r[0] + '</span><p class="row__desc">' + r[1] +
             '</p><span class="row__value">' + r[2] + '</span></div>';
    }).join('');
    $('bt-badge').textContent = 'Peak ' + Math.round(sh.peak) + ' · steadiness ' + pct + '%';
  }


  /* --- product lookup: label facts only, never a modelled verdict -------- */

  function paintProductResults(q) {
    if (!window.Products) return;
    var list = window.Products.search(q);
    if (!q) { $('bt-results').innerHTML = ''; return; }
    $('bt-results').innerHTML = list.length
      ? list.map(function (p, i) {
          return '<button class="hit" type="button" data-i="' + window.Products.PRODUCTS.indexOf(p) + '">' +
            '<span class="hit__brand">' + p.brand + '</span><span class="hit__name">' + p.name + '</span></button>';
        }).join('')
      : '<p class="apanel__note" style="margin:10px 0 0">Not in the list yet. Tick the filters from your own label below. That is how the list grows.</p>';
  }

  function showProduct(p) {
    var f = window.Products.factsFor(p);
    if (!f) return;
    var LBL = { severe: 'Problem', warn: 'Watch', good: 'Good' };
    var chips = function (arr, cls) {
      return arr.map(function (x) { return '<span class="tag ' + cls + '">' + x.name + '</span>'; }).join('');
    };
    $('bt-product').innerHTML =
      '<div class="prod">' +
        '<div class="prod__head"><span class="prod__brand">' + p.brand + '</span>' +
        '<span class="prod__name">' + p.name + '</span></div>' +
        '<p class="prod__filters"><b>Blocks UVA:</b> ' + (f.uva.length ? chips(f.uva, 'tag--uva') : '<span class="tag">none</span>') + '</p>' +
        '<p class="prod__filters"><b>UVB only:</b> ' + (f.uvb.length ? chips(f.uvb, '') : '<span class="tag">none</span>') + '</p>' +
        (f.visible.length ? '<p class="prod__filters"><b>Visible light:</b> ' + chips(f.visible, 'tag--uva') + '</p>' : '') +
        '<div class="rows">' + f.notes.map(function (n) {
          return '<div class="row"><span class="row__label">' + LBL[n.level] + '</span>' +
            '<p class="row__desc">' + n.text + '</p><span class="row__value">' +
            (n.level === 'severe' ? '!' : n.level === 'good' ? '✓' : '·') + '</span></div>';
        }).join('') + '</div>' +
        '<p class="prod__src">Filters as published on the label · <a href="' + p.source + '" target="_blank" rel="noopener">source</a> · read ' + p.checked +
        ' · no SPF is modelled for a named product, because the model is not good enough to carry that claim</p>' +
      '</div>';
  }


  function paintMine() {
    if (!window.Products) return;
    var mine = window.Products.userProducts();
    $('ap-mine').innerHTML = mine.length ? mine.map(function (p, i) {
      return '<div class="row"><span class="row__label">Mine</span>' +
        '<p class="row__desc"><b>' + p.brand + '</b>. ' + p.name + '. ' + p.filters.length +
        ' filters listed. <a href="' + p.source + '" target="_blank" rel="noopener">source</a>, read ' + p.checked + '.</p>' +
        '<span class="row__value"><button class="btn" data-rm="' + i + '" style="padding:6px 10px">remove</button></span></div>';
    }).join('') : '';
  }

  function wireAddProduct() {
    if (!window.Products) return;
    $('ap-add').addEventListener('click', function () {
      var brand = $('ap-brand').value.trim(), name = $('ap-name').value.trim(), src = $('ap-src').value.trim();
      if (!brand || !name) { $('bt-badge').textContent = 'Needs a brand and a product name'; return; }
      if (!/^https?:\/\//i.test(src)) { $('bt-badge').textContent = 'Needs a link to where the ingredients are published'; return; }
      if (!S.bottle.length) { $('bt-badge').textContent = 'Tick the filters from the label first'; return; }
      window.Products.addProduct({
        brand: brand, name: name, filters: S.bottle.slice(),
        source: src, checked: new Date().toISOString().slice(0, 10)
      });
      $('ap-brand').value = ''; $('ap-name').value = ''; $('ap-src').value = '';
      $('bt-badge').textContent = 'Added. It is now searchable above';
      paintMine();
    });
    $('ap-mine').addEventListener('click', function (e) {
      var b = e.target.closest('[data-rm]'); if (!b) return;
      window.Products.removeProduct(+b.dataset.rm); paintMine();
    });
    $('ap-copy').addEventListener('click', function () {
      var txt = JSON.stringify(window.Products.userProducts(), null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      $('bt-badge').textContent = 'Copied ' + window.Products.userProducts().length + ' entries';
    });
    paintMine();
  }

  function paintAll() { paintMelanin(); paintNow(); paintMatrix(); paintDose(); buildPlan(); paintProtection(); paintWeek(); paintAir(); paintLedger(); paintCommute(); paintPigment(); paintBottle(); }

  function chipGroup(id, onPick) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      $(id).querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      onPick(b);
    });
  }

  /* The pressed chip is hard-coded in the markup, so a saved choice came back
     with the model using it and the buttons still showing the default. The
     pigment panel would read "through glass" with OUTDOORS lit. Match the
     stored value back onto the chips at startup. */
  function syncChips(id, attr, want) {
    var g = $(id); if (!g) return;
    var chips = g.querySelectorAll('.chip'), hit = null;
    chips.forEach(function (c) { if (c.dataset[attr] === String(want)) hit = c; });
    if (!hit) return;
    chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === hit)); });
  }

  function init() {
    buildTones();
    paintHowTo();

    $('height').value = S.height; $('weight').value = S.weight;
    $('spf').value = String(S.spf); $('density').value = S.density;

    var opts = '';
    for (var h = 4; h <= 21; h++) opts += '<option value="' + h + '">' + hhmm(h) + '</option>';
    $('plan-start').innerHTML = opts; $('plan-end').innerHTML = opts;
    $('plan-start').value = S.planStart; $('plan-end').value = S.planEnd;

    $('city').innerHTML = CITIES.map(function (c, i) {
      return '<option value="' + i + '"' + (c[0] === S.place ? ' selected' : '') + '>' + c[0] + '</option>';
    }).join('');
    $('city').addEventListener('change', function () {
      var c = CITIES[+this.value]; if (!c) return;
      S.place = c[0]; S.lat = c[1]; S.lon = c[2]; save(); refresh(); loadIndia();
    });

    ['height', 'weight', 'spf'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        S.height = clamp(+$('height').value || 170, 80, 230);
        S.weight = clamp(+$('weight').value || 65, 20, 200);
        S.spf = +$('spf').value; save(); paintAll();
      });
    });
    $('density').addEventListener('input', function () { S.density = +this.value; save(); paintDose(); buildPlan(); });
    ['plan-start', 'plan-end'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        S.planStart = +$('plan-start').value; S.planEnd = +$('plan-end').value; save(); buildPlan();
      });
    });

    chipGroup('exposure', function (b) { S.frac = +b.dataset.frac; save(); paintDose(); buildPlan(); });
    chipGroup('plan-act', function (b) { S.planLam = +b.dataset.lam; save(); buildPlan(); });
    chipGroup('activity', function (b) {
      tick();
      S.inShade = b.dataset.shade === '1';
      if (S.appliedAt) { S.appliedSPF = currentSPF(); S.appliedAt = Date.now(); }  // film loss is one-way
      S.lambda = +b.dataset.lam; save(); paintProtection();
    });

    syncChips('exposure', 'frac', S.frac);
    syncChips('plan-act', 'lam', S.planLam);
    syncChips('activity', 'lam', S.lambda);
    syncChips('pg-where', 'g', S.pgGlass);
    syncChips('bt-when', 'h', S.outHours.join(','));

    $('apply').addEventListener('click', function () {
      tick();
      S.appliedAt = Date.now();
      S.appliedSPF = window.UV.effectiveSPF(S.spf, 2 * (S.density / 100));
      S.lastTick = Date.now(); save(); paintProtection();
    });
    $('towel').addEventListener('click', function () {
      if (!S.appliedAt) return;
      tick();
      S.appliedSPF = 1 + (currentSPF() - 1) * 0.35;   // a towel is instant, not gradual
      S.appliedAt = Date.now(); save(); paintProtection();
    });
    $('reset').addEventListener('click', function () {
      S.appliedAt = null; S.appliedSPF = null; S.doseJ = 0; S.lastTick = null; save(); paintProtection();
    });
    $('locate').addEventListener('click', function () {
      if (!navigator.geolocation) { $('src-badge').textContent = 'No geolocation here'; return; }
      $('src-badge').textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(function (p) {
        S.lat = +p.coords.latitude.toFixed(4); S.lon = +p.coords.longitude.toFixed(4);
        S.place = 'your location'; save(); refresh();
      }, function () { $('src-badge').textContent = 'Location refused. Pick a city instead'; },
      { timeout: 8000, maximumAge: 600000 });
    });


    $('cm-bearing').innerHTML = BEARINGS.map(function (b) {
      return '<option value="' + b[1] + '"' + (b[1] === S.cmBearing ? ' selected' : '') + '>' + b[0] + '</option>';
    }).join('');
    $('age').value = S.age; $('who').value = S.who; $('child-age').value = S.childAge;
    $('cm-mode').value = S.cmMode; $('cm-mins').value = S.cmMins; $('cm-years').value = S.cmYears;
    $('child-wrap').style.display = S.who === 'child' ? '' : 'none';

    ['age', 'who', 'child-age'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        S.age = clamp(+$('age').value || 25, 1, 100);
        S.who = $('who').value;
        S.childAge = clamp(+$('child-age').value || 8, 1, 17);
        $('child-wrap').style.display = S.who === 'child' ? '' : 'none';
        save(); paintLedger();
      });
    });
    ['cm-mode', 'cm-bearing', 'cm-mins', 'cm-years'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        S.cmMode = $('cm-mode').value;
        S.cmBearing = +$('cm-bearing').value;
        S.cmMins = clamp(+$('cm-mins').value || 40, 5, 240);
        S.cmYears = clamp(+$('cm-years').value || 3, 1, 40);
        save(); paintCommute();
      });
    });
    buildBottleList();
    wireAddProduct();
    chipGroup('bt-when', function (b) {
      S.outHours = b.dataset.h.split(',').map(Number); save(); paintBottle();
    });
    if (window.Products) {
      $('bt-search').addEventListener('input', function () { paintProductResults(this.value); });
      $('bt-results').addEventListener('click', function (e) {
        var b = e.target.closest('.hit'); if (!b) return;
        var prod = window.Products.all()[+b.dataset.i];
        showProduct(prod);
        S.bottle = prod.filters.slice(); save();
        buildBottleList(); paintBottle();
        $('bt-results').innerHTML = '';
      });
    }
    chipGroup('pg-where', function (b) { S.pgGlass = +b.dataset.g; save(); paintPigment(); });
    paintAll();
    refresh();
    loadIndia();
    loadAirReference();

    setInterval(function () { tick(); paintProtection(); }, 10000);
    setInterval(refresh, 600000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); paintProtection(); } });
  }

  init();
})();
