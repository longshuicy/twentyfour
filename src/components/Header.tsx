import { useLang } from '../lib/i18n';

/**
 * The banner. Deliberately loud: it is the only branding the app has, and the
 * one thing on any screen allowed to shout. The language toggle rides along
 * on every screen that shows this banner, since that is every screen with
 * user-facing text.
 */
export function Header() {
  const { t, toggle } = useLang();
  return (
    <div className="banner">
      <button className="langswitch" onClick={toggle}>
        {t.langToggle}
      </button>
      <h1>TwentyFour</h1>
      <span className="tagline">{t.tagline}</span>
    </div>
  );
}
