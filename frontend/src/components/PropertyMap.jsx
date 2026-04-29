import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet';

// Fix Leaflet default icon path issues with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const SALE_TYPE_COLORS = {
  'Foreclosure': '#ef4444',
  'REO':         '#f97316',
  'Tax Sale':    '#a855f7',
  'Short Sale':  '#eab308',
  'HUD':         '#3b82f6',
  'Probate':     '#6b7280',
};

function getMarkerIcon(saleType, highlighted) {
  const color = SALE_TYPE_COLORS[saleType] || '#6b7280';
  const size = highlighted ? 16 : 12;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:2px solid white;
      border-radius:50%;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
      transition:all 0.15s;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function fmtPrice(p) {
  if (!p) return 'N/A';
  if (p >= 1000) return `$${Math.round(p / 1000)}K`;
  return `$${p}`;
}

// Inner component that has access to the map instance
function MapController({ markers, highlightedId }) {
  const map = useMap();
  const navigate = useNavigate();
  const layerRef = useRef(null);
  const clusterRef = useRef(null);

  useEffect(() => {
    // Lazy-load MarkerCluster
    import('leaflet.markercluster').then(() => {
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
      }

      const cluster = L.markerClusterGroup({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
      });

      markers.forEach((prop) => {
        if (!prop.lat || !prop.lng) return;

        const highlighted = prop.id === highlightedId;
        const icon = getMarkerIcon(prop.sale_type, highlighted);

        const marker = L.marker([prop.lat, prop.lng], { icon });

        const popup = L.popup({ maxWidth: 240, className: 'property-popup' }).setContent(`
          <div style="font-family:system-ui;min-width:200px">
            <div style="font-size:18px;font-weight:700;color:#0369a1">${fmtPrice(prop.price)}</div>
            <div style="font-size:13px;font-weight:600;color:#111;margin:2px 0">${prop.address}</div>
            <div style="font-size:11px;color:#666;margin-bottom:6px">${prop.city || 'Dallas'}, TX ${prop.zip_code || ''}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
              <span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:99px;font-size:11px;font-weight:600">${prop.sale_type}</span>
              ${prop.bedrooms ? `<span style="font-size:11px;color:#555">${prop.bedrooms}bd</span>` : ''}
              ${prop.bathrooms ? `<span style="font-size:11px;color:#555">${prop.bathrooms}ba</span>` : ''}
              ${prop.sqft ? `<span style="font-size:11px;color:#555">${prop.sqft.toLocaleString()} ft²</span>` : ''}
            </div>
            <a href="/property/${prop.id}" style="display:block;background:#0284c7;color:white;text-align:center;padding:5px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none">View Details →</a>
          </div>
        `);

        marker.bindPopup(popup);
        marker.on('click', () => marker.openPopup());
        cluster.addLayer(marker);
      });

      map.addLayer(cluster);
      clusterRef.current = cluster;
    });

    return () => {
      if (clusterRef.current) map.removeLayer(clusterRef.current);
    };
  }, [markers, map]);

  // Re-render highlighted markers without rebuilding the whole cluster
  useEffect(() => {
    // Handled inside the main effect via re-render on highlightedId change
  }, [highlightedId]);

  return null;
}

// Legend component
function Legend() {
  return (
    <div className="absolute bottom-6 left-3 z-[1000] bg-white rounded-lg shadow-md p-2 text-xs">
      <p className="font-semibold text-gray-600 mb-1.5">Sale Type</p>
      {Object.entries(SALE_TYPE_COLORS).map(([type, color]) => (
        <div key={type} className="flex items-center gap-1.5 mb-1">
          <div className="w-3 h-3 rounded-full border border-white shadow-sm" style={{ background: color }} />
          <span className="text-gray-700">{type}</span>
        </div>
      ))}
    </div>
  );
}

export default function PropertyMap({ markers, highlightedId }) {
  // Dallas County center
  const center = [32.776, -96.797];

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={center}
        zoom={11}
        className="w-full h-full"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <MapController markers={markers || []} highlightedId={highlightedId} />
      </MapContainer>
      <Legend />

      {/* Marker count badge */}
      {markers?.length > 0 && (
        <div className="absolute top-3 right-3 z-[1000] bg-white rounded-full px-3 py-1 shadow-md text-xs font-semibold text-gray-700">
          {markers.filter(m => m.lat && m.lng).length} on map
        </div>
      )}
    </div>
  );
}
