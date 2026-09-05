// Time-zone helpers: region labels for the UI and UTC offsets for the world map.
// Only aggregated zones are ever shown (LGPD: no per-visitor geolocation exists).

export const TIMEZONE_REGIONS = Object.freeze({
  "America/Sao_Paulo": { region: "Brasil", subregion: "Sudeste/Sul", flag: "🇧🇷" },
  "America/Cuiaba": { region: "Brasil", subregion: "Centro-Oeste", flag: "🇧🇷" },
  "America/Campo_Grande": { region: "Brasil", subregion: "Centro-Oeste", flag: "🇧🇷" },
  "America/Manaus": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Belem": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Porto_Velho": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Boa_Vista": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Rio_Branco": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Araguaina": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Santarem": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Eirunepe": { region: "Brasil", subregion: "Norte", flag: "🇧🇷" },
  "America/Recife": { region: "Brasil", subregion: "Nordeste", flag: "🇧🇷" },
  "America/Fortaleza": { region: "Brasil", subregion: "Nordeste", flag: "🇧🇷" },
  "America/Bahia": { region: "Brasil", subregion: "Nordeste", flag: "🇧🇷" },
  "America/Maceio": { region: "Brasil", subregion: "Nordeste", flag: "🇧🇷" },
  "America/Noronha": { region: "Brasil", subregion: "Nordeste", flag: "🇧🇷" },
  "America/New_York": { region: "EUA", subregion: "Leste", flag: "🇺🇸" },
  "America/Detroit": { region: "EUA", subregion: "Leste", flag: "🇺🇸" },
  "America/Chicago": { region: "EUA", subregion: "Centro", flag: "🇺🇸" },
  "America/Denver": { region: "EUA", subregion: "Montanhas", flag: "🇺🇸" },
  "America/Phoenix": { region: "EUA", subregion: "Montanhas", flag: "🇺🇸" },
  "America/Los_Angeles": { region: "EUA", subregion: "Oeste", flag: "🇺🇸" },
  "America/Toronto": { region: "Canadá", subregion: "Leste", flag: "🇨🇦" },
  "America/Vancouver": { region: "Canadá", subregion: "Oeste", flag: "🇨🇦" },
  "America/Mexico_City": { region: "México", subregion: "Centro", flag: "🇲🇽" },
  "America/Buenos_Aires": { region: "Argentina", subregion: "", flag: "🇦🇷" },
  "America/Argentina/Buenos_Aires": { region: "Argentina", subregion: "", flag: "🇦🇷" },
  "America/Santiago": { region: "Chile", subregion: "", flag: "🇨🇱" },
  "America/Lima": { region: "Peru", subregion: "", flag: "🇵🇪" },
  "America/Bogota": { region: "Colômbia", subregion: "", flag: "🇨🇴" },
  "America/Montevideo": { region: "Uruguai", subregion: "", flag: "🇺🇾" },
  "America/Asuncion": { region: "Paraguai", subregion: "", flag: "🇵🇾" },
  "America/La_Paz": { region: "Bolívia", subregion: "", flag: "🇧🇴" },
  "America/Caracas": { region: "Venezuela", subregion: "", flag: "🇻🇪" },
  "Europe/London": { region: "Reino Unido", subregion: "", flag: "🇬🇧" },
  "Europe/Dublin": { region: "Irlanda", subregion: "", flag: "🇮🇪" },
  "Europe/Paris": { region: "França", subregion: "", flag: "🇫🇷" },
  "Europe/Berlin": { region: "Alemanha", subregion: "", flag: "🇩🇪" },
  "Europe/Madrid": { region: "Espanha", subregion: "", flag: "🇪🇸" },
  "Europe/Lisbon": { region: "Portugal", subregion: "", flag: "🇵🇹" },
  "Europe/Rome": { region: "Itália", subregion: "", flag: "🇮🇹" },
  "Europe/Amsterdam": { region: "Países Baixos", subregion: "", flag: "🇳🇱" },
  "Europe/Brussels": { region: "Bélgica", subregion: "", flag: "🇧🇪" },
  "Europe/Zurich": { region: "Suíça", subregion: "", flag: "🇨🇭" },
  "Europe/Vienna": { region: "Áustria", subregion: "", flag: "🇦🇹" },
  "Europe/Stockholm": { region: "Suécia", subregion: "", flag: "🇸🇪" },
  "Europe/Oslo": { region: "Noruega", subregion: "", flag: "🇳🇴" },
  "Europe/Copenhagen": { region: "Dinamarca", subregion: "", flag: "🇩🇰" },
  "Europe/Warsaw": { region: "Polônia", subregion: "", flag: "🇵🇱" },
  "Europe/Prague": { region: "Tchéquia", subregion: "", flag: "🇨🇿" },
  "Europe/Moscow": { region: "Rússia", subregion: "", flag: "🇷🇺" },
  "Asia/Tokyo": { region: "Japão", subregion: "", flag: "🇯🇵" },
  "Asia/Shanghai": { region: "China", subregion: "", flag: "🇨🇳" },
  "Asia/Hong_Kong": { region: "Hong Kong", subregion: "", flag: "🇭🇰" },
  "Asia/Singapore": { region: "Singapura", subregion: "", flag: "🇸🇬" },
  "Asia/Kolkata": { region: "Índia", subregion: "", flag: "🇮🇳" },
  "Asia/Calcutta": { region: "Índia", subregion: "", flag: "🇮🇳" },
  "Asia/Dubai": { region: "Emirados Árabes", subregion: "", flag: "🇦🇪" },
  "Asia/Seoul": { region: "Coreia do Sul", subregion: "", flag: "🇰🇷" },
  "Asia/Jakarta": { region: "Indonésia", subregion: "", flag: "🇮🇩" },
  "Australia/Sydney": { region: "Austrália", subregion: "Leste", flag: "🇦🇺" },
  "Australia/Melbourne": { region: "Austrália", subregion: "Leste", flag: "🇦🇺" },
  "Australia/Perth": { region: "Austrália", subregion: "Oeste", flag: "🇦🇺" },
  "Pacific/Auckland": { region: "Nova Zelândia", subregion: "", flag: "🇳🇿" },
  "Africa/Johannesburg": { region: "África do Sul", subregion: "", flag: "🇿🇦" },
  "Africa/Lagos": { region: "Nigéria", subregion: "", flag: "🇳🇬" },
  "Africa/Luanda": { region: "Angola", subregion: "", flag: "🇦🇴" },
  "Africa/Maputo": { region: "Moçambique", subregion: "", flag: "🇲🇿" },
  "Africa/Cairo": { region: "Egito", subregion: "", flag: "🇪🇬" },
});

const UNKNOWN = Object.freeze({ region: "Desconhecido", subregion: "", flag: "🌐" });
const OTHER = Object.freeze({ region: "Outros", subregion: "", flag: "🌍" });

export function regionOf(timezone) {
  if (!timezone) return UNKNOWN;
  const known = TIMEZONE_REGIONS[timezone];
  if (known) return known;
  const [area] = String(timezone).split("/");
  return { ...OTHER, subregion: area || "" };
}

export function isBrazil(timezone) {
  return regionOf(timezone).region === "Brasil";
}

// Coarse split used by the overview: Brasil / Exterior / Desconhecido.
export function geoBucket(timezone) {
  if (!timezone) return "Desconhecido";
  return isBrazil(timezone) ? "Brasil" : "Exterior";
}

const offsetCache = new Map();

// Current UTC offset (hours, may be fractional) of an IANA zone; null when unknown.
export function utcOffsetOf(timezone) {
  if (!timezone) return null;
  if (offsetCache.has(timezone)) return offsetCache.get(timezone);
  let offset = null;
  try {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    offset = (local - utc) / 3600000;
  } catch {
    offset = null;
  }
  offsetCache.set(timezone, offset);
  return offset;
}

// Minutes east of UTC for the reference zone (e.g. America/Sao_Paulo = -180).
export function zoneOffsetMinutes(timezone, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    return -at.getTimezoneOffset();
  }
}
