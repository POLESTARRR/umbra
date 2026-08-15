/* ===========================================================================
   UMBRA / anatomy.js

   The claim the landing page makes, finally computed.

   The ultraviolet index is defined for a HORIZONTAL surface. A body is not
   horizontal. A forehead is tilted back, a nose points forward, an ear is
   vertical, the back of a neck faces away, and the underside of a chin sees
   nothing but ground bounce. Each of those receives a different dose from the
   same sky, and the difference is large enough to explain where skin cancers
   actually appear.

   For a surface of tilt B from horizontal with normal azimuth G:

     E_site = E_dir_normal * max(0, cos(incidence))     the sun disc
            + E_diffuse    * (1 + cos B) / 2            the sky dome it sees
            + albedo * E_horiz_total * (1 - cos B) / 2  what the ground throws

     cos(incidence) = cos(Z)cos(B) + sin(Z)sin(B)cos(Gs - G)

   The sky and ground terms are the standard isotropic view factors from solar
   engineering. They matter more here than in solar engineering, because
   erythemal ultraviolet is 40-60% diffuse where visible light is ~15%.

   Nothing here needs a sensor. Tilt and azimuth come from anatomy; the sun
   comes from uv-engine.js; the diffuse split comes from shade-meter.js or its
   clear-sky default.
   =========================================================================== */

(function (global) {
  'use strict';

  var RAD = Math.PI / 180;

  /* tilt: degrees from horizontal (0 = facing straight up, 90 = vertical).
     az:   degrees offset from the direction the person faces.
     area: rough share of exposed head/limb surface, used only for ranking
           the total burden rather than the rate.                          */
  var SITES = [
    { key: 'crown',    name: 'Scalp / parting',   tilt: 5,   az: 0,    area: 1.0, note: 'Bald or parted hair is the single most exposed skin on a standing body.' },
    { key: 'forehead', name: 'Forehead',          tilt: 25,  az: 0,    area: 1.0, note: '' },
    { key: 'nose',     name: 'Nose',              tilt: 55,  az: 0,    area: 0.4, note: 'Projects forward from the face, so it catches the beam at almost any hour.' },
    { key: 'cheekR',   name: 'Right cheek',       tilt: 75,  az: 55,   area: 0.9, note: '' },
    { key: 'cheekL',   name: 'Left cheek',        tilt: 75,  az: -55,  area: 0.9, note: '' },
    { key: 'earR',     name: 'Right ear',         tilt: 90,  az: 90,   area: 0.3, note: 'Vertical, unshaded by hair on most men, and among the most skipped.' },
    { key: 'earL',     name: 'Left ear',          tilt: 90,  az: -90,  area: 0.3, note: '' },
    { key: 'nape',     name: 'Back of neck',      tilt: 50,  az: 180,  area: 0.8, note: 'Faces away from where you are looking, so it is never in your mirror.' },
    { key: 'lips',     name: 'Lower lip',         tilt: 65,  az: 0,    area: 0.2, note: 'No stratum corneum to speak of, and sunscreen is rarely put there.' },
    { key: 'eyelid',   name: 'Eyelids',           tilt: 40,  az: 0,    area: 0.3, note: 'Thin, heavily exposed, and the most commonly missed area on the face.' },
    { key: 'shoulder', name: 'Shoulders',         tilt: 12,  az: 0,    area: 1.2, note: '' },
    { key: 'chest',    name: 'Upper chest',       tilt: 70,  az: 0,    area: 1.0, note: '' },
    { key: 'armR',     name: 'Right forearm',     tilt: 85,  az: 90,   area: 1.1, note: '' },
    { key: 'armL',     name: 'Left forearm',      tilt: 85,  az: -90,  area: 1.1, note: '' },
    { key: 'feet',     name: 'Tops of feet',      tilt: 8,   az: 0,    area: 0.9, note: 'Nearly horizontal, so it takes almost the full index, and is the last place anyone applies.' },
    { key: 'chin',     name: 'Under the chin',    tilt: 155, az: 0,    area: 0.4, note: 'Sees no sky at all. Everything it gets is bounced up off the ground.' }
  ];

  /* Cosine of the angle between the sun and a tilted surface's normal. */
  function cosIncidence(zenithDeg, sunAzDeg, tiltDeg, normAzDeg) {
    var Z = zenithDeg * RAD, B = tiltDeg * RAD;
    return Math.cos(Z) * Math.cos(B) +
           Math.sin(Z) * Math.sin(B) * Math.cos((sunAzDeg - normAzDeg) * RAD);
  }

  /* opts:
       uvi        horizontal ultraviolet index (the published number)
       zenith     solar zenith, degrees
       sunAz      solar azimuth, degrees from north
       facing     direction the person faces, degrees from north.
                  Pass null to average over all directions (moving about).
       diffuse    diffuse fraction 0..1 (measured by the shade meter, or modelled)
       albedo     ground reflectance (grass .03, water .10, sand .20, snow .80)
  */
  function bodyMap(opts) {
    var uvi = Math.max(0, opts.uvi || 0);
    var Z = opts.zenith == null ? 90 : opts.zenith;
    var fd = opts.diffuse == null ? 0.5 : opts.diffuse;
    var alb = opts.albedo == null ? 0.03 : opts.albedo;
    var mu0 = Math.cos(Z * RAD);

    var Ehoriz = uvi;                          // work in index units throughout
    var Ediff = fd * Ehoriz;
    var Edir_h = (1 - fd) * Ehoriz;
    var Edir_n = mu0 > 0.02 ? Edir_h / mu0 : 0;  // beam normal to itself

    var facings = opts.facing == null
      ? [0, 45, 90, 135, 180, 225, 270, 315]   // averaged: no fixed heading
      : [opts.facing];

    var rows = SITES.map(function (s) {
      var acc = 0;
      for (var i = 0; i < facings.length; i++) {
        var normAz = (facings[i] + s.az + 360) % 360;
        var ci = cosIncidence(Z, opts.sunAz == null ? 180 : opts.sunAz, s.tilt, normAz);
        var beam = Edir_n * Math.max(0, ci);
        var sky = Ediff * (1 + Math.cos(s.tilt * RAD)) / 2;
        var grd = alb * Ehoriz * (1 - Math.cos(s.tilt * RAD)) / 2;
        acc += beam + sky + grd;
      }
      var e = acc / facings.length;
      return {
        key: s.key, name: s.name, note: s.note, area: s.area,
        index: e,                               // effective index at that site
        ratio: Ehoriz > 0 ? e / Ehoriz : 0,     // vs the published number
        burden: e * s.area
      };
    });

    rows.sort(function (a, b) { return b.index - a.index; });
    return {
      sites: rows,
      horizontal: Ehoriz,
      worst: rows[0],
      // how wrong is a single number for a whole body?
      spread: rows.length ? rows[0].index / Math.max(1e-6, rows[rows.length - 1].index) : 1
    };
  }

  /* Minutes to one MED at a given site. */
  function siteBurnMinutes(siteIndex, medJ) {
    return siteIndex <= 0 ? Infinity : medJ / (0.025 * siteIndex) / 60;
  }

  global.Anatomy = {
    SITES: SITES,
    cosIncidence: cosIncidence,
    bodyMap: bodyMap,
    siteBurnMinutes: siteBurnMinutes
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Anatomy;
})(typeof globalThis !== 'undefined' ? globalThis : this);
