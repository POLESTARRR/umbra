/* ===========================================================================
   UMBRA / uv-engine.js
   Phase 00: clear-sky erythemal ultraviolet from solar geometry alone.

   No network. No API key. No server. Every input is either the timestamp,
   the coordinates, or a table that ships with the file.

   Exposed as a global (window.UV) rather than an ES module so the page opens
   from file:// by double-click without tripping CORS. Serve it if you prefer.

   MODEL PROVENANCE
   ----------------
   solar position   NOAA low-precision algorithm, ~0.01 deg
   clear-sky UVI    UVI = 12.5 * mu0^2.42 * (omega/300)^-1.23
   ozone            climatological total column, latitude band x month
   altitude         +8% per 1000 m
   albedo           1 + 0.35*a, first-order multiple-scatter approximation
   diffuse fraction 1 - 0.62*sqrt(mu0)

   The three coefficients marked CALIBRATE below are empirical fits. Phase 00
   is not finished until they have been regressed against NOAA/EPA archive
   data across latitudes and seasons and the residual is reported. Until then
   this is a defensible ceiling, not a measurement.
   =========================================================================== */

(function (global) {
  'use strict';

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;

  /* --- CALIBRATE: empirical coefficients ------------------------------- */
  var K_UVI      = 12.5;   // clear-sky scale at mu0=1, omega=300 DU
  var P_MU       = 2.42;   // solar zenith exponent
  var P_OZONE    = -1.23;  // radiation amplification factor
  var ALT_GAIN   = 0.08;   // per km
  var ALBEDO_K   = 0.35;   // multiple-scatter gain per unit albedo
  var CLOUD_UV_K = 0.85;   // CMF_uv = 1 - k*(1 - CMF_vis); UV survives cloud
                           // better than visible because it forward-scatters

  /* --- Total column ozone climatology, Dobson Units ---------------------
     Rows are latitude band centres from -80 to +80 in 20 deg steps.
     Columns are January through December. Linearly interpolated in latitude
     and wrapped in month. The southern polar row carries the ozone hole.
     ~1.6 KB of the payload, and it removes the last reason to make a request.
  ---------------------------------------------------------------------- */
  var OZONE_LAT = [-80, -60, -40, -20, 0, 20, 40, 60, 80];
  var OZONE = [
    [290, 285, 290, 300, 310, 315, 310, 270, 180, 160, 240, 290], // -80
    [310, 300, 300, 310, 325, 335, 340, 330, 290, 270, 300, 320], // -60
    [295, 292, 292, 298, 308, 318, 330, 342, 348, 340, 322, 305], // -40
    [262, 264, 268, 272, 278, 282, 288, 292, 292, 285, 275, 266], // -20
    [252, 254, 258, 260, 260, 258, 256, 254, 254, 252, 250, 250], //   0
    [265, 272, 282, 288, 288, 282, 275, 270, 268, 262, 258, 260], //  20
    [320, 340, 355, 350, 335, 320, 305, 295, 285, 285, 295, 305], //  40
    [350, 380, 400, 395, 375, 350, 330, 315, 300, 300, 310, 330], //  60
    [360, 395, 430, 425, 395, 360, 335, 320, 305, 300, 315, 340]  //  80
  ];

  /* --- Cloud presets. Broken cloud EXCEEDS clear sky: bright cloud edges
     scatter extra flux onto an unobscured sun disc. This is the single most
     counterintuitive number in the model and it is why "it's cloudy, I'm
     fine" is not merely wrong but inverted.                              */
  var CLOUD = {
    clear:    1.00,
    thin:     0.89,
    broken:   1.25,  // peak enhancement above clear sky
    overcast: 0.31
  };

  /* --- Ground albedo at erythemal wavelengths --------------------------- */
  var ALBEDO = {
    grass: 0.03,
    water: 0.10,
    sand:  0.20,
    snow:  0.80   // fresh
  };

  /* --- Skin: minimal erythemal dose by Fitzpatrick type, J/m^2 ---------- */
  var MED = { I: 200, II: 250, III: 300, IV: 450, V: 600, VI: 1000 };

  function norm360(x) { return ((x % 360) + 360) % 360; }
  function wrap180(x) { return ((x + 180) % 360 + 360) % 360 - 180; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  function julianDay(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  /* =====================================================================
     Solar position. Everything downstream is a function of mu0, so this is
     the only place an error compounds.
     ===================================================================== */
  function solarPosition(date, lat, lon) {
    var n = julianDay(date) - 2451545.0;

    var L   = norm360(280.460 + 0.9856474 * n);          // mean longitude
    var g   = norm360(357.528 + 0.9856003 * n) * RAD;    // mean anomaly
    var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    var eps = (23.439 - 0.0000004 * n) * RAD;            // obliquity

    var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    var ra  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));

    var eot = 4 * wrap180(L - norm360(ra * DEG));        // minutes

    var utcH = date.getUTCHours()
             + date.getUTCMinutes() / 60
             + date.getUTCSeconds() / 3600;

    var solarTime = utcH + eot / 60 + lon / 15;
    var H = (solarTime - 12) * 15 * RAD;                 // hour angle

    var phi = lat * RAD;
    var mu0 = clamp(
      Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H),
      -1, 1
    );

    // Earth-sun distance in AU; irradiance scales as 1/R^2
    var R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);

    // Solar azimuth, measured clockwise from north. Needed in Phase 03 to
    // dot the sun vector against a body site's surface normal.
    var az = Math.atan2(
      -Math.sin(H),
      Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)
    ) * DEG;

    return {
      mu0: mu0,
      zenith: Math.acos(mu0) * DEG,
      elevation: 90 - Math.acos(mu0) * DEG,
      azimuth: norm360(az),
      declination: dec * DEG,
      eot: eot,
      solarTime: solarTime,
      distanceAU: R
    };
  }

  /* Total column ozone from the shipped climatology. */
  function ozoneAt(lat, month /* 0-11 */) {
    lat = clamp(lat, -89.9, 89.9);
    var i = 0;
    while (i < OZONE_LAT.length - 2 && lat > OZONE_LAT[i + 1]) i++;
    var lo = OZONE_LAT[i], hi = OZONE_LAT[i + 1];
    var f = clamp((lat - lo) / (hi - lo), 0, 1);
    return OZONE[i][month] * (1 - f) + OZONE[i + 1][month] * f;
  }

  /* Erythemal diffuse fraction. Rayleigh scattering goes as lambda^-4, so at
     300 nm a large share of the flux arrives from the whole sky dome rather
     than the sun disc. This is what makes shade weaker than it looks. */
  function diffuseFraction(mu0) {
    if (mu0 <= 0) return 1;
    return clamp(1 - 0.62 * Math.sqrt(mu0), 0.30, 0.95);
  }

  /* =====================================================================
     The index at one instant.

     opts: { cloud: 'clear'|'thin'|'broken'|'overcast' | number,
             altitude: metres,
             albedo: 'grass'|'water'|'sand'|'snow' | number,
             shade: { skyFraction: 0..1 }  // fraction of sky dome still seen
             aerosol: 0..1 multiplier      // 1 = clean air
           }
     ===================================================================== */
  function uvIndex(date, lat, lon, opts) {
    opts = opts || {};
    var sun = solarPosition(date, lat, lon);
    if (sun.mu0 <= 0) {
      return { uvi: 0, mu0: sun.mu0, sun: sun, ozone: 0, diffuse: 1 };
    }

    var omega = opts.ozone || ozoneAt(lat, date.getUTCMonth());

    // clear sky, sea level, mean earth-sun distance
    var uvi = K_UVI
            * Math.pow(sun.mu0, P_MU)
            * Math.pow(omega / 300, P_OZONE);

    uvi /= (sun.distanceAU * sun.distanceAU);

    var altKm = (opts.altitude || 0) / 1000;
    uvi *= (1 + ALT_GAIN * altKm);

    var a = typeof opts.albedo === 'number'
          ? opts.albedo
          : (ALBEDO[opts.albedo] !== undefined ? ALBEDO[opts.albedo] : ALBEDO.grass);
    uvi *= (1 + ALBEDO_K * a);

    var cmfVis = typeof opts.cloud === 'number'
               ? opts.cloud
               : (CLOUD[opts.cloud] !== undefined ? CLOUD[opts.cloud] : CLOUD.clear);
    uvi *= cloudUV(cmfVis);

    if (opts.aerosol) uvi *= opts.aerosol;

    var fd = diffuseFraction(sun.mu0);

    // Shade blocks the beam entirely and part of the dome. A beach umbrella
    // leaves you roughly half the sky, which is why it measures SPF 3-5.
    if (opts.shade) {
      var skyLeft = opts.shade.skyFraction !== undefined ? opts.shade.skyFraction : 0.55;
      uvi *= fd * skyLeft;
    }

    return {
      uvi: Math.max(0, uvi),
      mu0: sun.mu0,
      sun: sun,
      ozone: omega,
      diffuse: fd
    };
  }

  /* Clouds attenuate UV less than they attenuate visible light. If you
     measure a visible cloud modification factor with the camera, convert. */
  function cloudUV(cmfVis) {
    if (cmfVis >= 1) return cmfVis;               // enhancement passes through
    return 1 - CLOUD_UV_K * (1 - cmfVis);
  }

  /* Camera exposure metadata as a photometer.
     L = (N^2 * K) / (t * S)   N = f-number, t = shutter seconds, S = ISO   */
  function luminanceFromExposure(fNumber, shutterSeconds, iso, K) {
    K = K || 12.5;
    return (fNumber * fNumber * K) / (shutterSeconds * iso);
  }

  /* =====================================================================
     A whole day, sampled. This is what the demonstration panel draws.
     ===================================================================== */
  function daySeries(dateUTCmidnight, lat, lon, opts, stepMinutes) {
    stepMinutes = stepMinutes || 10;
    var out = [];
    var base = Date.UTC(
      dateUTCmidnight.getUTCFullYear(),
      dateUTCmidnight.getUTCMonth(),
      dateUTCmidnight.getUTCDate()
    );
    for (var m = 0; m <= 1440; m += stepMinutes) {
      var d = new Date(base + m * 60000);
      var r = uvIndex(d, lat, lon, opts);
      out.push({ minutesUTC: m, uvi: r.uvi, mu0: r.mu0 });
    }
    return out;
  }

  /* Integrate the series into accumulated erythemal dose.
     1 index unit = 0.025 W/m^2 CIE-weighted. 1 SED = 100 J/m^2.            */
  function integrateDose(series, stepMinutes) {
    stepMinutes = stepMinutes || 10;
    var joules = 0;
    for (var i = 0; i < series.length; i++) {
      joules += 0.025 * series[i].uvi * stepMinutes * 60;
    }
    return { joules: joules, sed: joules / 100 };
  }

  /* Minutes of unprotected exposure to one MED at a given index. */
  function minutesToMED(uvi, skinType) {
    if (uvi <= 0) return Infinity;
    var med = MED[skinType] || MED.III;
    return med / (0.025 * uvi) / 60;
  }

  /* =====================================================================
     Sunscreen. The quantity error dwarfs the timing error, and the penalty
     for under-dosing is exponential, not linear.
     ===================================================================== */

  // Mosteller. Returns square metres.
  function bodySurfaceArea(heightCm, weightKg) {
    return Math.sqrt(heightCm * weightKg / 3600);
  }

  // Grams needed at the certified 2 mg/cm^2 for a given share of the body.
  function requiredMass(bsaM2, coverageFraction) {
    return bsaM2 * 1e4 * 0.002 * coverageFraction;
  }

  // The number that hurts. SPF_eff = SPF_label ^ (density / 2.0).
  // This is the exponential bound; real films sit between this and linear,
  // so treat it as the pessimistic end of a range.
  function effectiveSPF(labelSPF, densityMgCm2) {
    return Math.pow(labelSPF, clamp(densityMgCm2, 0, 2) / 2);
  }

  // Protection decays as film is lost, not on a two-hour clock.
  function decayedSPF(appliedSPF, minutes, lambdaPerHour) {
    var s = 1 + (appliedSPF - 1) * Math.exp(-lambdaPerHour * minutes / 60);
    return Math.max(1, s);
  }

  /* =====================================================================
     Self-check. Open the console: the model has to reproduce the clinical
     rules from first principles or it is wrong.
     ===================================================================== */
  function selfTest() {
    var rows = [];
    var bsa = bodySurfaceArea(175, 70);
    rows.push(['BSA 175cm/70kg', bsa.toFixed(2) + ' m2', 'expect ~1.85']);
    rows.push(['whole body @80%', requiredMass(bsa, 0.80).toFixed(1) + ' g', 'expect ~30 (one shot glass)']);
    rows.push(['face + neck @5.5%', requiredMass(bsa, 0.055).toFixed(2) + ' g', 'expect ~2 (half a teaspoon)']);
    rows.push(['SPF50 @0.8mg/cm2', effectiveSPF(50, 0.8).toFixed(1), 'expect ~4.8']);
    rows.push(['shadow rule, 300DU', (K_UVI * Math.pow(Math.cos(45 * RAD), P_MU)).toFixed(1), 'expect ~5.4 at zenith 45']);
    if (global.console && console.table) console.table(rows);
    return rows;
  }

  global.UV = {
    solarPosition: solarPosition,
    ozoneAt: ozoneAt,
    diffuseFraction: diffuseFraction,
    uvIndex: uvIndex,
    cloudUV: cloudUV,
    luminanceFromExposure: luminanceFromExposure,
    daySeries: daySeries,
    integrateDose: integrateDose,
    minutesToMED: minutesToMED,
    bodySurfaceArea: bodySurfaceArea,
    requiredMass: requiredMass,
    effectiveSPF: effectiveSPF,
    decayedSPF: decayedSPF,
    selfTest: selfTest,
    constants: { CLOUD: CLOUD, ALBEDO: ALBEDO, MED: MED }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.UV;
})(typeof globalThis !== 'undefined' ? globalThis : this);
