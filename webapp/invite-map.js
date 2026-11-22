// The venue on a Leaflet map (vendored 1.9.4, OpenStreetMap tiles) with a gold pin drawn in CSS,
// and the "Yo'l ko'rsatish" link that opens directions in the phone's maps app.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export function routeUrl(lat, lon) {
  const y = Number(lat).toFixed(6);
  const x = Number(lon).toFixed(6);
  return `https://yandex.uz/maps/?rtext=~${y},${x}&rtt=auto`;
}

export function venueMap(el, lat, lon, title) {
  const L = window.L;
  if (!L || lat === null || lon === null) return null;
  const map = L.map(el, { zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile, tapTolerance: 20 })
    .setView([lat, lon], 15);
  L.tileLayer(TILES, { maxZoom: 18, minZoom: 10, attribution: ATTR, crossOrigin: true }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const icon = L.divIcon({ className: 'inv-pin', html: '<span></span>', iconSize: [34, 44], iconAnchor: [17, 42] });
  L.marker([lat, lon], { icon, title, keyboard: false }).addTo(map);
  const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
  ro.observe(el);
  return { destroy: () => { ro.disconnect(); map.remove(); } };
}
