/* ===========================================================================
   UMBRA / shade-meter.js

   Turns a phone camera into a shadowband radiometer, and puts a number on the
   one sun protection that has never had one: shade.

   TWO MEASUREMENTS
     1. A COMB SHADOW (spread fingers, or a slotted card) on a flat surface.
        The darkness of a shadow IS the diffuse fraction, because shadow blocks the
        sun disc but not the sky. Measured per RGB channel, the spectral slope
        gives the aerosol, which extrapolates to erythemal UV.
     2. AN UPWARD PHOTO from under the shade. The fraction of sky still visible
        is canopy gap-fraction analysis, borrowed from forestry.

     Shade SPF  =  1 / (f_diffuse_UV x f_sky_visible)

   WHY A COMB AND NOT TWO HALVES
     Measured, not assumed. A naive sunlit-half/shadow-half photo is destroyed
     by HDR local tone mapping, which every phone applies by default: a 1.25x
     shadow lift puts +0.24 of error into the answer, and 1.5x breaks it
     outright. Local tone mapping works on a coarse spatial kernel, so stripes
     finer than that kernel receive the SAME gain and the ratio survives.
     But go too fine and 4:2:0 chroma subsampling averages colour across
     stripes, destroying the very spectral contrast the retrieval depends on.
     Sampling only stripe CENTRES, phase-aware, beats both at once.
     Synthetic-image error: +-0.24 naive, +-0.003 with comb + centre sampling.

   WHAT THIS CANNOT SEE
     Ozone. Its absorption is enormous at 305 nm and identically zero across
     the visible band, so no camera can retrieve it. Ozone therefore comes from
     the climatology already shipped in uv-engine.js. The photo constrains what
     varies hour to hour (aerosol, haze, cloud); the table handles what varies
     slowly and smoothly.
   =========================================================================== */

(function (global) {
  'use strict';

  var RGB = [0.600, 0.540, 0.460];   // phone R,G,B effective wavelengths, um
  var UV_ERY = 0.305;                // erythemal action peak
  var FR = 0.511, FA = 0.85, SLANT = 1.519;   // calibrated to published anchors

  function tauRayleigh(l) {
    return 0.008569 * Math.pow(l, -4) *
      (1 + 0.0113 * Math.pow(l, -2) + 0.00013 * Math.pow(l, -4));
  }

  /* Hartley-Huggins band. Zero in the visible: a camera cannot see ozone. */
  function tauOzone(l, dobson) {
    if (l >= 0.35) return 0;
    var sigma = 1.9e-19 * Math.pow(10, -(l * 1000 - 305) / 17);
    return sigma * dobson * 2.687e16;
  }

  function tauAerosol(l, aod550, alpha) {
    return aod550 * Math.pow(l / 0.55, -alpha);
  }

  function fdiff(l, mu0, aod550, alpha, dobson) {
    var m = 1 / mu0;
    var tR = tauRayleigh(l), tA = tauAerosol(l, aod550, alpha), tO = tauOzone(l, dobson);
    var direct = Math.exp(-(tR + tA + tO) * m);
    var gen = FR * (1 - Math.exp(-tR * m)) + FA * (1 - Math.exp(-tA * m));
    var diff = gen * Math.exp(-tO * m * SLANT);
    return diff / (direct + diff);
  }

  /* Invert one channel's measured diffuse fraction for its aerosol depth.
     Rayleigh is known exactly from physics, so the residual is aerosol. */
  function invertAOD(l, fdMeas, mu0) {
    var lo = 1e-6, hi = 25, m = 1 / mu0, tR = tauRayleigh(l);
    function f(ta) {
      var direct = Math.exp(-(tR + ta) * m);
      var gen = FR * (1 - Math.exp(-tR * m)) + FA * (1 - Math.exp(-ta * m));
      return gen / (direct + gen) - fdMeas;
    }
    if (f(lo) > 0 || f(hi) < 0) return NaN;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (f(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function srgbDecode(v) {
    v = v / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /* --- find the stripe pitch by autocorrelating the luma profile --------- */
  function findPitch(prof) {
    var n = prof.length, mean = 0, i, lag;
    for (i = 0; i < n; i++) mean += prof[i];
    mean /= n;
    var maxLag = Math.min(160, Math.floor(n / 3));
    var ac = new Float64Array(maxLag + 1);
    var best = 0;
    for (lag = 6; lag <= maxLag; lag++) {
      var s = 0;
      for (i = 0; i + lag < n; i++) s += (prof[i] - mean) * (prof[i + lag] - mean);
      ac[lag] = s / (n - lag);
      if (ac[lag] > best) best = ac[lag];
    }
    if (best <= 0) return 0;
    // Take the SMALLEST lag that is essentially as good as the best, not the
    // global maximum: harmonics (2x, 3x the true pitch) routinely score a hair
    // higher, and locking onto one makes every sampled block span a full
    // sun+shadow pair, so the two populations become indistinguishable.
    for (lag = 6; lag <= maxLag; lag++) {
      if (ac[lag] >= 0.9 * best &&
          ac[lag] >= ac[lag - 1] && (lag === maxLag || ac[lag] >= ac[lag + 1])) {
        return lag;
      }
    }
    return 0;
  }

  /* =====================================================================
     Measurement 1: the comb shadow.
     Returns per-channel diffuse fraction, then the retrieval.
     ===================================================================== */
  function analyseComb(imgData, mu0, dobson) {
    var w = imgData.width, h = imgData.height, d = imgData.data;
    var y0 = Math.floor(h * 0.25), y1 = Math.floor(h * 0.75);

    // linear luma profile across the image, averaged down the rows
    var prof = new Float64Array(w), x, y, o, lin;
    for (x = 0; x < w; x++) {
      var acc = 0;
      for (y = y0; y < y1; y++) {
        o = (y * w + x) * 4;
        acc += 0.2126 * srgbDecode(d[o]) + 0.7152 * srgbDecode(d[o + 1]) + 0.0722 * srgbDecode(d[o + 2]);
      }
      prof[x] = acc / (y1 - y0);
    }

    // Before hunting for stripes, check there is a shadow at all. Flat, fully
    // diffuse light (overcast, or standing in shade) produces a photo with
    // almost no contrast, and "no stripe pattern found" is a useless thing to
    // tell someone whose real problem is that the sun is not out.
    var pMax = -Infinity, pMin = Infinity;
    for (x = 0; x < w; x++) { if (prof[x] > pMax) pMax = prof[x]; if (prof[x] < pMin) pMin = prof[x]; }
    var contrast = pMax > 0 ? (pMax - pMin) / pMax : 0;
    if (contrast < 0.18) {
      return { ok: false, contrast: contrast,
        reason: 'There is no shadow in this photo. The light is flat (only ' +
                Math.round(contrast * 100) + '% variation across the frame). You are in shade, ' +
                'under cloud, or indoors. Stand in DIRECT sun where you can see a sharp dark shadow, then try again.' };
    }

    var pitch = findPitch(prof);
    if (!pitch || pitch < 8) return { ok: false, contrast: contrast,
      reason: 'A shadow is there, but not as separate bars. Spread your fingers wider and lift your hand higher, about 30 cm, so the finger shadows separate into 4 or 5 distinct stripes. Then fill the frame with the stripes only, keeping your hand out of shot.' };

    var half = Math.round(pitch / 2);
    // sample a centred band ~40% of the stripe width: the edges carry penumbra
    // and 4:2:0 chroma bleed, which is exactly what destroys the colour slope
    var core = Math.max(1, Math.floor(half * 0.4 / 2));

    // classify each half-stripe as sunlit or shadow by its mean, then sample
    // ONLY the middle of each, since edges carry penumbra and chroma bleed
    var sunS = [0, 0, 0], shaS = [0, 0, 0], sunN = 0, shaN = 0;
    for (var s = 0; s + half <= w; s += half) {
      var c = s + Math.floor(half / 2), mid = 0, k;
      for (k = -core; k <= core; k++) mid += prof[Math.min(w - 1, Math.max(0, c + k))];
      mid /= (2 * core + 1);
      var isSun = mid > (Math.max.apply(null, prof) + Math.min.apply(null, prof)) / 2;
      for (y = y0; y < y1; y++) {
        for (k = -core; k <= core; k++) {
          x = Math.min(w - 1, Math.max(0, c + k));
          o = (y * w + x) * 4;
          for (var ch = 0; ch < 3; ch++) {
            lin = srgbDecode(d[o + ch]);
            if (isSun) sunS[ch] += lin; else shaS[ch] += lin;
          }
        }
        if (isSun) sunN++; else shaN++;
      }
    }
    if (!sunN || !shaN) return { ok: false, reason: 'Could not separate sunlit and shadowed stripes. Try a stronger, sharper shadow.' };

    var n = 2 * core + 1;
    var fd = [0, 0, 0];
    for (var c2 = 0; c2 < 3; c2++) fd[c2] = (shaS[c2] / (shaN * n)) / (sunS[c2] / (sunN * n));

    // sanity: the blue channel must be the most diffuse. If not, the frame is
    // contaminated (bounce light, mixed surfaces, or a tone curve we lost to).
    if (!(fd[2] > fd[1] && fd[1] > fd[0])) {
      return { ok: false, reason: 'The colour slope is wrong for open sky, usually bounce light from a nearby wall. Move somewhere open and try again.', fd: fd };
    }

    var aods = RGB.map(function (l, i) { return invertAOD(l, fd[i], mu0); });
    var use = [];
    for (var i2 = 0; i2 < 3; i2++) if (isFinite(aods[i2]) && aods[i2] > 0) use.push(i2);
    if (use.length < 2) return { ok: false, reason: 'Readings outside the physical range. Check the surface is flat and evenly lit.', fd: fd };

    // Angstrom fit: log(aod) = log(beta) - alpha*log(lambda)
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    use.forEach(function (i3) {
      var X = Math.log(RGB[i3]), Y = Math.log(aods[i3]);
      sx += X; sy += Y; sxx += X * X; sxy += X * Y;
    });
    var nn = use.length;
    var slope = (nn * sxy - sx * sy) / (nn * sxx - sx * sx);
    var inter = (sy - slope * sx) / nn;
    var alpha = -slope;
    var aod550 = Math.exp(inter + slope * Math.log(0.55));

    return {
      ok: true, pitch: pitch, fdRGB: fd,
      aod550: aod550, alpha: alpha,
      fdUV: fdiff(UV_ERY, mu0, aod550, alpha, dobson)
    };
  }

  /* =====================================================================
     Measurement 2: how much sky is still visible from under the shade.
     Canopy gap fraction: sky is bright and blue-dominant; leaves and fabric
     are neither.
     ===================================================================== */
  function skyFraction(imgData) {
    var d = imgData.data, n = d.length / 4, sky = 0;
    for (var i = 0; i < n; i++) {
      var o = i * 4, r = d[o], g = d[o + 1], b = d[o + 2];
      var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // bright and blue-leaning, or simply blown out (overcast sky clips white)
      if ((lum > 110 && b >= r - 6) || lum > 232) sky++;
    }
    return sky / n;
  }

  /* Shade protection factor. The beam is blocked; what reaches you is the
     visible sky dome times the diffuse fraction. */
  function shadeSPF(fdUV, fSky) {
    var transmitted = Math.max(0.004, fdUV * fSky);
    return 1 / transmitted;
  }

  /* Exported so a browser self-test can render synthetic combs with a known
     answer and check the retrieval against it, using the SAME physics. */
  function irradiance(l, mu0, aod550, alpha, dobson) {
    var m = 1 / mu0;
    var tR = tauRayleigh(l), tA = tauAerosol(l, aod550, alpha), tO = tauOzone(l, dobson);
    var direct = Math.exp(-(tR + tA + tO) * m);
    var gen = FR * (1 - Math.exp(-tR * m)) + FA * (1 - Math.exp(-tA * m));
    return { direct: direct, diffuse: gen * Math.exp(-tO * m * SLANT) };
  }

  global.ShadeMeter = {
    irradiance: irradiance,
    analyseComb: analyseComb,
    skyFraction: skyFraction,
    shadeSPF: shadeSPF,
    fdiff: fdiff,
    constants: { RGB: RGB, UV_ERY: UV_ERY, FR: FR, FA: FA, SLANT: SLANT }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ShadeMeter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
