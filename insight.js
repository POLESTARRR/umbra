/* ===========================================================================
   UMBRA / insight.js

   Everything the shade measurement makes possible once you have it.

     AIR      AOD550 -> PM2.5 -> Indian CPCB AQI, and the Angstrom exponent
              tells you whether today's haze is SMOKE or DUST.
     LEDGER   cumulative erythemal dose, and the sun age it implies.
     COMMUTE  a falsifiable prediction about which side of YOUR face is
              ageing faster, from solar azimuth against your travel bearing.
     LADDER   a home minimal-erythemal-dose phototest, generated from the
              forecast, so the burn threshold is measured rather than guessed.

   Pure functions, no DOM. Testable under node.
   =========================================================================== */

(function (global) {
  'use strict';

  var RAD = Math.PI / 180;

  /* =====================================================================
     AIR: the shade photo was secretly an air-quality measurement
     ===================================================================== */

  /* Hygroscopic growth: humid air swells particles, inflating optical depth
     without adding dry mass. Back it out before converting to PM2.5. */
  function dryAOD(aod550, rhPercent) {
    if (rhPercent == null) return aod550;
    var rh = Math.min(90, Math.max(0, rhPercent)) / 100;
    // f(RH) = (1-RH)^-0.26 : ~1.1x at 35%, ~1.6x at 85%. The steeper exponents
    // in the literature blow up near saturation and swallowed the whole signal.
    return aod550 / Math.pow(1 - rh, -0.26);
  }

  /* Column AOD -> surface PM2.5. The ratio depends mostly on how deep the
     mixing layer is: the same column packed into a shallow winter-morning
     boundary layer gives far higher surface concentration. */
  function pblFactor(month /* 0-11 */, hour) {
    var seasonal = (month >= 10 || month <= 1) ? 1.60      // Nov-Feb, shallow
                 : (month >= 5 && month <= 8) ? 0.60        // monsoon, washed out
                 : 1.00;
    var diurnal = (hour < 10 || hour >= 18) ? 1.35          // morning/evening
                : (hour >= 11 && hour < 16) ? 0.80          // deep afternoon mixing
                : 1.00;
    return seasonal * diurnal;
  }

  /* K fitted against 2590 paired (AOD, PM2.5) samples from 18 Indian cities
     over 6 days of CAMS data. The literature-anchored guess of 150 was 1.9x
     too high. Median absolute error at this value: 32%, 82% within 2x. */
  var K_GLOBAL = 79;

  function pm25FromAOD(aod550, opts) {
    opts = opts || {};
    var dry = dryAOD(aod550, opts.rh);

    // The PM2.5-per-AOD ratio varies 3.8x BETWEEN Indian cities (24 to 89),
    // so a single global constant is the wrong shape of model. When a live
    // regional reference is available, derive the ratio locally and let the
    // photo supply only the AOD. That cuts median error 32% -> 22%, and 92%
    // of estimates land within 2x. The photo's contribution is SPATIAL: a
    // street-level reading against a ~40 km reanalysis grid cell.
    if (opts.refAOD > 0 && opts.refPM25 > 0) {
      var refDry = dryAOD(opts.refAOD, opts.rh);
      if (refDry > 0) return Math.max(0, dry * (opts.refPM25 / refDry));
    }

    var K = opts.K || K_GLOBAL;
    return Math.max(0, dry * K * pblFactor(opts.month || 0, opts.hour == null ? 12 : opts.hour));
  }

  /* Indian CPCB National AQI, PM2.5 sub-index. */
  var CPCB = [
    [0, 30, 0, 50, 'Good'],
    [30, 60, 51, 100, 'Satisfactory'],
    [60, 90, 101, 200, 'Moderate'],
    [90, 120, 201, 300, 'Poor'],
    [120, 250, 301, 400, 'Very poor'],
    [250, 500, 401, 500, 'Severe']
  ];

  function aqiFromPM25(pm) {
    for (var i = 0; i < CPCB.length; i++) {
      var b = CPCB[i];
      if (pm <= b[1] || i === CPCB.length - 1) {
        var lo = b[0], hi = b[1], alo = b[2], ahi = b[3];
        var a = alo + (Math.min(pm, hi) - lo) * (ahi - alo) / (hi - lo);
        return { aqi: Math.round(Math.max(0, a)), band: b[4] };
      }
    }
    return { aqi: 500, band: 'Severe' };
  }

  /* Angstrom exponent is a particle-SIZE indicator. Fine particles scatter
     with a steep wavelength dependence; coarse dust is nearly flat. */
  function particleType(alpha) {
    if (alpha >= 1.30) return { kind: 'smoke', label: 'Fine particles from combustion, crop burning or traffic', mask: 'A well-fitted N95 helps. Cloth does almost nothing at this size.' };
    if (alpha >= 0.70) return { kind: 'mixed', label: 'Mixed fine and coarse', mask: 'N95 for the fine fraction; the coarse part settles faster.' };
    return { kind: 'dust', label: 'Coarse particles, wind-blown dust', mask: 'Even a simple cover helps with coarse dust, unlike smoke.' };
  }

  function airQuality(aod550, alpha, opts) {
    opts = opts || {};
    var pm = pm25FromAOD(aod550, opts);
    var a = aqiFromPM25(pm);
    var anchored = opts.refAOD > 0 && opts.refPM25 > 0;
    // Bands taken from the measured residual distribution, not invented.
    return {
      pm25: pm, aqi: a.aqi, band: a.band,
      anchored: anchored,
      particles: particleType(alpha),
      pmLow: pm * (anchored ? 0.65 : 0.50),
      pmHigh: pm * (anchored ? 1.55 : 2.00)
    };
  }

  /* =====================================================================
     LEDGER: cumulative dose and the sun age it implies
     ===================================================================== */

  /* A reference person's daily personal dose. Published personal dosimetry
     puts adults at a few percent of available ambient; scaled by latitude
     because the ambient itself changes. */
  function referenceDailySED(lat) {
    var f = Math.cos(Math.abs(lat) * RAD);            // crude latitude scaling
    return 1.4 + 2.2 * Math.max(0, f);                 // ~3.6 tropics, ~2.2 at 50deg
  }

  /* history: { 'YYYY-MM-DD': sed }. Returns rate stats and sun age. */
  function ledger(history, age, lat) {
    var keys = Object.keys(history || {}).sort();
    var total = 0, i;
    for (i = 0; i < keys.length; i++) total += history[keys[i]];

    var window = keys.slice(-14);
    var recent = 0;
    for (i = 0; i < window.length; i++) recent += history[window[i]];
    var perDay = window.length ? recent / window.length : 0;

    var ref = referenceDailySED(lat);
    var ratio = ref > 0 ? perDay / ref : 0;

    // A raw age x ratio multiply produces nonsense (a fisherman at 4x comes
    // out "139 years old"). The honest statement is a RATE, and a projection
    // that assumes only the future runs at the observed rate.
    return {
      days: keys.length,
      totalSED: total,
      perDay: perDay,
      reference: ref,
      ratio: ratio,
      equivYearsPerYear: ratio,
      projectedEquivalentAge: function (yearsAhead) {
        return age + yearsAhead * (ratio > 0 ? ratio : 1);
      },
      confident: keys.length >= 5
    };
  }

  /* =====================================================================
     COMMUTE: which side of your face is ageing faster, and by how much
     ===================================================================== */

  /* Vehicle glass. Laminated windscreens block essentially all UVA; tempered
     side glass passes a large fraction of it, which is why the damage is
     one-sided rather than frontal. */
  var GLASS = { car: 0.62, auto: 0.95, bike: 1.00, walk: 1.00 };

  /* Cosine of incidence on a vertical surface whose outward normal points
     along `bearing`, given solar azimuth and elevation. */
  function verticalIncidence(sunAz, sunEl, bearing) {
    if (sunEl <= 0) return 0;
    var d = ((sunAz - bearing + 540) % 360) - 180;
    var c = Math.cos(sunEl * RAD) * Math.cos(d * RAD);
    return Math.max(0, c);
  }

  /* Integrate a year of commutes onto the left and right side of the face.
     solarFn(date) must return { azimuth, elevation, mu0 }. */
  function commuteAsymmetry(opts, solarFn, uvFn) {
    var bearing = opts.bearing || 0;          // travel direction, degrees from north
    var mode = opts.mode || 'car';
    var out = opts.outHour == null ? 9 : opts.outHour;
    var back = opts.backHour == null ? 18 : opts.backHour;
    var mins = opts.minutes == null ? 40 : opts.minutes;
    var years = opts.years == null ? 3 : opts.years;

    // In left-hand traffic the driver sits on the RIGHT, so the right side of
    // the face is the one at the window. Returning, the bearing reverses.
    var glass = GLASS[mode] == null ? 1 : GLASS[mode];
    var windowSide = opts.windowSide || 'right';

    var L = 0, R = 0;
    var year = new Date().getFullYear();
    for (var doy = 0; doy < 365; doy += 5) {
      for (var leg = 0; leg < 2; leg++) {
        var hour = leg === 0 ? out : back;
        var brg = leg === 0 ? bearing : (bearing + 180) % 360;
        var d = new Date(Date.UTC(year, 0, 1 + doy, 0, 0, 0));
        d = new Date(d.getTime() + (hour - (opts.tzHours || 5.5)) * 3600000);

        var sun = solarFn(d);
        if (!sun || sun.elevation <= 0) continue;
        var uvi = uvFn ? uvFn(d) : Math.max(0, 12 * Math.pow(Math.max(0, sun.mu0), 1.2));

        var leftN = (brg - 90 + 360) % 360;
        var rightN = (brg + 90) % 360;

        // UVA is what passes glass and drives photoageing; scale by exposure
        var base = uvi * mins * 5;            // 5 = sample spacing in days
        // A vertical surface sees half the sky dome, so the shaded cheek still
        // receives diffuse ultraviolet. Without this the ratio divides by zero
        // on a pure north-south route and reports Infinity.
        var diffuse = base * 0.5 * 0.5;
        var l = base * verticalIncidence(sun.azimuth, sun.elevation, leftN) + diffuse;
        var r = base * verticalIncidence(sun.azimuth, sun.elevation, rightN) + diffuse;

        if (mode === 'car' || mode === 'auto') {
          if (windowSide === 'right') r *= glass; else l *= glass;
          // the non-window side is shielded by the cabin
          if (windowSide === 'right') l *= 0.25; else r *= 0.25;
        }
        L += l; R += r;
      }
    }

    var hi = Math.max(L, R), lo = Math.min(L, R);
    return {
      left: L, right: R,
      side: R >= L ? 'right' : 'left',
      ratio: lo > 0 ? hi / lo : Infinity,
      years: years,
      meaningful: lo <= 0 ? hi > 0 : (hi / lo) >= 1.25
    };
  }

  /* =====================================================================
     LADDER: a home MED phototest, timed from the forecast
     ===================================================================== */

  var CONTRA = [
    'You take any photosensitising medicine such as doxycycline and other tetracyclines, some diuretics, retinoids, St John\'s wort, certain antibiotics and antifungals.',
    'You have lupus, porphyria, melasma, vitiligo or any diagnosed photosensitivity.',
    'You are under 18, or testing on anyone under 18.',
    'You have had skin cancer, or are under a dermatologist for anything active.',
    'You are using acids, retinol or have had a peel or laser in the last two weeks.'
  ];

  /* Geometric dose ladder bracketing the predicted threshold, then converted
     to real clock times against the hourly forecast. Uncover-progressively:
     the first window opened receives the most. */
  function medLadder(predictedMED, uviAt, startHour, steps) {
    steps = steps || [0.50, 0.63, 0.79, 1.00, 1.26, 1.59];
    var maxDose = predictedMED * steps[steps.length - 1];

    // integrate forward in 1-minute steps until the largest dose is reached
    var t = startHour, dose = 0, total = 0, guard = 0;
    while (dose < maxDose && guard++ < 12 * 60) {
      dose += 0.025 * Math.max(0, uviAt(t)) * 60;
      t += 1 / 60;
    }
    if (dose < maxDose) return { ok: false, reason: 'Not enough ultraviolet left today to reach the top of the ladder. Try starting earlier, or pick a clearer day.' };
    var endHour = t;

    // walk backwards from the end: window i is uncovered when the remaining
    // dose between then and the end equals its target
    var out = [];
    for (var i = 0; i < steps.length; i++) {
      var target = predictedMED * steps[i], acc = 0, tt = endHour, g2 = 0;
      while (acc < target && g2++ < 12 * 60) {
        tt -= 1 / 60;
        acc += 0.025 * Math.max(0, uviAt(tt)) * 60;
      }
      out.push({ step: steps[i], dose: target, uncoverAt: tt, minutes: (endHour - tt) * 60 });
    }
    out.sort(function (a, b) { return a.uncoverAt - b.uncoverAt; });
    return { ok: true, windows: out, endHour: endHour, contraindications: CONTRA };
  }

  global.Insight = {
    dryAOD: dryAOD, pblFactor: pblFactor, pm25FromAOD: pm25FromAOD,
    aqiFromPM25: aqiFromPM25, particleType: particleType, airQuality: airQuality,
    referenceDailySED: referenceDailySED, ledger: ledger,
    verticalIncidence: verticalIncidence, commuteAsymmetry: commuteAsymmetry,
    medLadder: medLadder, CONTRA: CONTRA
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Insight;
})(typeof globalThis !== 'undefined' ? globalThis : this);
