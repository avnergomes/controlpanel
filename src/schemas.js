// Column-name aliases per spreadsheet "kind". Lookups are case-insensitive, so aliases
// only need to cover genuinely different spellings, not casing variants.
//
// Every site that uses the unified LGPD tracker ("Tracking LGPD" sheet, 19 anonymous
// columns) shares the `lgpd` schema. Older sites keep their historical column names.

const LGPD_BASE = Object.freeze({
  timestamp: ["timestamp"],
  url: ["page", "url"],
  path: ["pathname", "path"],
  referrer: ["referrer"],
  timezone: ["timezone"],
  timezoneOffset: ["timezoneOffset", "timezone offset"],
  sessionId: [],
  userAgent: [],
  os: [],
  browser: [],
  deviceType: ["deviceType", "device type", "dispositivo", "device"],
  language: ["language", "idioma"],
  screenWidth: [],
  screenHeight: [],
  connectionType: ["connectionType", "connection type"],
  loadTime: ["loadTime", "load time"],
  firstContentfulPaint: [],
  domInteractiveTime: [],
  isMobile: [],
  utmSource: ["utmSource", "utm source"],
  utmMedium: ["utmMedium", "utm medium"],
  utmCampaign: ["utmCampaign", "utm campaign"],
  utmTerm: ["utmTerm", "utm term"],
  utmContent: ["utmContent", "utm content"],
  pageTitle: ["pageTitle", "page title", "title"],
  screenOrientation: ["screenOrientation", "screen orientation"],
  prefersColorScheme: ["prefersColorScheme", "prefers color scheme", "colorScheme"],
});

const withOverrides = (overrides) => Object.freeze({ ...LGPD_BASE, ...overrides });

export const FIELD_SCHEMAS = Object.freeze({
  lgpd: LGPD_BASE,

  datageo: withOverrides({
    sessionId: ["sessionId", "session id"],
    userAgent: ["userAgent", "user agent"],
    screenWidth: ["screenWidth", "screen width"],
    screenHeight: ["screenHeight", "screen height"],
    firstContentfulPaint: ["firstContentfulPaint"],
    domInteractiveTime: ["domInteractiveTime"],
    isMobile: ["isMobile", "is mobile"],
  }),

  portfolio: withOverrides({
    timestamp: ["client timestamp", "timestamp"],
    url: ["page url", "url", "page"],
    sessionId: ["session id", "sessionId"],
    userAgent: ["user agent", "userAgent"],
    os: ["os", "sistema operacional"],
    browser: ["browser", "navegador"],
    screenWidth: ["screen width", "screenWidth", "screenResolution"],
    screenHeight: ["screen height", "screenHeight"],
    loadTime: ["page load time (ms)", "page load time", "pageLoadTime", "loadTime"],
    firstContentfulPaint: ["first contentful paint", "firstContentfulPaint"],
    domInteractiveTime: ["dom interactive time", "domInteractiveTime"],
    isMobile: ["isMobile", "is mobile"],
  }),

  precos: withOverrides({
    url: ["url", "page"],
    path: ["caminho", "pathname", "path"],
    sessionId: ["session id", "sessionId"],
    userAgent: ["user agent", "userAgent"],
    os: ["os", "sistema operacional"],
    browser: ["browser", "navegador"],
    screenWidth: ["screenWidth", "screen width"],
    screenHeight: ["screenHeight", "screen height"],
    firstContentfulPaint: ["firstContentfulPaint", "first contentful paint"],
    domInteractiveTime: ["domInteractiveTime", "dom interactive time"],
    isMobile: ["isMobile", "is mobile"],
  }),

  comex: withOverrides({
    sessionId: ["sessionId", "session id"],
    userAgent: ["userAgent", "user agent"],
    screenWidth: ["screenWidth", "screen width"],
    screenHeight: ["screenHeight", "screen height"],
    firstContentfulPaint: ["firstContentfulPaint"],
    domInteractiveTime: ["domInteractiveTime"],
    isMobile: ["isMobile", "is mobile"],
  }),

  emprego: withOverrides({
    sessionId: ["sessionId", "session id"],
    utmTerm: [],
    utmContent: [],
    pageTitle: [],
  }),

  vbp: withOverrides({
    timestamp: ["timestamp", "date"],
    url: ["url", "page url", "page"],
    timezone: ["timezone", "fuso horario", "fuso horário", "fuso", "time zone", "tz", "k"],
    timezonePattern: /(fuso|time\s*zone|timezone|tz)/i,
    sessionId: ["sessionId", "session id"],
    userAgent: ["userAgent", "user agent"],
    os: ["os", "sistema operacional"],
    browser: ["browser", "navegador"],
    screenWidth: ["screenWidth", "screen width"],
    screenHeight: ["screenHeight", "screen height"],
    firstContentfulPaint: ["firstContentfulPaint", "first contentful paint"],
    domInteractiveTime: ["domInteractiveTime", "dom interactive time"],
    isMobile: ["isMobile", "is mobile"],
  }),
});

// "Returning visitor" flags only exist in legacy sheets; the LGPD tracker does not
// fingerprint visitors, so the field is absent for newer sites (and never inferred).
export const RETURNING_FIELDS = Object.freeze([
  "returning visitor", "returning", "returningvisitor", "returning_visitor",
  "is returning", "isreturning", "is_returning",
  "visitante recorrente", "retornando", "retorno",
]);
export const RETURNING_PATTERN = /(return|retorn)/i;
