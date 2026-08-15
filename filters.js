/* ===========================================================================
   UMBRA / filters.js

   THE BOTTLE AUDIT. Read the back, not the front.

   The number on the front of a sunscreen is an SPF, and SPF is a SUNBURN
   measurement. The thing most people actually bought the bottle for, namely tanning,
   dark spots, melasma and ageing, is driven by UVA, and nothing on the front of
   the bottle tells you whether it is handled.

   The back does. Every approved filter has a published absorbance curve, so
   from the ingredient list alone you can compute what a formulation is
   physically capable of. No lab, no photo, no protocol.

   WHAT IS ROBUST HERE
     · does this bottle contain ANY UVA filter        -> pure lookup, binary
     · is avobenzone present with nothing to stabilise it -> pure lookup
     · critical wavelength / broad-spectrum pass-fail -> depends on the SHAPE
       of the curve, which survives not knowing exact concentrations

   WHAT IS APPROXIMATE
     · absolute SPF and UVA-PF. Real film thickness, spreading and vehicle
       dominate. Treat as +-30-50% and never present as a certified figure.

   WHAT THIS IS NOT
     A laboratory. It reports what a set of filters CAN do, never that a brand
     is lying. That distinction is the whole ethical footing of the feature.
   =========================================================================== */

(function (global) {
  'use strict';

  /* peaks: [lambda_max nm, E(1%,1cm) at that peak, gaussian width nm]
     typ:   typical use concentration when the label does not state one       */
  var FILTERS = [
    // ---- UVA ----------------------------------------------------------
    { k: 'avobenzone', inci: 'Butyl Methoxydibenzoylmethane', name: 'Avobenzone',
      peaks: [[357, 1150, 26]], uva: true, typ: 3, max: 3,
      note: 'The most common UVA filter, and the least stable. Needs a partner.' },
    { k: 'zincoxide', inci: 'Zinc Oxide', name: 'Zinc oxide',
      peaks: [[330, 260, 70]], uva: true, typ: 18, max: 25, mineral: true,
      note: 'Modest SPF for its weight, but the most even UVA cover of any filter.' },
    { k: 'uvinulA', inci: 'Diethylamino Hydroxybenzoyl Hexyl Benzoate', name: 'Uvinul A Plus',
      peaks: [[354, 800, 24]], uva: true, typ: 5, max: 10,
      note: 'Photostable UVA filter. Not permitted in the US, common in Asia and the EU.' },
    { k: 'tinosorbS', inci: 'Bis-Ethylhexyloxyphenol Methoxyphenyl Triazine', name: 'Tinosorb S',
      peaks: [[310, 750, 22], [343, 700, 26]], uva: true, typ: 4, max: 10, stab: true,
      note: 'Broad, photostable, and stabilises avobenzone as well.' },
    { k: 'tinosorbM', inci: 'Methylene Bis-Benzotriazolyl Tetramethylbutylphenol', name: 'Tinosorb M',
      peaks: [[305, 600, 24], [345, 620, 30]], uva: true, typ: 5, max: 10, stab: true,
      note: 'Broad-spectrum, works by absorbing and scattering.' },
    { k: 'mexorylSX', inci: 'Terephthalylidene Dicamphor Sulfonic Acid', name: 'Mexoryl SX',
      peaks: [[345, 800, 22]], uva: true, typ: 3, max: 10,
      note: 'Photostable UVA filter, largely exclusive to one manufacturer.' },
    { k: 'oxybenzone', inci: 'Benzophenone-3', name: 'Oxybenzone',
      peaks: [[288, 700, 20], [325, 400, 24]], uva: true, typ: 4, max: 6,
      note: 'Reaches into UVA but weakly, and absorbs readily through skin.' },

    { k: 'trisbiphenyl', inci: 'Tris-Biphenyl Triazine', name: 'Tinosorb A2B',
      peaks: [[310, 900, 22], [340, 500, 24]], uva: true, typ: 3, max: 10, stab: true,
      note: 'Newer broad filter, strong through UVB and into UVA-II.' },
    { k: 'mexorylXL', inci: 'Drometrizole Trisiloxane', name: 'Mexoryl XL',
      peaks: [[303, 500, 20], [344, 450, 24]], uva: true, typ: 3, max: 15,
      note: 'Photostable broad filter; pairs with Mexoryl SX.' },

    // ---- UVB ONLY -----------------------------------------------------
    { k: 'octinoxate', inci: 'Ethylhexyl Methoxycinnamate', name: 'Octinoxate',
      peaks: [[311, 880, 20]], uva: false, typ: 7.5, max: 10,
      note: 'Strong UVB filter. Degrades in sun and destabilises avobenzone.' },
    { k: 'octisalate', inci: 'Ethylhexyl Salicylate', name: 'Octisalate',
      peaks: [[307, 180, 20]], uva: false, typ: 5, max: 5,
      note: 'Weak on its own; mostly a solvent for other filters.' },
    { k: 'homosalate', inci: 'Homosalate', name: 'Homosalate',
      peaks: [[306, 150, 20]], uva: false, typ: 10, max: 15,
      note: 'Weak UVB filter used in bulk to dissolve the others.' },
    { k: 'octocrylene', inci: 'Octocrylene', name: 'Octocrylene',
      peaks: [[303, 350, 22]], uva: false, typ: 7, max: 10, stab: true,
      note: 'Moderate UVB filter whose real job is holding avobenzone together.' },
    { k: 'ensulizole', inci: 'Phenylbenzimidazole Sulfonic Acid', name: 'Ensulizole',
      peaks: [[302, 900, 18]], uva: false, typ: 3, max: 4,
      note: 'Water-soluble UVB filter, gives a light feel.' },
    { k: 'titanium', inci: 'Titanium Dioxide', name: 'Titanium dioxide',
      peaks: [[300, 300, 45]], uva: false, typ: 8, max: 25, mineral: true,
      note: 'Mineral, but weighted to UVB. Needs zinc alongside for UVA.' },

    { k: 'uvinulT150', inci: 'Ethylhexyl Triazone', name: 'Uvinul T 150',
      peaks: [[314, 1500, 18]], uva: false, typ: 3, max: 5,
      note: 'The most efficient UVB filter by weight. UVB only.' },
    { k: 'uvasorbHEB', inci: 'Diethylhexyl Butamido Triazone', name: 'Uvasorb HEB',
      peaks: [[312, 1600, 18]], uva: false, typ: 3, max: 10,
      note: 'Very strong, very photostable UVB filter.' },
    { k: 'polysil15', inci: 'Polysilicone-15', name: 'Parsol SLX',
      peaks: [[312, 300, 20]], uva: false, typ: 3, max: 10,
      note: 'Film-forming UVB filter, helps the others spread evenly.' },

    // ---- VISIBLE LIGHT ------------------------------------------------
    { k: 'ironoxide', inci: 'Iron Oxides (CI 77491 / 77492 / 77499)', name: 'Iron oxides',
      peaks: [], uva: false, typ: 3, max: 5, visible: true,
      note: 'The tint. The only common ingredient that blocks visible light, which drives melasma.' }
  ];

  var BY_KEY = {};
  FILTERS.forEach(function (f) { BY_KEY[f.k] = f; });

  function E1(f, l) {
    var s = 0;
    for (var i = 0; i < f.peaks.length; i++) {
      var p = f.peaks[i];
      s += p[1] * Math.exp(-0.5 * Math.pow((l - p[0]) / p[2], 2));
    }
    return s;
  }

  /* CIE erythema action spectrum: what SPF is built on (sunburn). */
  function ery(l) {
    return l <= 298 ? 1
         : l <= 328 ? Math.pow(10, 0.094 * (298 - l))
         : Math.pow(10, 0.015 * (139 - l));
  }
  /* Persistent pigment darkening: what PA and PPD ratings are built on. */
  function ppd(l) { return l < 320 ? 1 : Math.pow(10, 0.0125 * (320 - l)); }

  /* Ground-level solar spectrum, from the same atmosphere the rest of the
     app uses. Falls back to a fixed table if shade-meter.js is absent. */
  var GROUND = null;
  function ground() {
    if (GROUND) return GROUND;
    var E0t = [[290, .48], [300, .51], [310, .69], [320, .83], [330, 1.05], [340, .98],
               [350, 1.05], [360, 1.05], [370, 1.15], [380, 1.12], [390, 1.10], [400, 1.45]];
    function E0(l) {
      for (var i = 0; i < E0t.length - 1; i++) {
        if (l <= E0t[i + 1][0]) {
          return E0t[i][1] + (E0t[i + 1][1] - E0t[i][1]) * (l - E0t[i][0]) / (E0t[i + 1][0] - E0t[i][0]);
        }
      }
      return 1.4;
    }
    GROUND = {};
    for (var l = 290; l <= 400; l++) {
      var t = 1;
      if (global.ShadeMeter && global.ShadeMeter.irradiance) {
        var r = global.ShadeMeter.irradiance(l / 1000, 0.9, 0.4, 1.0, 300);
        t = r.direct + r.diffuse;
      }
      GROUND[l] = E0(l) * t;
    }
    return GROUND;
  }

  /* Film constant, solved once so a 3% avobenzone + octocrylene formula, a
     real and extremely common SPF 50 product, lands on 50. */
  var FILM = null;
  function film() {
    if (FILM) return FILM;
    var ref = { octinoxate: 6, homosalate: 8, avobenzone: 3, octocrylene: 8 };
    var lo = 1e-7, hi = 1e-2;
    for (var i = 0; i < 100; i++) {
      var m = (lo + hi) / 2;
      if (compute(ref, m).spf < 50) lo = m; else hi = m;
    }
    FILM = (lo + hi) / 2;
    return FILM;
  }

  function compute(mix, S) {
    var G = ground(), n1 = 0, d1 = 0, n2 = 0, d2 = 0, auc = 0, cum = [];
    for (var l = 290; l <= 400; l++) {
      var sum = 0;
      for (var k in mix) if (BY_KEY[k]) sum += mix[k] * E1(BY_KEY[k], l);
      var A = S * sum, T = Math.pow(10, -A), g = G[l];
      n1 += g * ery(l); d1 += g * ery(l) * T;
      n2 += g * ppd(l); d2 += g * ppd(l) * T;
      auc += A; cum.push([l, auc]);
    }
    var crit = 400;
    for (var i = 0; i < cum.length; i++) if (cum[i][1] >= 0.9 * auc) { crit = cum[i][0]; break; }
    return { spf: d1 > 0 ? n1 / d1 : 1, uvapf: d2 > 0 ? n2 / d2 : 1, critical: crit };
  }

  /* keys: array of filter keys the user ticked.
     conc: optional { key: percent } if the label states them.               */
  function audit(keys, conc) {
    var mix = {}, i, f;
    for (i = 0; i < keys.length; i++) {
      f = BY_KEY[keys[i]];
      if (!f || f.visible) continue;                 // iron oxides absorb visible, not UV
      mix[f.k] = (conc && conc[f.k]) || f.typ;
    }

    var picked = keys.map(function (k) { return BY_KEY[k]; }).filter(Boolean);
    var uvaFilters = picked.filter(function (f) { return f.uva; });
    var hasAvo = keys.indexOf('avobenzone') >= 0;
    var hasStab = picked.some(function (f) { return f.stab; });
    var hasOctinoxate = keys.indexOf('octinoxate') >= 0;
    var hasVisible = picked.some(function (f) { return f.visible; });

    if (!Object.keys(mix).length) {
      return { ok: false, reason: 'No ultraviolet filters ticked. Look for a heading like "Active Ingredients" on the back.' };
    }

    var r = compute(mix, film());
    var ratio = r.uvapf / r.spf;

    var flags = [];
    if (!uvaFilters.length) {
      flags.push({ level: 'severe', text: 'No UVA filter of any kind. Against sunburn this works. Against tanning, dark spots and ageing it is doing close to nothing.' });
    }
    if (hasAvo && !hasStab) {
      flags.push({ level: 'severe', text: 'Avobenzone is listed with none of the usual stabilising partners (octocrylene, Tinosorb). Some formulas stabilise it by other means that a label will not reveal, but on the list alone there is nothing holding it together, and unprotected avobenzone loses a large part of its UVA protection within the first hour of sun.' });
    }
    if (hasAvo && hasOctinoxate) {
      flags.push({ level: 'severe', text: 'Avobenzone and octinoxate appear together. Octinoxate is known to accelerate avobenzone\'s breakdown, so this pairing tends to lose UVA protection faster than either would alone.' });
    }
    if (r.critical < 370) {
      flags.push({ level: 'severe', text: 'Critical wavelength ' + r.critical + ' nm. Broad-spectrum requires 370 nm or more, so this would not carry that claim.' });
    }
    if (ratio < 1 / 3 && uvaFilters.length) {
      flags.push({ level: 'warn', text: 'UVA protection is about one ' + (1 / ratio).toFixed(1) + 'th of the SPF. Europe asks for at least a third.' });
    }
    if (!hasVisible) {
      flags.push({ level: 'note', text: 'No iron oxides, so no protection against visible light. If your concern is melasma rather than burning, a tinted formula does something a clear one cannot.' });
    }
    var bad = flags.filter(function (f) { return f.level === 'severe' || f.level === 'warn'; });
    if (!bad.length) {
      flags.unshift({ level: 'good', text: 'Broad-spectrum, photostable, and UVA protection in proportion to the SPF. This is what a good bottle looks like.' });
    }
    // lead with the worst thing, not the first thing found
    var rank = { severe: 0, warn: 1, good: 2, note: 3 };
    flags.sort(function (a, b) { return rank[a.level] - rank[b.level]; });

    return {
      ok: true, spf: r.spf, uvapf: r.uvapf, critical: r.critical, ratio: ratio,
      broadSpectrum: r.critical >= 370, euUVA: ratio >= 1 / 3,
      uvaCount: uvaFilters.length, hasVisible: hasVisible,
      flags: flags,
      // absolute numbers are estimates; the band says so
      spfLow: r.spf * 0.6, spfHigh: r.spf * 1.5
    };
  }


  /* =====================================================================
     THE SHAPE OF A BOTTLE

     SPF is measured under one fixed laboratory spectrum, roughly midday sun.
     Real light is not fixed. When the sun is low, ozone has stripped out the
     short UVB, so more of the dose that still burns you arrives as UVA: 21%
     of it at noon, 72% by half five. A filter set weighted to UVB therefore
     loses ground at exactly the hours most working people are outside.

     So a bottle does not have a protection number. It has a SHAPE across the
     day. Two products both labelled SPF 50 can hold 29 and 16 at half five.

     Nothing here is a verdict. A bottle that peaks hard at noon is excellent
     at noon. The point is to match the shape to the hours you actually keep.
     ===================================================================== */

  function spfUnderSky(mix, mu0, aod) {
    if (mu0 <= 0.02) return null;
    var G = groundAt(mu0, aod == null ? 0.4 : aod), n = 0, d = 0, S = film();
    for (var l = 290; l <= 400; l++) {
      var sum = 0;
      for (var k in mix) if (BY_KEY[k]) sum += mix[k] * E1(BY_KEY[k], l);
      var g = G[l] * ery(l);
      n += g; d += g * Math.pow(10, -S * sum);
    }
    return d > 0 ? n / d : 1;
  }

  /* Ground spectrum for an arbitrary sun height, cached per 0.05 of mu0. */
  var GCACHE = {};
  function groundAt(mu0, aod) {
    var key = Math.round(mu0 * 20) + '_' + Math.round(aod * 10);
    if (GCACHE[key]) return GCACHE[key];
    var E0t = [[290, .48], [300, .51], [310, .69], [320, .83], [330, 1.05], [340, .98],
               [350, 1.05], [360, 1.05], [370, 1.15], [380, 1.12], [390, 1.10], [400, 1.45]];
    function E0(l) {
      for (var i = 0; i < E0t.length - 1; i++) {
        if (l <= E0t[i + 1][0]) return E0t[i][1] + (E0t[i + 1][1] - E0t[i][1]) * (l - E0t[i][0]) / (E0t[i + 1][0] - E0t[i][0]);
      }
      return 1.4;
    }
    var out = {};
    for (var l = 290; l <= 400; l++) {
      var t = 1;
      if (global.ShadeMeter && global.ShadeMeter.irradiance) {
        var r = global.ShadeMeter.irradiance(l / 1000, mu0, aod, 1.0, 300);
        t = r.direct + r.diffuse;
      }
      out[l] = E0(l) * t * mu0;
    }
    GCACHE[key] = out;
    return out;
  }

  /* mix from a list of filter keys, using typical use levels */
  function mixFor(keys) {
    var mix = {};
    keys.forEach(function (k) { if (BY_KEY[k] && !BY_KEY[k].visible) mix[k] = BY_KEY[k].typ; });
    return mix;
  }

  /* muByHour: array of 24 cosine-zenith values for the user's own location. */
  function shape(keys, muByHour) {
    var mix = mixFor(keys);
    if (!Object.keys(mix).length) return null;
    var curve = [], i, peak = 0, lo = Infinity;
    for (i = 0; i < 24; i++) {
      var v = spfUnderSky(mix, muByHour[i]);
      curve.push(v);
      if (v != null && muByHour[i] > 0.15) {          // only judge hours with real sun
        if (v > peak) peak = v;
        if (v < lo) lo = v;
      }
    }
    return {
      curve: curve,
      peak: peak,
      floor: isFinite(lo) ? lo : peak,
      steadiness: peak > 0 && isFinite(lo) ? lo / peak : 1
    };
  }

  /* Weighted by the hours a person is actually outside. */
  function inYourHours(keys, muByHour, hours) {
    var mix = mixFor(keys), n = 0, tot = 0;
    hours.forEach(function (h) {
      var v = spfUnderSky(mix, muByHour[h]);
      if (v != null && muByHour[h] > 0.05) { n += v; tot++; }
    });
    return tot ? n / tot : null;
  }

  global.Filters = { FILTERS: FILTERS, BY_KEY: BY_KEY, audit: audit, compute: compute, film: film,
                     shape: shape, inYourHours: inYourHours, spfUnderSky: spfUnderSky, mixFor: mixFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Filters;
})(typeof globalThis !== 'undefined' ? globalThis : this);
