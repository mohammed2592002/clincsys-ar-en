import React, { useEffect, useMemo, useState } from 'react';
import { db, doc, getDocSmart } from '../dbClient';
import {
  LandingSiteContent, LandingTexts, LandingFeature, LandingStat, LandingStep, LandingPlan, LandingPain,
  mergeLandingContent
} from '../types';
import './landing.css';

// Load the landing display fonts once (Arabic + English + handwritten).
const FONT_LINK_ID = 'landing-fonts';
function ensureLandingFonts() {
  if (document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&family=El+Messiri:wght@500;600;700&family=Lemonada:wght@400;500;600&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Karla:wght@400;600;700;800&family=Caveat:wght@500;600&display=swap';
  document.head.appendChild(link);
}

// Preserve editor copy without interpreting HTML or collapsing spaces/newlines.
function Copy({ children }: { children: string }) {
  return <span className="lp-copy">{children}</span>;
}

// Hand-drawn check used next to hero points and plan features.
function HandCheck() {
  return (
    <svg className="ck" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 11 C 6 13.5, 7 15, 8.5 16.5 C 11 12.5, 14 8, 17 4.5" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

// Loose hand-drawn underline for headlines.
function HandUnderline({ light }: { light?: boolean }) {
  return (
    <svg viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M3 9 C 30 3, 55 12, 82 8 S 135 4, 162 9 S 205 12, 217 7"
        fill="none"
        stroke={light ? '#F2FAF6' : 'var(--accent)'}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Hand-drawn arrow pointing at the hero screenshot note.
function HandArrow() {
  return (
    <svg viewBox="0 0 60 60" aria-hidden="true">
      <path d="M50 6 C 44 26, 34 40, 14 48 M 26 42 L 13 49 L 22 56" fill="none" stroke="var(--accent-deep)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BrowserBar() {
  return (
    <div className="bar"><i></i><i></i><i></i></div>
  );
}

function PulseLogo({ size = 42 }: { size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center"
      style={{ width: size, height: size, background: 'var(--ink)', border: '1px solid var(--line)' }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none">
        <path d="M3 12h4l2.5-6 3.5 12 2.5-6H21" stroke="#F4FAF7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
function localizeDigits(s: string, isEn: boolean): string {
  if (isEn) return s;
  return s.replace(/\d/g, d => AR_DIGITS[Number(d)]);
}

interface LandingPageProps {
  onLogin: () => void;
}

export default function LandingPage({ onLogin }: LandingPageProps) {
  const [content, setContent] = useState<LandingSiteContent>(() => mergeLandingContent(null));
  // /en and /ar are standalone language URLs (server-rendered head per path);
  // the root stays the Arabic default.
  const [openFaq, setOpenFaq] = useState<number>(0);
  const [lang, setLang] = useState<'ar' | 'en'>(() =>
    window.location.pathname.replace(/\/+$/, '') === '/en' ? 'en' : 'ar',
  );

  useEffect(() => { ensureLandingFonts(); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocSmart(doc(db, 'system_settings', 'landing_page'));
        if (!cancelled && snap && snap.exists() && snap.data()) {
          setContent(mergeLandingContent(snap.data()));
        }
      } catch (err) {
        console.warn('Landing page content load failed, using defaults:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isEn = lang === 'en';
  const dir = isEn ? 'ltr' : 'rtl';

  // Keep the tab title and search-result description in sync with the landing
  // language. The static index.html defaults are Arabic; restore them on
  // unmount so the login/app screens don't inherit landing copy.
  useEffect(() => {
    const meta = document.querySelector('meta[name="description"]');
    const prevTitle = document.title;
    const prevDesc = meta?.getAttribute('content') ?? null;
    document.title = isEn
      ? 'CoreDentSys | Dental Clinic Management System — your whole clinic in one place'
      : 'CoreDentSys | نظام إدارة عيادات الأسنان — إدارة عيادتك كلها من مكان واحد';
    meta?.setAttribute('content', isEn
      ? 'CoreDentSys is a complete management system for dental clinics: queue or timed appointments, full patient files, an interactive dental chart, x-rays, prescriptions, labs, accounts with daily closing, and reports. Works online and offline, in Arabic and English, from any device.'
      : 'CoreDentSys نظام متكامل لإدارة عيادات ومراكز الأسنان: حجوزات بالدور أو بالوقت، ملفات مرضى كاملة، مخطط أسنان تفاعلي، أشعة، روشتات، مختبرات، حسابات وتقفيل يومي، وتقارير. يعمل أونلاين وأوفلاين، بالعربي والإنجليزي، ومن أي جهاز.');
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== null) meta.setAttribute('content', prevDesc);
    };
  }, [isEn]);

  // Per-language text: English override, falling back to the Arabic copy.
  const T = useMemo(() => {
    const ar = content.ar;
    const en = content.en || {};
    return new Proxy({} as LandingTexts, {
      get: (_t, key: string) => {
        const v = isEn ? (en as any)[key] : undefined;
        return (v !== undefined && v !== null && v !== '') ? v : (ar as any)[key];
      }
    });
  }, [content, isEn]);

  const lt = <K extends { [k: string]: any }>(item: { ar: K; en?: Partial<K> }): K => {
    if (!isEn || !item.en) return item.ar;
    const out: any = { ...item.ar };
    for (const k of Object.keys(item.en)) {
      const v = (item.en as any)[k];
      if (v !== undefined && v !== null && v !== '' && !(k === 'features' && Array.isArray(v) && v.length === 0)) out[k] = v;
    }
    return out;
  };

  const cleanPhone = (content.whatsappNumber || '').replace(/[^\d]/g, '');
  const trialUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(T.trialWhatsappPrefill || '')}`
    : '';

  // Trial buttons only become real links once the super admin sets a WhatsApp
  // number on the website tab; without it they stay visible but inert.
  const TrialLink = ({ className, children }: { className: string; children: React.ReactNode }) =>
    trialUrl ? (
      <a className={className} href={trialUrl} target="_blank" rel="noopener noreferrer">{children}</a>
    ) : (
      <span className={className} aria-disabled="true" style={{ opacity: 0.55, cursor: 'not-allowed' }}>{children}</span>
    );

  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // Feature layout: first row of two, chart screenshot, middle rows of two,
  // then the finance screenshot beside the offline feature (or the last one)
  // with the offline note.
  const feats = content.features;
  const n = feats.length;
  const firstRow = feats.slice(0, Math.min(2, n));
  const hasLast = n >= 3;
  const offlineIdx = feats.findIndex(f => f.icon === 'offline');
  const splitIdx = hasLast ? (offlineIdx >= 2 ? offlineIdx : n - 1) : -1;
  const lastFeat = splitIdx >= 0 ? feats[splitIdx] : null;
  // Ordered render blocks after the first row: pairs of features, with the
  // split showcase (finance screenshot + offline feature) where it belongs.
  const blocks: Array<{ type: 'row'; items: { f: LandingFeature; idx: number }[] } | { type: 'split' }> = [];
  {
    let i = 2;
    while (i < n) {
      if (i === splitIdx) { blocks.push({ type: 'split' }); i++; continue; }
      const items = [{ f: feats[i], idx: i }];
      if (i + 1 < n && i + 1 !== splitIdx) { items.push({ f: feats[i + 1], idx: i + 1 }); i += 2; } else { i += 1; }
      blocks.push({ type: 'row', items });
    }
    if (splitIdx === 2 && blocks[0]?.type !== 'split') blocks.unshift({ type: 'split' });
  }

  const featItem = (f: LandingFeature, idx: number, big = false) => {
    const t = lt(f);
    return (
      <div className="fitem" key={f.id}>
        <span className="fnum"><Copy>{localizeDigits(String(idx + 1).padStart(2, '0'), isEn)}</Copy></span>
        <div>
          <div className="fname" style={big ? { fontSize: 30 } : undefined}><Copy>{t.title}</Copy></div>
          <div className="fdesc" style={big ? { fontSize: 16.5 } : undefined}><Copy>{t.desc}</Copy></div>
          {big && T.offlineNote && (
            <div className="offline-note"><Copy>{T.offlineNote}</Copy></div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div dir={dir} className="lp-root">
      {/* ================= NAV ================= */}
      <nav>
        <div className="wrap nav-in">
          <div className="brand">
            {content.logoUrl
              ? <img src={content.logoUrl} alt={T.brandName} />
              : <PulseLogo />}
            <span className="brand-en serif"><Copy>{T.brandName}</Copy></span>
          </div>
          <div className="nav-links">
            <a href="#features" onClick={scrollTo('features')}><Copy>{T.navFeatures}</Copy></a>
            <a href="#how" onClick={scrollTo('how')}><Copy>{T.navHow}</Copy></a>
            <a href="#pricing" onClick={scrollTo('pricing')}><Copy>{T.navPricing}</Copy></a>
            <a href="#contact" onClick={scrollTo('contact')}><Copy>{T.navContact}</Copy></a>
          </div>
          <div className="nav-cta">
            <button
              type="button"
              className="lang"
              onClick={() => {
                const next = isEn ? 'ar' : 'en';
                // Each language has its own public URL; switch by navigating.
                window.location.assign('/' + next);
              }}
            >
              {isEn ? 'العربية' : 'English'}
            </button>
            <button type="button" className="login" onClick={onLogin}>
              <Copy>{T.loginLabel}</Copy>
            </button>
          </div>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            {T.heroBadge && (
              <span className="badge"><i></i><Copy>{T.heroBadge}</Copy></span>
            )}
            <h1>
              <Copy>{T.heroTitleA}</Copy>
              {T.heroTitleB && (
                <>
                  <br />
                  <span className="hl"><Copy>{T.heroTitleB}</Copy><HandUnderline /></span>
                </>
              )}
            </h1>
            <p className="hero-sub"><Copy>{T.heroSubtitle}</Copy></p>
            <div className="hero-btns">
              <TrialLink className="btn btn-primary">
                <Copy>{T.trialButtonLabel}</Copy>
              </TrialLink>
              <a className="btn btn-ghost" href="#pricing" onClick={scrollTo('pricing')}>
                <Copy>{T.pricingButtonLabel}</Copy>
              </a>
            </div>
            <div className="hero-checks">
              {[T.heroPoint1, T.heroPoint2, T.heroPoint3].filter(Boolean).map((p, i) => (
                <span key={i}><HandCheck /><Copy>{p}</Copy></span>
              ))}
            </div>
          </div>
          <div className="shot">
            <div className="shot-back"></div>
            <div className="frame">
              <BrowserBar />
              <img src={content.heroImageUrl} alt={T.featuresTitle} />
            </div>
            {T.heroImageCaption && (
              <div className="note">
                <span className="hand"><Copy>{T.heroImageCaption}</Copy></span>
                <HandArrow />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ================= STATS ================= */}
      {content.stats.length > 0 && (
        <section className="stats">
          <div className="stats-in">
            {content.stats.map((s: LandingStat) => {
              const t = lt(s);
              return (
                <div className="stat" key={s.id}>
                  <b><Copy>{t.value}</Copy></b>
                  <Copy>{t.label}</Copy>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ================= PAINS ================= */}
      {(content.pains.length > 0 || T.painsTitle) && (
        <section className="pains">
          <div className="wrap">
            {T.painsKicker && <span className="label"><Copy>{T.painsKicker}</Copy></span>}
            <h2><Copy>{T.painsTitle}</Copy></h2>
            <div className="pain-list">
              {content.pains.map((p: LandingPain) => (
                <div className="pain" key={p.id}><Copy>{lt(p).text}</Copy></div>
              ))}
            </div>
            {(T.painsResolve || T.painsResolveStrong || T.painsNote) && (
              <p className="resolve">
                <Copy>{T.painsResolve}</Copy>{T.painsResolve && T.painsResolveStrong ? ' ' : ''}
                {T.painsResolveStrong && <b><Copy>{T.painsResolveStrong}</Copy></b>}
                {T.painsNote && (
                  <>
                    <br />
                    <span className="hand"><Copy>{T.painsNote}</Copy></span>
                  </>
                )}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ================= FEATURES ================= */}
      <section className="features" id="features">
        <div className="wrap">
          <div className="feat-head">
            <div>
              {T.featuresKicker && <span className="label"><Copy>{T.featuresKicker}</Copy></span>}
              <h2><Copy>{T.featuresTitle}</Copy></h2>
            </div>
            <p><Copy>{T.featuresSubtitle}</Copy></p>
          </div>

          {firstRow.length > 0 && (
            <div className="frow">
              {firstRow.map((f, i) => featItem(f, i))}
            </div>
          )}

          {content.chartImageUrl && (
            <div className="showcase">
              <div className="frame2">
                <BrowserBar />
                <img src={content.chartImageUrl} alt="" loading="lazy" />
              </div>
              {T.chartImageCaption && (
                <div className="cap"><span className="hand"><Copy>{T.chartImageCaption}</Copy></span></div>
              )}
            </div>
          )}

          {blocks.map((b, bi) => b.type === 'row' ? (
            <div className="frow" key={bi}>
              {b.items.map(({ f, idx }) => featItem(f, idx))}
            </div>
          ) : (
            <div className={`showcase${content.financeImageUrl ? ' split' : ''}`} key={bi}>
              {content.financeImageUrl && (
                <div>
                  <div className="frame2">
                    <BrowserBar />
                    <img src={content.financeImageUrl} alt="" loading="lazy" />
                  </div>
                  {T.financeImageCaption && (
                    <div className="cap"><span className="hand"><Copy>{T.financeImageCaption}</Copy></span></div>
                  )}
                </div>
              )}
              {lastFeat && featItem(lastFeat, splitIdx, true)}
            </div>
          ))}

          {!hasLast && content.financeImageUrl && (
            <div className="showcase">
              <div className="frame2">
                <BrowserBar />
                <img src={content.financeImageUrl} alt="" loading="lazy" />
              </div>
              {T.financeImageCaption && (
                <div className="cap"><span className="hand"><Copy>{T.financeImageCaption}</Copy></span></div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ================= STEPS ================= */}
      {content.steps.length > 0 && (
        <section className="steps" id="how">
          <div className="wrap">
            {T.stepsKicker && <span className="label"><Copy>{T.stepsKicker}</Copy></span>}
            <h2><Copy>{T.stepsTitle}</Copy></h2>
            <div className="steps-grid">
              {content.steps.map((s: LandingStep, i: number) => {
                const t = lt(s);
                return (
                  <div className="step" key={s.id}>
                    <b><Copy>{localizeDigits(String(i + 1), isEn)}</Copy></b>
                    <h3><Copy>{t.title}</Copy></h3>
                    <p><Copy>{t.desc}</Copy></p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ================= PRICING ================= */}
      <section className="pricing" id="pricing">
        <div className="wrap center">
          {T.pricingKicker && <span className="label" style={{ justifyContent: 'center' }}><Copy>{T.pricingKicker}</Copy></span>}
          <h2><Copy>{T.pricingTitle}</Copy></h2>
          <p className="sub"><Copy>{T.pricingSubtitle}</Copy></p>
          <div className="plans">
            {content.plans.map((p: LandingPlan) => {
              const t = lt(p);
              const pfeats: string[] = Array.isArray(t.features) ? t.features : [];
              return (
                <div className={`plan${p.popular ? ' hot' : ''}`} key={p.id}>
                  {p.popular && T.planPopularTag && (
                    <span className="flag"><Copy>{T.planPopularTag}</Copy></span>
                  )}
                  <h3><Copy>{t.name}</Copy></h3>
                  <p className="for"><Copy>{t.desc}</Copy></p>
                  <div className="price">
                    <b><Copy>{p.price}</Copy></b>
                    <span><Copy>{t.period}</Copy></span>
                  </div>
                  <ul>
                    {pfeats.map((f, i) => (
                      <li key={i} aria-hidden={f === '' ? true : undefined}>
                        {f !== '' && <HandCheck />}
                        <Copy>{f}</Copy>
                      </li>
                    ))}
                  </ul>
                  <TrialLink className={`btn ${p.popular ? 'btn-primary' : 'btn-ghost'}`}>
                    <Copy>{t.buttonLabel}</Copy>
                  </TrialLink>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      {content.faqVisible !== false && content.faqs.length > 0 && (
        <section className="faq" id="faq">
          <div className="wrap">
            {T.faqKicker && <span className="label"><Copy>{T.faqKicker}</Copy></span>}
            <h2><Copy>{T.faqTitle}</Copy></h2>
            <div className="faq-list">
              {content.faqs.map((f, i) => {
                const t = lt(f);
                const open = openFaq === i;
                return (
                  <div className={`faq-item${open ? ' open' : ''}`} key={f.id}>
                    <div className="faq-q" onClick={() => setOpenFaq(open ? -1 : i)}>
                      <span><Copy>{t.q}</Copy></span>
                      <span className="ic">{open ? '\u2212' : '+'}</span>
                    </div>
                    {open && <div className="faq-a"><Copy>{t.a}</Copy></div>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ================= CTA ================= */}
      <section className="cta">
        <div className="wrap">
          <h2><Copy>{T.ctaTitle}</Copy><HandUnderline light /></h2>
          <p><Copy>{T.ctaSubtitle}</Copy></p>
          <div className="hero-btns">
            <TrialLink className="btn btn-primary">
              <Copy>{T.ctaTrialLabel}</Copy>
            </TrialLink>
            <button type="button" className="btn btn-ghost" onClick={onLogin}>
              <Copy>{T.ctaLoginLabel}</Copy>
            </button>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer id="contact">
        <div className="wrap foot">
          <div className="brand">
            {content.logoUrl
              ? <img src={content.logoUrl} alt={T.brandName} />
              : <PulseLogo size={34} />}
            <span className="brand-en serif"><Copy>{T.brandName}</Copy></span>
          </div>
          {content.whatsappCommunityUrl && (
            <a href={content.whatsappCommunityUrl} target="_blank" rel="noopener noreferrer"><Copy>{T.footerCommunityLabel}</Copy></a>
          )}
          {content.facebookUrl && (
            <a href={content.facebookUrl} target="_blank" rel="noopener noreferrer"><Copy>{T.footerFacebookLabel}</Copy></a>
          )}
          {content.faqVisible !== false && content.faqs.length > 0 && (
            <a href="#faq" onClick={scrollTo('faq')}><Copy>{T.footerFaqLabel}</Copy></a>
          )}
          <Copy>{T.footerCopyright}</Copy>
        </div>
      </footer>
    </div>
  );
}
