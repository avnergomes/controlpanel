/**
 * LangSwitcher — React component dropped into every panel dashboard.
 *
 * Reads ?lang= from URL or localStorage, persists the user's choice and
 * reloads with the new ?lang= so the global i18n.js (loaded as a static
 * script in index.html) picks it up on the next paint. Cross-origin safe.
 */
import { useEffect, useState } from 'react';

const SUPPORTED = ['pt', 'en', 'es'];
const STORAGE_KEY = 'dgp-lang';

const LABELS = {
  pt: { flag: '🇧🇷', code: 'PT', full: 'Português' },
  en: { flag: '🇺🇸', code: 'EN', full: 'English' },
  es: { flag: '🇪🇸', code: 'ES', full: 'Español' },
};

function detect() {
  try {
    const u = new URL(window.location.href);
    const q = (u.searchParams.get('lang') || '').toLowerCase();
    if (SUPPORTED.includes(q)) return q;
  } catch (_) {}
  try {
    const s = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
    if (SUPPORTED.includes(s)) return s;
  } catch (_) {}
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return SUPPORTED.includes(nav) ? nav : 'pt';
}

export default function LangSwitcher({ variant = 'light', compact = false }) {
  const [lang, setLang] = useState(() => detect());

  useEffect(() => {
    const htmlLang = lang === 'pt' ? 'pt-BR' : lang === 'en' ? 'en-US' : 'es-ES';
    try { document.documentElement.setAttribute('lang', htmlLang); } catch (_) {}
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
  }, [lang]);

  function pick(next) {
    if (next === lang) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('lang', next);
      window.location.href = u.toString();
      return;
    } catch (_) {}
    setLang(next);
  }

  const cls = `lang-switcher ${variant === 'dark' ? 'lang-switcher--dark' : ''} ${variant === 'obs' ? 'lang-switcher--obs' : ''}`.trim();

  return (
    <div className={cls} role="group" aria-label="Language">
      {SUPPORTED.map((code) => {
        const meta = LABELS[code];
        const active = code === lang;
        return (
          <button
            key={code}
            type="button"
            className={`lang-chip ${active ? 'is-active' : ''}`}
            aria-pressed={active}
            title={meta.full}
            onClick={() => pick(code)}
          >
            {!compact && <span className="lang-flag" aria-hidden="true">{meta.flag}</span>}
            <span className="lang-code">{meta.code}</span>
          </button>
        );
      })}
    </div>
  );
}
