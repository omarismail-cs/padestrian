// Ottawa-area full-size groceries for Padestrian
// Paste into https://overpass-turbo.eu/ → Run → Export → GeoJSON → save as data/groceries.geojson
// Or run: python -m padestrian fetch-groceries

[out:json][timeout:180];
(
  nwr["shop"="supermarket"](45.10,-76.35,45.55,-74.95);
  nwr["shop"="wholesale"](45.10,-76.35,45.55,-74.95);
);
out center tags;
