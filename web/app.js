/**
 * Padestrian map — Mapbox GL JS v3.
 * Token: /config.js (regenerated from .env on every serve start).
 */

const CENTER = [-75.6972, 45.4215];
const ZOOM   = 12.5;

const MAP_STYLE = {
  dark:  "mapbox://styles/mapbox/dark-v11",
  light: "mapbox://styles/mapbox/light-v11",
};

// Eligibility colours (match new design)
const COLOR_ELIGIBLE = "#f97316"; // orange  — walkable to both
const COLOR_GROCERY  = "#84cc16"; // lime    — grocery only
const COLOR_TRANSIT  = "#8b5cf6"; // violet  — transit only
const COLOR_NEITHER  = "#64748b"; // slate   — neither

const LAYER_GROUPS = {
  groceries: ["groceries-circle"],
  smoke:     ["smoke-zones-fill", "smoke-zones-outline", "smoke-centers"],
  stops:     ["stops-clusters", "stops-circle"],
};

const HOVER_LAYERS = [
  "listings-circle",
  "groceries-circle",
  "stops-circle",
  "stops-clusters",
  "smoke-centers",
  "smoke-zones-fill",
];

// UI elements
const rentSlider       = document.getElementById("filter-rent");
const rentDisplay      = document.getElementById("rent-display");
const statsTotalEl     = document.getElementById("stats-total");
const statsWalkableEl  = document.getElementById("stats-walkable");
const sidebarStatusEl  = document.getElementById("sidebar-status");
const walkableBadgeEl  = document.getElementById("header-walkable-badge");

let stopsAdded  = false;
let theme       = "dark";
const hoverBound = new Set();

// Persisted overlay data (needed to re-add layers after style reload)
let _listingsData  = null;
let _groceriesData = null;
let _smokeData     = null;
let _stopsData     = null;
let _hasScores     = false;

// Filter state
const filters = {
  walkableOnly: false,
  maxRent: Infinity,
  beds: "any",
};

// ─── Status helpers ──────────────────────────────────────────────────────────

function setStatus(msg) {
  if (sidebarStatusEl) sidebarStatusEl.textContent = msg;
}

function setStats(total, walkable) {
  if (statsTotalEl)    statsTotalEl.textContent    = `${total} listing${total !== 1 ? "s" : ""}`;
  if (statsWalkableEl) statsWalkableEl.textContent = `${walkable} walkable`;
  if (walkableBadgeEl) walkableBadgeEl.textContent = walkable ? `${walkable}` : "";
}

// ─── Token ───────────────────────────────────────────────────────────────────

function getToken() {
  const token = window.PADESTRIAN_MAPBOX_TOKEN;
  if (!token?.startsWith("pk.")) {
    throw new Error("No Mapbox token. Fix .env, restart serve, then hard-refresh.");
  }
  return token;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function getGeoJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing ${url}`);
  return res.json();
}

// ─── Layer visibility ────────────────────────────────────────────────────────

function setVisibility(map, group, visible) {
  for (const id of LAYER_GROUPS[group] || []) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }
}

// ─── HTML escape ─────────────────────────────────────────────────────────────

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Popup formatting ────────────────────────────────────────────────────────

function formatAddress(props) {
  const line1 = [props["addr:housenumber"], props["addr:street"]].filter(Boolean).join(" ");
  return [line1, props["addr:city"]].filter(Boolean).join(", ");
}

function formatPopup(feature) {
  const p      = feature.properties;
  const layerId = feature.layer.id;

  if (layerId === "stops-clusters") {
    return `<strong>${p.point_count.toLocaleString()}</strong> stops — click to zoom in`;
  }

  if (p.rent_cad != null) {
    const beds = p.bedrooms === 0 ? "Studio" : `${p.bedrooms} bed${p.bedrooms === 1 ? "" : "s"}`;
    const rent = Number(p.rent_cad).toLocaleString();
    let badge  = "";
    if (p.eligible)          badge = `<span class="popup-badge badge-walkable">Walkable ✓</span>`;
    else if (p.near_grocery) badge = `<span class="popup-badge badge-grocery">Grocery only</span>`;
    else if (p.near_transit) badge = `<span class="popup-badge badge-transit">Transit only</span>`;
    else if (p.near_grocery != null) badge = `<span class="popup-badge badge-neither">Not walkable</span>`;

    let html = `<span class="popup-title">${esc(p.title || p.address)}${badge}</span>`;
    html += `<div class="popup-sub">$${rent}/mo · ${esc(beds)}</div>`;
    if (p.neighborhood) html += `<div class="popup-address">${esc(p.neighborhood)}</div>`;
    if (p.address)      html += `<div class="popup-address">${esc(p.address)}</div>`;
    return html;
  }

  if (p.label) {
    if (p.walk_minutes != null) {
      return `<span class="popup-title">${esc(p.label)}</span><div class="popup-sub">${p.walk_minutes} min walk</div>`;
    }
    return `<span class="popup-title">${esc(p.label)}</span>`;
  }

  if (p.stop_name) {
    let html = `<span class="popup-title">${esc(p.stop_name)}</span>`;
    if (p.stop_id) html += `<div class="popup-sub">Stop ${esc(p.stop_id)}</div>`;
    return html;
  }

  if (p.name) {
    let html = `<span class="popup-title">${esc(p.name)}</span>`;
    if (p.shop) html += `<div class="popup-sub">${esc(p.shop)}</div>`;
    const addr = formatAddress(p);
    if (addr) html += `<div class="popup-address">${esc(addr)}</div>`;
    return html;
  }

  if (p.role === "transit_zone" || p.role === "grocery_zone") {
    const mins = p.walk_minutes != null ? `${p.walk_minutes} min walk` : "Walk zone";
    return `<span class="popup-title">${esc(p.label || p.role)}</span><div class="popup-sub">${esc(mins)}</div>`;
  }

  return Object.entries(p)
    .filter(([k, v]) => v != null && v !== "" && k !== "role")
    .slice(0, 6)
    .map(([k, v]) => `${esc(k)}: ${esc(v)}`)
    .join("<br>") || "No details";
}

// ─── Hover wiring ────────────────────────────────────────────────────────────

function wireHover(map) {
  if (!map._hoverPopup) {
    map._hoverPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
    });
  }
  const popup = map._hoverPopup;

  const show = (e) => {
    if (!e.features?.length) return;
    map.getCanvas().style.cursor = "pointer";
    popup.setLngLat(e.lngLat).setHTML(formatPopup(e.features[0])).addTo(map);
  };
  const hide = () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
  };

  for (const layerId of HOVER_LAYERS) {
    if (!map.getLayer(layerId) || hoverBound.has(layerId)) continue;
    hoverBound.add(layerId);
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, hide);
    map.on("mousemove",  layerId, show);
  }
}

// ─── Filter expression ───────────────────────────────────────────────────────

function buildListingFilter() {
  const exprs = ["all"];

  if (filters.walkableOnly) {
    exprs.push(["==", ["get", "eligible"], true]);
  }
  if (filters.maxRent < Infinity) {
    exprs.push(["<=", ["get", "rent_cad"], filters.maxRent]);
  }
  if (filters.beds !== "any") {
    const n = parseInt(filters.beds, 10);
    exprs.push(n >= 3 ? [">=", ["get", "bedrooms"], 3] : ["==", ["get", "bedrooms"], n]);
  }

  return exprs.length === 1 ? null : exprs;
}

function applyFilters(map) {
  if (!map.getLayer("listings-circle")) return;
  const expr = buildListingFilter();
  map.setFilter("listings-circle", expr);

  const allFeatures = _listingsData?.features ?? [];
  const total = allFeatures.length;

  // Count walkable (eligible) across all features
  const totalWalkable = allFeatures.filter((f) => f.properties?.eligible).length;
  setStats(total, totalWalkable);

  const visible = map.queryRenderedFeatures({ layers: ["listings-circle"] });
  const shownCount = new Set(visible.map((f) => f.id ?? f.properties?.id)).size;

  if (filters.walkableOnly && shownCount === 0) {
    setStatus("No eligible listings — run build-zones then filter-listings");
  } else if (expr) {
    setStatus(`${shownCount} listings match your filters`);
  } else {
    setStatus("Find your car-free apartment");
  }
}

// ─── Layer builders ──────────────────────────────────────────────────────────

function listingColor(hasScores) {
  if (!hasScores) {
    return [
      "interpolate", ["linear"], ["get", "rent_cad"],
      1200, "#22c55e",
      1900, "#eab308",
      2600, "#f97316",
      3400, "#dc2626",
    ];
  }
  return [
    "case",
    ["==", ["get", "eligible"],     true], COLOR_ELIGIBLE,
    ["==", ["get", "near_grocery"], true], COLOR_GROCERY,
    ["==", ["get", "near_transit"], true], COLOR_TRANSIT,
    COLOR_NEITHER,
  ];
}

function addListings(map, data) {
  if (map.getSource("listings")) return;
  const features  = data.features || [];
  const hasScores = features.length > 0 && features[0].properties?.eligible != null;

  map.addSource("listings", { type: "geojson", data });
  map.addLayer({
    id: "listings-circle",
    type: "circle",
    source: "listings",
    paint: {
      "circle-radius": 8,
      "circle-color": listingColor(hasScores),
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(0,0,0,0.25)",
      "circle-opacity": 0.92,
    },
  });

  const walkable = features.filter((f) => f.properties?.eligible).length;
  setStats(features.length, walkable);
  return hasScores;
}

function addGroceries(map, data) {
  if (map.getSource("groceries")) return;
  map.addSource("groceries", { type: "geojson", data });
  map.addLayer({
    id: "groceries-circle",
    type: "circle",
    source: "groceries",
    paint: {
      "circle-radius": 7,
      "circle-color": COLOR_GROCERY,
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(0,0,0,0.25)",
    },
  });
}

function addSmoke(map, data) {
  if (map.getSource("smoke")) return;
  map.addSource("smoke", { type: "geojson", data });
  const zones = ["in", ["get", "role"], ["literal", ["transit_zone", "grocery_zone"]]];
  map.addLayer({
    id: "smoke-zones-fill",
    type: "fill",
    source: "smoke",
    filter: zones,
    paint: {
      "fill-color": ["match", ["get", "role"], "transit_zone", COLOR_TRANSIT, "grocery_zone", COLOR_GROCERY, "#94a3b8"],
      "fill-opacity": 0.18,
    },
  });
  map.addLayer({
    id: "smoke-zones-outline",
    type: "line",
    source: "smoke",
    filter: zones,
    paint: { "line-width": 1.5, "line-color": ["match", ["get", "role"], "transit_zone", COLOR_TRANSIT, COLOR_GROCERY] },
  });
  map.addLayer({
    id: "smoke-centers",
    type: "circle",
    source: "smoke",
    filter: ["==", ["get", "role"], "center"],
    paint: {
      "circle-radius": 5,
      "circle-color": ["match", ["get", "kind"], "transit", COLOR_TRANSIT, COLOR_GROCERY],
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(0,0,0,0.25)",
    },
  });
}

function addStops(map, data) {
  if (map.getSource("stops")) return;
  map.addSource("stops", { type: "geojson", data, cluster: true, clusterMaxZoom: 13, clusterRadius: 45 });
  map.addLayer({
    id: "stops-clusters",
    type: "circle",
    source: "stops",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": COLOR_TRANSIT,
      "circle-radius": ["step", ["get", "point_count"], 14, 50, 20, 200, 26],
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(0,0,0,0.25)",
    },
  });
  map.addLayer({
    id: "stops-circle",
    type: "circle",
    source: "stops",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": 4,
      "circle-color": COLOR_TRANSIT,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(0,0,0,0.25)",
    },
  });
}

async function ensureStops(map) {
  if (stopsAdded) return;
  if (!_stopsData) _stopsData = await getGeoJson("/data/stops.geojson");
  addStops(map, _stopsData);
  stopsAdded = true;
  wireHover(map);
  map.on("click", "stops-clusters", (e) => {
    const id = e.features[0].properties.cluster_id;
    map.getSource("stops").getClusterExpansionZoom(id, (err, z) => {
      if (!err) map.easeTo({ center: e.lngLat, zoom: z });
    });
  });
}

// ─── Re-add all layers (called after theme/style reload) ─────────────────────

function reloadLayers(map) {
  hoverBound.clear();
  stopsAdded = false;

  if (_listingsData) {
    addListings(map, _listingsData);
    const expr = buildListingFilter();
    if (expr) map.setFilter("listings-circle", expr);
  }
  if (_groceriesData) addGroceries(map, _groceriesData);
  if (_smokeData)     addSmoke(map, _smokeData);

  // Re-apply layer visibility from toggle checkboxes
  for (const id of Object.keys(LAYER_GROUPS)) {
    const box = document.getElementById(`layer-${id}`);
    if (box) setVisibility(map, id, box.checked);
  }

  if (stopsAdded && _stopsData) addStops(map, _stopsData);

  wireHover(map);
}

// ─── Filter UI wiring ────────────────────────────────────────────────────────

function wireFilters(map) {
  const walkableBox = document.getElementById("filter-walkable");
  walkableBox?.addEventListener("change", () => {
    filters.walkableOnly = walkableBox.checked;
    applyFilters(map);
  });

  rentSlider?.addEventListener("input", () => {
    const val   = parseInt(rentSlider.value, 10);
    const min   = parseInt(rentSlider.min, 10);
    const max   = parseInt(rentSlider.max, 10);
    const isMax = val >= max;
    filters.maxRent = isMax ? Infinity : val;
    if (rentDisplay) rentDisplay.textContent = isMax ? "Any" : `$${val.toLocaleString()}`;
    // Update CSS track fill
    const pct = ((val - min) / (max - min)) * 100;
    rentSlider.style.setProperty("--slider-pct", `${pct}%`);
    applyFilters(map);
  });

  document.querySelectorAll(".bed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".bed-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filters.beds = btn.dataset.beds;
      applyFilters(map);
    });
  });
}

// ─── Layer toggles ───────────────────────────────────────────────────────────

function wireToggles(map) {
  for (const id of Object.keys(LAYER_GROUPS)) {
    const box = document.getElementById(`layer-${id}`);
    if (!box) continue;
    box.onchange = () => {
      (async () => {
        if (id === "stops" && box.checked) await ensureStops(map);
        setVisibility(map, id, box.checked);
      })().catch((err) => setStatus(err.message));
    };
    setVisibility(map, id, box.checked);
  }
}

// ─── Theme toggle ────────────────────────────────────────────────────────────

function wireThemeToggle(map) {
  const btn     = document.getElementById("theme-toggle");
  const iconMoon = document.getElementById("icon-moon");
  const iconSun  = document.getElementById("icon-sun");
  if (!btn) return;

  btn.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");

    iconMoon.style.display = theme === "dark" ? "block" : "none";
    iconSun.style.display  = theme === "dark" ? "none"  : "block";

    map.setStyle(MAP_STYLE[theme]);
    map.once("style.load", () => reloadLayers(map));
  });
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function wireSidebar() {
  const sidebar      = document.getElementById("sidebar");
  const openBtn      = document.getElementById("sidebar-open-btn");
  const closeBtn     = document.getElementById("sidebar-close-btn");
  const collapseTab  = document.getElementById("sidebar-collapse-tab");
  const backdrop     = document.getElementById("sidebar-backdrop");

  function open() {
    sidebar.classList.add("open");
    openBtn.classList.add("hidden");
    backdrop.classList.add("visible");
  }
  function close() {
    sidebar.classList.remove("open");
    openBtn.classList.remove("hidden");
    backdrop.classList.remove("visible");
  }

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  collapseTab?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);
}

// ─── Overlay loader ──────────────────────────────────────────────────────────

async function loadOverlays(map) {
  // Prefer scored listings; fall back to unscored
  for (const url of ["/data/listings-scored.geojson", "/data/listings.geojson"]) {
    try {
      _listingsData = await getGeoJson(url);
      _hasScores    = url.includes("scored");
      break;
    } catch (_) { /* try next */ }
  }

  if (_listingsData) {
    addListings(map, _listingsData);
  } else {
    setStatus("No listings found — run seed-listings & validate-listings");
  }

  try {
    _groceriesData = await getGeoJson("/data/groceries-points.geojson");
    addGroceries(map, _groceriesData);
  } catch (e) {
    console.warn(e);
    const el = document.getElementById("layer-groceries");
    if (el) { el.checked = false; }
  }

  try {
    _smokeData = await getGeoJson("/data/isochrones/smoke.geojson");
    addSmoke(map, _smokeData);
  } catch (e) {
    console.warn(e);
    const el = document.getElementById("layer-smoke");
    if (el) { el.disabled = true; el.checked = false; }
  }

  wireHover(map);
  wireToggles(map);
  wireFilters(map);

  const total    = _listingsData?.features?.length ?? 0;
  const eligible = _listingsData?.features?.filter((f) => f.properties?.eligible).length ?? 0;

  if (_hasScores && total) {
    setStats(total, eligible);
    setStatus("Find your car-free apartment");
  } else if (total) {
    setStats(total, 0);
    setStatus("Run filter-listings to score listings");
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  try {
    mapboxgl.accessToken = getToken();

    // Apply dark theme class on initial load
    document.documentElement.classList.add("dark");

    // Init slider fill to 100% (max = "Any")
    if (rentSlider) rentSlider.style.setProperty("--slider-pct", "100%");

    wireSidebar();

    const map = new mapboxgl.Map({
      container: "map",
      style: MAP_STYLE.dark,
      center: CENTER,
      zoom: ZOOM,
    });

    // Navigation controls: bottom-right (away from sidebar and theme btn)
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    window.addEventListener("resize", () => map.resize());
    map.on("error", (e) => console.warn("[mapbox]", e.error));

    wireThemeToggle(map);

    map.once("load", () => {
      map.resize();
      loadOverlays(map).catch((err) => setStatus(err.message));
    });
  } catch (err) {
    console.error(err);
    setStatus(err.message);
  }
}

main();
