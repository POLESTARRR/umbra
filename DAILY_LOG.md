# Daily Log

## 2026-10-12
EJS is configured as the view engine for server-side template rendering in `app.js`.

## 2026-10-12
The `calculateUVExposure()` function returns an object with dose, percentMED, and burnRisk based on UV index, skin type, and duration.

## 2026-10-12
UV exposure dose is calculated as a percentage of MED, allowing quantification of burn risk beyond categorical risk levels.

## 2026-10-15
The `express.json()` middleware is applied globally to parse JSON request bodies.

## 2026-10-20
SPF recommendations in `buildRecommendation()` are stratified by risk level and skin type: 15/30/50/50+ depending on conditions.

## 2026-10-21
The `app.js` Express entry point sets up a `/scan` POST endpoint that invokes the UV engine with request body parameters.

## 2026-10-23
The `getRiskLevel()` function implements WHO UV index thresholds: <3 low, 3-5 moderate, 6-7 high, 8-10 very-high, 11+ extreme.
