# UMBRA

Sun protection worked out properly, for India.

Everything is computed from solar geometry and published physics. No API key,
no server, no build step. Open `app.html` and it runs.

---

## The two ideas that make it different

### 1. The UV index measures the wrong thing for most Indians

The UV index measures **sunburn**. It was designed in Australia and Europe for
skin that burns easily. Most Indian skin tans instead, and tanning, dark spots,
melasma and ageing are driven by **UVA**, which behaves completely differently.

When the sun drops, ozone has already destroyed the short UVB, so more of what
still reaches you arrives as UVA:

| hour | UVA share of your erythemal dose |
|---|---|
| noon | 21% |
| 16:00 | 41% |
| 17:30 | **72%** |
| 18:30 | **96%** |

So sunburn risk ends around 17:00 while pigmentation risk runs to 19:00. UVA
also passes cloud and glass. A side car window lets through about 62%, an
office window about 75%, a laminated windscreen about 2%. That is the **Pigment Index** panel.

### 2. A sunscreen has a shape, not a number

SPF is measured in a lab under one fixed spectrum, roughly midday sun. Real
light is not fixed, so a bottle's true protection changes hour by hour, and how
much it changes depends entirely on which filters are in it.

Computed against real Delhi solar geometry:

| bottle | peak | at 17:30 | **holds its shape** |
|---|---|---|---|
| Zinc oxide (mineral) | 12 | 12 | **99%** |
| Tinosorb + Uvinul A Plus | 70 | 37 | 53% |
| Avobenzone + octocrylene | 62 | 22 | 36% |
| UVB filters only | 17 | 5 | 33% |

Two bottles both labelled SPF 50 can hold 37 and 22 at the same moment.
**Steadiness** is a second number alongside SPF, and nobody publishes one.

---

## Files

| | |
|---|---|
| **`app.html` + `app.js`** | The tool. Start here. |
| `index.html` + `page.js` | Landing page explaining the model |
| `uv-engine.js` | Solar position, clear-sky erythemal UV, offline ozone climatology, dosing maths |
| `shade-meter.js` | Spectral atmosphere: Rayleigh, aerosol and ozone at any wavelength |
| `filters.js` | UV filter absorbance; SPF, UVA-PF, and the day-shape calculation |
| `products.js` | Indian sunscreens with their published filter lists |
| `insight.js` | AQI, dose ledger, commute asymmetry |
| `anatomy.js` | Per-body-site dose from surface geometry and view factors. **Not loaded**, kept for reference since the body map came out |
| `styles.css` | Warm stationery. Radius 0, blue only as type, a rule or a drawn line |

Live data is **Open-Meteo**: free, no key, no registration, CORS open, so it
works from a double-clicked file. Offline it falls back to the on-device model
and says so rather than pretending.

## Layout

One page, no tabs and nothing hidden behind a toggle. All thirteen panels are on
screen at once, laid out in two columns so the page runs across rather than down:
your skin, right now, how long you can stay out, the pigment index, your bottle,
your plan, the live tracker, how to apply, air quality, the 7-day outlook, 18
Indian cities, your sun ledger and the commute mirror.

## Run it

Open `app.html` directly. Everything is classic scripts, so `file://` works with
no server. To serve it anyway: `python3 -m http.server`.

Note that `file://` blocks service workers, so there is no offline install or
notifications until it is hosted. Everything else works.

## Check it yourself

```
node -e "require('./uv-engine.js').selfTest()"
```

The model has to reproduce the clinical dosing rules from pure geometry or it is
wrong. It returns **29.5 g** whole-body (the "one shot glass" rule), **2.03 g**
face and neck (the "half a teaspoon" rule), SPF 50 → **4.8** at observed
density, and index **5.4** at the shadow-rule zenith. Equation-of-time extremes
land within 0.1 minutes of published values; solstice declination within 0.01°.

## The model

```
UVI = 12.5 · μ₀^2.42 · (Ω/300)^−1.23 · (1/R²) · (1 + 0.08·h_km) · (1 + 0.35·a) · CMF
```

- **μ₀** cosine of solar zenith, from the NOAA low-precision algorithm
- **Ω** total column ozone, from the shipped latitude × month climatology
- **R** earth–sun distance in AU
- **a** ground albedo (grass 0.03, water 0.10, sand 0.20, fresh snow 0.80)
- **CMF** cloud factor. Broken cloud is **1.25**, which is *above* clear sky,
  because bright cloud edges scatter extra flux onto an unobscured sun disc

## Other verified results

**Reapplication is simulated, not assumed.** Certified-density SPF 50 while
swimming comes out at roughly every 40 minutes, which independently reproduces
the regulatory *"water resistant (40 minutes)"* rating.

**Delhi, 10:00–16:00, wheatish skin:**

| | coats | burn budget spent |
|---|---|---|
| Bare skin | none | **760%** |
| SPF 50 reapplied 4×, typical density | 4 | **197%** |
| SPF 50 reapplied 4×, certified density | 4 | **20%** |

You can reapply diligently four times and still burn, purely from applying too
thinly. The timetable was never the hard part.

**Air quality** was calibrated against 2590 paired (AOD, PM2.5) samples from 18
Indian cities. The literature-anchored constant was 1.9× too high; the fitted
value is 79. Anchoring to the live local reference cuts median error 32% → 22%.

---

## Decisions already settled. Don't reopen without reason

- **The body map and the home phototest were removed** (Aug 2026) to cut the
  page down. Both were real and both worked; the front page was simply carrying
  more than a reader will ever use, and the phototest asked someone to dose
  their own forearm to answer a question the app already estimates. The burn
  table came up out of *"Everything else"* onto the front page in the same
  pass. `anatomy.js` survives unloaded if the body map is ever wanted back.
- **The comb-shadow photo feature was removed.** It was tested in the field and
  failed: the friction far exceeds the value of the answer, and the answer
  rarely changes what anyone does. The spectral maths survives in
  `shade-meter.js`, which the Pigment Index and the bottle shape both need.
- **No modelled SPF is ever published against a named brand.** Testing rated a
  Tinosorb product "not broad-spectrum", which is almost certainly wrong. The
  absorbance curves are approximations, and a wrong modelled number attached to
  a real company is a defamatory claim. Named products show **label facts only**.
- **Never adversarial.** "Your SPF has no UVA filter" framing was rejected: it
  damages Umbra, closes every commercial door, and is mostly false here. All
  seven Indian products checked carry real UVA filters. The tone is *fit*, never
  *fault*. A bottle that peaks at noon is excellent at noon.
- **Every product entry needs a published source URL and a date**, because
  formulas get changed quietly.

## Honest limits

The filter absorbance curves are two-Gaussian approximations: **rankings and
directions are solid, exact figures are not.** The AOD→PM2.5 conversion is a
proxy, not a monitor. The engine carries no aerosol term, so clear-sky output
reads high against published forecasts. Nothing here is a laboratory, and
nothing here is medical advice.

## Next

Not more features. **Show it to five people and watch what they do.** Whether
"steadiness" lands or is one more number nobody asked for, whether "burning is
not your problem" reads as true or as insulting, and what they touch first.
