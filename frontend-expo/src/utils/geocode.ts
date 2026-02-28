const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const HEADERS = { 'User-Agent': 'RouteRunner/1.0' };

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`,
      { headers: HEADERS },
    );
    const data = await res.json();
    if (!data.display_name) return 'Your Location';
    // Return first 2-3 parts (street, neighborhood, city)
    const parts = data.display_name.split(', ');
    return parts.slice(0, 3).join(', ');
  } catch {
    return 'Your Location';
  }
}

export async function forwardGeocode(query: string): Promise<{ name: string; lat: number; lng: number }[]> {
  try {
    const res = await fetch(
      `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&limit=8&addressdetails=1`,
      { headers: HEADERS },
    );
    const data = await res.json();
    return data.map((item: any) => ({
      name: item.display_name.split(', ').slice(0, 3).join(', '),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));
  } catch {
    return [];
  }
}
