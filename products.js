/* ===========================================================================
   UMBRA / products.js

   A searchable list of sunscreens sold in India, with the UV filters each one
   PUBLISHES on its label.

   THE RULE THIS FILE EXISTS TO ENFORCE
     For a named product we report only what the label says, and which of those
     filters are UVA filters. That is a quotation plus a lookup, and both are
     verifiable by anyone holding the bottle.

     We do NOT publish a modelled SPF, UVA-PF or critical wavelength against a
     brand name. Testing showed exactly why: the approximate absorption curves
     in filters.js rated a Tinosorb S + Tinosorb A2B product as "not broad
     spectrum", which is almost certainly wrong. A wrong modelled number
     attached to a real company is a defamatory claim, and the model is not
     good enough to carry one. The modelled figures stay in the manual
     tick-box mode, where they describe a filter SET, not a product.

   EVERY ENTRY MUST CARRY
     source   a public URL where the ingredient list is published
     checked  the date it was read, because formulas get changed quietly

   Anything without both of those does not go in.
   =========================================================================== */

(function (global) {
  'use strict';

  var PRODUCTS = [
    {
      brand: 'Dot & Key',
      name: 'Barrier Repair Sunscreen SPF 50+ PA++++',
      filters: ['octinoxate', 'avobenzone', 'oxybenzone', 'uvinulA', 'titanium', 'octisalate'],
      source: 'https://incidecoder.com/products/dot-key-barrier-repair-sunscreen-spf-50-pa',
      checked: '2026-08-10'
    },
    {
      brand: "Re'equil",
      name: 'Sunscreen',
      filters: ['octocrylene', 'trisbiphenyl', 'octisalate', 'tinosorbS'],
      source: 'https://incidecoder.com/products/reequil-sunscreen',
      checked: '2026-08-10'
    },
    {
      brand: "Re'equil",
      name: 'Sheer Zinc Tinted Mineral Sunscreen SPF 50 PA+++',
      filters: ['zincoxide', 'ironoxide'],
      source: 'https://incidecoder.com/products/reequil-sheer-zinc-tinted-mineral-sunscreen-spf-50-pa',
      checked: '2026-08-10'
    },
    {
      brand: 'Minimalist',
      name: 'SPF 50 Sunscreen PA++++',
      filters: ['octocrylene', 'avobenzone', 'titanium', 'uvinulT150'],
      source: 'https://incidecoder.com/products/be-minimalist-spf-50-sunscreen-pa',
      checked: '2026-08-10'
    },
    {
      brand: 'The Derma Co',
      name: '1% Hyaluronic Sunscreen Aqua Gel SPF 50 PA++++',
      filters: ['octinoxate', 'avobenzone', 'oxybenzone', 'zincoxide', 'titanium'],
      source: 'https://incidecoder.com/products/the-derma-co-1-hyaluronic-sunscreen-aqua-gel-with-spf-50-pa-for-broad-spectrum',
      checked: '2026-08-10'
    },
    {
      brand: 'Foxtale',
      name: 'Coverup Sunscreen',
      filters: ['uvinulA', 'octinoxate', 'trisbiphenyl', 'uvinulT150', 'octocrylene', 'tinosorbS'],
      source: 'https://incidecoder.com/products/foxtale-coverup-sunscreen',
      checked: '2026-08-10'
    },
    {
      brand: 'Aqualogica',
      name: 'Glow+ Infused Sunscreen',
      filters: ['octinoxate', 'homosalate', 'octisalate', 'zincoxide', 'tinosorbS'],
      source: 'https://incidecoder.com/products/aqualogica-glow-infused-sunscreen',
      checked: '2026-08-10'
    }
  ];

  /* Anything the user adds themselves, kept on their device and merged into
     search. Same rule applies: a source and a date, or it does not count. */
  function userProducts() {
    try { return JSON.parse(localStorage.getItem('umbra-products') || '[]'); }
    catch (e) { return []; }
  }
  function addProduct(p) {
    var list = userProducts();
    p.mine = true;
    list.push(p);
    try { localStorage.setItem('umbra-products', JSON.stringify(list)); } catch (e) {}
    return list;
  }
  function removeProduct(i) {
    var list = userProducts();
    list.splice(i, 1);
    try { localStorage.setItem('umbra-products', JSON.stringify(list)); } catch (e) {}
    return list;
  }
  function all() { return PRODUCTS.concat(userProducts()); }

  function search(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return all();
    return all().filter(function (p) {
      return (p.brand + ' ' + p.name).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* Label-derived facts only. No modelling. */
  function factsFor(p) {
    var F = global.Filters;
    if (!F) return null;
    var known = [], unknown = [];
    p.filters.forEach(function (k) {
      if (F.BY_KEY[k]) known.push(F.BY_KEY[k]); else unknown.push(k);
    });

    var uva = known.filter(function (f) { return f.uva; });
    var uvb = known.filter(function (f) { return !f.uva && !f.visible; });
    var vis = known.filter(function (f) { return f.visible; });
    var hasAvo = p.filters.indexOf('avobenzone') >= 0;
    var partners = known.filter(function (f) { return f.stab; });
    var hasOctinoxate = p.filters.indexOf('octinoxate') >= 0;

    var notes = [];
    if (!uva.length) {
      notes.push({ level: 'severe', text: 'Nothing on this label blocks UVA. It will stop you burning and do very little about tanning or dark spots.' });
    } else {
      notes.push({ level: 'good', text: uva.length + ' of the listed filters block UVA: ' + uva.map(function (f) { return f.name; }).join(', ') + '.' });
    }
    if (hasAvo && !partners.length) {
      notes.push({ level: 'warn', text: 'Avobenzone is listed with none of the usual stabilising partners. A formula can stabilise it in ways a label does not show, so treat this as a question to ask rather than a fault.' });
    }
    if (hasAvo && hasOctinoxate) {
      notes.push({ level: 'warn', text: 'Avobenzone and octinoxate appear together. Octinoxate is known to speed up avobenzone’s breakdown in sunlight.' });
    }
    if (vis.length) {
      notes.push({ level: 'good', text: 'Contains iron oxides, so it also blocks some visible light, the part that matters for melasma.' });
    }
    return { uva: uva, uvb: uvb, visible: vis, unknown: unknown, notes: notes };
  }

  global.Products = { PRODUCTS: PRODUCTS, all: all, search: search, factsFor: factsFor,
                      userProducts: userProducts, addProduct: addProduct, removeProduct: removeProduct };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Products;
})(typeof globalThis !== 'undefined' ? globalThis : this);
