/* ===========================================================================
   UMBRA / page.js

   Motion models, kept strictly apart:
     POSITION-BOUND  the travelling sun and the wordmark spread. They read
                     scrollY every frame and therefore play in reverse.
     ONE-SHOT        section reveals and the curve draw. They fire once on
                     entry and must never un-reveal.

   Every motion rule is scoped to .motion-ok, added below only after checking
   that reduced motion has not been requested.
   =========================================================================== */

(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) document.documentElement.classList.add('motion-ok');

  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  var easeInOut = function (t) {
    return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  /* =====================================================================
     The engraved sun. Alternating ray lengths so it reads as a drawn
     object rather than a glyph.
     ===================================================================== */
  (function buildSun() {
    var g = document.getElementById('rays');
    if (!g) return;
    var out = '';
    for (var i = 0; i < 20; i++) {
      var a = (i / 20) * Math.PI * 2;
      var r0 = 60;
      var r1 = i % 2 ? 72 : 86;
      out += '<line x1="' + (100 + Math.cos(a) * r0).toFixed(2) +
             '" y1="' + (100 + Math.sin(a) * r0).toFixed(2) +
             '" x2="' + (100 + Math.cos(a) * r1).toFixed(2) +
             '" y2="' + (100 + Math.sin(a) * r1).toFixed(2) + '"/>';
    }
    g.innerHTML = out;
  })();

  /* =====================================================================
     THE TRAVELLING PRODUCT
     One sun, fixed, moved along a keyframed arc as the page scrolls. x and
     y are percentages of the viewport so the path holds at any size. It
     rises out of the hero, crosses the argument, and sets behind the
     demonstration, which is the last section that needs it.
     ===================================================================== */
  var STOPS = [
    { t: 0.00, x: 76, y: 64, rot:  -8, s: 1.00, o: 1.00 },
    { t: 0.22, x: 83, y: 30, rot:  26, s: 0.92, o: 1.00 },
    { t: 0.46, x: 55, y: 13, rot:  74, s: 0.78, o: 0.92 },
    { t: 0.72, x: 22, y: 30, rot: 124, s: 0.62, o: 0.50 },
    { t: 1.00, x:  7, y: 70, rot: 176, s: 0.48, o: 0.00 }
  ];

  function sampleStops(p) {
    if (p <= 0) return STOPS[0];
    if (p >= 1) return STOPS[STOPS.length - 1];
    for (var i = 0; i < STOPS.length - 1; i++) {
      var a = STOPS[i], b = STOPS[i + 1];
      if (p >= a.t && p <= b.t) {
        var u = easeInOut((p - a.t) / (b.t - a.t));
        return {
          x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u),
          rot: lerp(a.rot, b.rot, u),
          s: lerp(a.s, b.s, u), o: lerp(a.o, b.o, u)
        };
      }
    }
    return STOPS[STOPS.length - 1];
  }

  var traveller = document.getElementById('traveller');
  var demo = document.getElementById('demonstration');
  var hero = document.querySelector('.hero');
  var wordmarks = Array.prototype.slice.call(document.querySelectorAll('.wordmark'));
  var travelEnd = 1;

  function measure() {
    travelEnd = Math.max(1, demo.offsetTop + demo.offsetHeight - window.innerHeight * 0.6);
  }

  /* --- the wordmark, letter by letter ---------------------------------- */
  wordmarks.forEach(function (w) {
    var letters = (w.dataset.word || '').split('');
    w.innerHTML = letters.map(function (ch) {
      return '<span><i>' + ch + '</i></span>';
    }).join('');
  });

  function paintWordmarks(scrollY) {
    var heroH = hero ? hero.offsetHeight : window.innerHeight;
    var p = clamp01(scrollY / heroH);
    wordmarks.forEach(function (w) {
      var glyphs = w.querySelectorAll('i');
      var mid = (glyphs.length - 1) / 2;
      for (var i = 0; i < glyphs.length; i++) {
        var away = i - mid;                       // spread outward from centre
        var dx = away * p * 26;
        var dy = p * 22;                          // and sink as it opens
        glyphs[i].style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      }
    });
  }

  function frame() {
    var y = window.scrollY || window.pageYOffset;

    if (traveller) {
      var k = sampleStops(clamp01(y / travelEnd));
      // translate(-50%,-50%) after the pixel move centres the sun on the
      // keyframed point at any size, with no margin bookkeeping
      traveller.style.transform =
        'translate(' + (k.x / 100 * window.innerWidth).toFixed(1) + 'px,' +
                       (k.y / 100 * window.innerHeight).toFixed(1) + 'px)' +
        ' translate(-50%,-50%)' +
        ' rotate(' + k.rot.toFixed(1) + 'deg)' +
        ' scale(' + k.s.toFixed(3) + ')';
      traveller.style.opacity = k.o.toFixed(3);
      // at zero opacity it must not be able to intercept anything
      traveller.style.visibility = k.o < 0.01 ? 'hidden' : 'visible';
    }

    paintWordmarks(y);
    ticking = false;
  }

  var ticking = false;
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }

  if (!reduced) {
    measure();
    frame();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { measure(); frame(); });
  }

  /* --- the wordmark lights on load, not on intersection: it is on screen
         from the first paint ------------------------------------------- */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      wordmarks.forEach(function (w) { w.classList.add('is-lit'); });
    });
  });

  /* =====================================================================
     ONE-SHOT REVEALS
     ===================================================================== */
  var drawn = false;

  if (!reduced && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

    var panelIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !drawn) { drawn = true; render(current, true); panelIO.disconnect(); }
      });
    }, { threshold: 0.25 });
    var panel = document.querySelector('.panel');
    if (panel) panelIO.observe(panel);
  }

  /* =====================================================================
     THE DEMONSTRATION
     The panel shows the product's own output: an index curve for one day,
     computed here, in this browser, by uv-engine.js. The variant picker is
     wired to the SAME path element, so choosing a sky redraws that path and
     rewrites the three facts beneath it together.
     ===================================================================== */

  var IST = 330;              // minutes east of UTC
  var DAY = new Date(Date.UTC(2025, 5, 21));

  var VARIANTS = [
    {
      site: 'Goa · 15.30°N 74.12°E', cond: 'Clear sky · sand albedo 0.20',
      lat: 15.30, lon: 74.12, tz: IST,
      opts: { albedo: 'sand', cloud: 'clear' },
      note: 'The clear-sky model is a ceiling: it carries no aerosol term, so it reads above a published forecast, which folds in cloud and haze climatology. Closing that residual against archive data is the whole of Phase 00.'
    },
    {
      site: 'Goa · 15.30°N 74.12°E', cond: 'Broken cloud · factor 1.25',
      lat: 15.30, lon: 74.12, tz: IST,
      opts: { albedo: 'sand', cloud: 'broken' },
      note: 'Broken cloud sits ABOVE the clear-sky curve, not below it. With the sun disc unobscured, bright cloud edges scatter extra flux onto you. "It is cloudy, so I am fine" is not merely wrong here. It is inverted.'
    },
    {
      site: 'Goa · 15.30°N 74.12°E', cond: 'Beach umbrella · sky dome only',
      lat: 15.30, lon: 74.12, tz: IST,
      opts: { albedo: 'sand', cloud: 'clear', shade: { skyFraction: 0.55 } },
      note: 'An umbrella blocks the sun disc and about half the sky. Because erythemal ultraviolet is 40–60% diffuse, what is left is not a little. It is most of a burn. Across the day the model prices this shade at SPF 4.2.'
    },
    {
      site: 'Gulmarg · 34.05°N 74.38°E · 2650 m', cond: 'Fresh snow · albedo 0.80',
      lat: 34.05, lon: 74.38, tz: IST,
      opts: { albedo: 'snow', cloud: 'clear', altitude: 2650 },
      note: 'Nineteen degrees further from the sun than Goa, and still the heavier day: elevation adds 8% per kilometre and fresh snow returns four fifths of what lands on it. Latitude is a weak predictor of dose.'
    }
  ];

  var PLOT = { x0: 58, x1: 982, y0: 34, y1: 330, hourA: 4, hourB: 20, uvMax: 20 };

  function px(hour) {
    return PLOT.x0 + (hour - PLOT.hourA) / (PLOT.hourB - PLOT.hourA) * (PLOT.x1 - PLOT.x0);
  }
  function py(uvi) {
    return PLOT.y1 - clamp01(uvi / PLOT.uvMax) * (PLOT.y1 - PLOT.y0);
  }

  /* Sample a full LOCAL day so hours before 06:00 UTC-shifted still resolve. */
  function series(v, stepMin) {
    stepMin = stepMin || 10;
    var base = Date.UTC(DAY.getUTCFullYear(), DAY.getUTCMonth(), DAY.getUTCDate());
    var out = [];
    for (var m = 0; m <= 1440; m += stepMin) {
      var d = new Date(base + (m - v.tz) * 60000);
      out.push({ hour: m / 60, uvi: window.UV.uvIndex(d, v.lat, v.lon, v.opts).uvi });
    }
    return out;
  }

  function buildGrid() {
    var g = document.getElementById('plot-grid');
    if (!g) return;
    var s = '';
    for (var u = 0; u <= PLOT.uvMax; u += 5) {
      var y = py(u);
      s += '<line class="' + (u === 0 ? 'axis' : 'grid') + '" x1="' + PLOT.x0 + '" y1="' + y.toFixed(1) +
           '" x2="' + PLOT.x1 + '" y2="' + y.toFixed(1) + '"/>';
      s += '<text class="tick" x="' + (PLOT.x0 - 14) + '" y="' + (y + 5).toFixed(1) + '" text-anchor="end">' + u + '</text>';
    }
    for (var h = 6; h <= 18; h += 2) {
      s += '<line class="grid" x1="' + px(h).toFixed(1) + '" y1="' + PLOT.y0 +
           '" x2="' + px(h).toFixed(1) + '" y2="' + PLOT.y1 + '"/>';
      s += '<text class="tick" x="' + px(h).toFixed(1) + '" y="' + (PLOT.y1 + 26) + '" text-anchor="middle">' +
           (h < 10 ? '0' + h : h) + ':00</text>';
    }
    // WHO "extreme" threshold, as a dashed rule
    s += '<line class="burn" x1="' + PLOT.x0 + '" y1="' + py(11).toFixed(1) +
         '" x2="' + PLOT.x1 + '" y2="' + py(11).toFixed(1) + '"/>';
    s += '<text class="burnlbl" x="' + (PLOT.x1 - 4) + '" y="' + (py(11) - 9).toFixed(1) +
         '" text-anchor="end">EXTREME · 11</text>';
    s += '<text class="tick" x="' + PLOT.x0 + '" y="16" text-anchor="start">UVI</text>';
    g.innerHTML = s;
  }

  var curve = document.getElementById('curve');
  var current = 0;
  var settleTimer = null;

  /* The dash pair is scaffolding for the entry draw only. Once the draw has
     had its two seconds, tear it down unconditionally, because otherwise a fast
     run of variant clicks, or a tab backgrounded mid-transition, can strand
     the curve at a non-zero offset and leave it permanently half-drawn. */
  function settle() {
    curve.style.transition = 'none';
    curve.style.strokeDasharray = 'none';
    curve.style.strokeDashoffset = '0';
  }

  function render(idx, animate) {
    var v = VARIANTS[idx];
    var pts = series(v, 10);

    // path
    var d = '', started = false;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].hour < PLOT.hourA || pts[i].hour > PLOT.hourB) continue;
      d += (started ? 'L' : 'M') + px(pts[i].hour).toFixed(1) + ' ' + py(pts[i].uvi).toFixed(1) + ' ';
      started = true;
    }

    // facts, from the same samples the path was drawn from
    var peak = 0;
    var joules = 0;
    for (var j = 0; j < pts.length; j++) {
      if (pts[j].uvi > peak) peak = pts[j].uvi;
      joules += 0.025 * pts[j].uvi * 10 * 60;
    }
    var sed = joules / 100;
    var med = window.UV.minutesToMED(peak, 'III');

    curve.setAttribute('d', d.trim());
    // heavier day, heavier line
    curve.style.strokeWidth = (1.5 + clamp01(sed / 110) * 1.5).toFixed(2);

    if (settleTimer) clearTimeout(settleTimer);

    if (animate) {
      var len = curve.getTotalLength();
      curve.style.transition = 'none';
      curve.style.strokeDasharray = len + ' ' + len;
      curve.style.strokeDashoffset = len;
      settleTimer = setTimeout(settle, 2100);
      // Two frames, not a forced reflow: the undrawn state has to be COMMITTED
      // before the offset changes, or the browser coalesces both writes and
      // the curve simply never draws.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          curve.style.transition = 'stroke-dashoffset 2s cubic-bezier(.33,.1,.25,1)';
          curve.style.strokeDashoffset = '0';
        });
      });
    } else {
      settle();
    }

    document.getElementById('cap-site').textContent = v.site;
    document.getElementById('cap-cond').textContent = v.cond;
    document.getElementById('p-note').textContent = v.note;
    document.getElementById('f-peak').textContent = peak.toFixed(1);
    document.getElementById('f-med').innerHTML = Math.round(med) + '<small>min</small>';
    document.getElementById('f-sed').innerHTML = sed.toFixed(1) + '<small>SED</small>';
  }

  buildGrid();
  render(0, false);
  if (reduced) drawn = true;      // no entry animation to wait for

  document.querySelectorAll('.variant').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idx = +btn.dataset.variant;
      if (idx === current) return;
      current = idx;
      drawn = true;               // a deliberate pick outranks the entry draw
      document.querySelectorAll('.variant').forEach(function (b) {
        b.setAttribute('aria-pressed', String(+b.dataset.variant === idx));
      });
      render(idx, !reduced);
    });
  });

  /* =====================================================================
     Verify the hero actually travels. Measured, not assumed.
     ===================================================================== */
  window.UMBRA_verifyTravel = function () {
    if (reduced) return 'reduced motion: traveller is hidden by design';
    var a = sampleStops(clamp01(0 / travelEnd));
    var b = sampleStops(clamp01(700 / travelEnd));
    var dx = (b.x - a.x) / 100 * window.innerWidth;
    var dy = (b.y - a.y) / 100 * window.innerHeight;
    var dist = Math.hypot(dx, dy);
    var msg = 'traveller moves ' + dist.toFixed(0) + 'px over the first 700px of scroll' +
              ' (dx ' + dx.toFixed(0) + ', dy ' + dy.toFixed(0) + '): ' +
              (dist > 100 ? 'PASS' : 'FAIL, needs > 100px');
    console.log(msg);
    return msg;
  };

  window.addEventListener('load', function () {
    measure();
    if (!reduced) frame();
    if (window.UV && window.UV.selfTest) window.UV.selfTest();
    window.UMBRA_verifyTravel();
  });
})();
