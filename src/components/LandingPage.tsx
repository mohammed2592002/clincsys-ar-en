import React, { useEffect, useMemo, useState } from 'react';
import { db, doc, getDocSmart } from '../dbClient';
import {
  LandingSiteContent, LandingTexts, LandingFeature, LandingStat, LandingStep, LandingPlan,
  mergeLandingContent
} from '../types';
import {
  Calendar, Image as ImageIcon, MessageCircle, Pill, Wallet, Building2,
  Lock, Globe, Phone, Star, Users, Clock, Check, WifiOff, ArrowLeft, ArrowRight,
  MessageSquare
} from 'lucide-react';

// Fixed icon set the super admin can pick from for each feature card.
function FeatureIcon({ name, className }: { name: string; className?: string }) {
  const cls = className || 'h-6 w-6';
  switch (name) {
    case 'calendar': return <Calendar className={cls} />;
    case 'image': return <ImageIcon className={cls} />;
    case 'chat': return <MessageCircle className={cls} />;
    case 'pill': return <Pill className={cls} />;
    case 'wallet': return <Wallet className={cls} />;
    case 'buildings': return <Building2 className={cls} />;
    case 'lock': return <Lock className={cls} />;
    case 'globe': return <Globe className={cls} />;
    case 'phone': return <Phone className={cls} />;
    case 'star': return <Star className={cls} />;
    case 'users': return <Users className={cls} />;
    case 'clock': return <Clock className={cls} />;
    case 'offline': return <WifiOff className={cls} />;
    case 'check': return <Check className={cls} />;
    case 'tooth':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
          <path d="M12 4.5c-1.8 0-2.2-1-3.9-1C5.5 3.5 4 5.2 4 7.6c0 2.5 1.2 3.4 1.7 6 .4 2.4.9 5.9 2.3 5.9 1.5 0 1.3-3.2 2.2-5.3.4-1 .9-1.6 1.8-1.6s1.4.6 1.8 1.6c.9 2.1.7 5.3 2.2 5.3 1.4 0 1.9-3.5 2.3-5.9.5-2.6 1.7-3.5 1.7-6 0-2.4-1.5-4.1-4.1-4.1-1.7 0-2.1 1-3.9 1z"/>
        </svg>
      );
    default: return <Check className={cls} />;
  }
}

function PulseLogo({ size = 44 }: { size?: number }) {
  return (
    <div
      className="rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200"
      style={{ width: size, height: size, background: 'linear-gradient(135deg,#3b82f6,#10b981)' }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none">
        <path d="M3 12h4l2.5-6 3.5 12 2.5-6H21" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function BrowserFrame({ src, alt, tilt }: { src: string; alt: string; tilt?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-blue-900/10 overflow-hidden ${tilt || ''}`}>
      <div className="flex items-center gap-1.5 px-4 py-3 bg-slate-50 border-b border-slate-100">
        <span className="w-2.5 h-2.5 rounded-full bg-red-300"></span>
        <span className="w-2.5 h-2.5 rounded-full bg-amber-300"></span>
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-300"></span>
      </div>
      <img src={src} alt={alt} className="w-full block" loading="lazy" />
    </div>
  );
}

interface LandingPageProps {
  onLogin: () => void;
}

export default function LandingPage({ onLogin }: LandingPageProps) {
  const [content, setContent] = useState<LandingSiteContent>(() => mergeLandingContent(null));
  const [lang, setLang] = useState<'ar' | 'en'>('ar');

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
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
    return out;
  };

  const cleanPhone = (content.whatsappNumber || '').replace(/[^\d]/g, '');
  const trialUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(T.trialWhatsappPrefill || '')}`
    : '#';
  const Arrow = isEn ? ArrowRight : ArrowLeft;

  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div dir={dir} className="min-h-screen bg-[#f6faff] text-slate-900 font-sans">
      {/* ================= NAV ================= */}
      <nav className="sticky top-0 z-40 bg-white/85 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {content.logoUrl
              ? <img src={content.logoUrl} alt={T.brandName} className="h-11 w-11 rounded-2xl object-cover shadow-lg shadow-blue-200" />
              : <PulseLogo />}
            <span className="font-black text-xl tracking-tight">
              {T.brandName.includes('Dent')
                ? <>{T.brandName.split('Dent')[0]}<span className="bg-gradient-to-l from-blue-600 to-emerald-500 bg-clip-text text-transparent">Dent</span>{T.brandName.split('Dent')[1]}</>
                : T.brandName}
            </span>
          </div>
          <div className="hidden md:flex items-center gap-7 font-semibold text-slate-600 text-[15px]">
            <a href="#features" onClick={scrollTo('features')} className="hover:text-blue-700 transition-colors">{T.navFeatures}</a>
            <a href="#how" onClick={scrollTo('how')} className="hover:text-blue-700 transition-colors">{T.navHow}</a>
            <a href="#pricing" onClick={scrollTo('pricing')} className="hover:text-blue-700 transition-colors">{T.navPricing}</a>
            <a href="#contact" onClick={scrollTo('contact')} className="hover:text-blue-700 transition-colors">{T.navContact}</a>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLang(isEn ? 'ar' : 'en')}
              className="border border-slate-200 bg-white text-slate-600 rounded-full px-4 py-1.5 font-bold text-[13px] hover:border-blue-300 transition-colors flex items-center gap-1.5"
            >
              <Globe className="h-3.5 w-3.5" />
              {isEn ? 'العربية' : 'English'}
            </button>
            <button
              onClick={onLogin}
              className="bg-gradient-to-l from-blue-600 to-blue-700 text-white rounded-xl px-5 sm:px-6 py-2.5 font-extrabold text-[15px] shadow-lg shadow-blue-600/30 hover:shadow-blue-600/45 hover:-translate-y-px transition-all flex items-center gap-2"
            >
              {T.loginLabel}
              <Arrow className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <header className="max-w-6xl mx-auto px-5 pt-14 sm:pt-20 pb-16 grid lg:grid-cols-2 gap-12 lg:gap-10 items-center">
        <div>
          {T.heroBadge && (
            <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[13px] rounded-full px-4 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {T.heroBadge}
            </div>
          )}
          <h1 className="text-4xl sm:text-5xl font-black leading-[1.35] mb-5">
            {T.heroTitleA}
            {T.heroTitleB && (
              <>
                <br />
                <span className="bg-gradient-to-l from-blue-600 to-emerald-500 bg-clip-text text-transparent">{T.heroTitleB}</span>
              </>
            )}
          </h1>
          <p className="text-slate-500 text-[16.5px] leading-8 mb-8 max-w-xl">{T.heroSubtitle}</p>
          <div className="flex flex-wrap items-center gap-3.5 mb-9">
            <a
              href={trialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gradient-to-l from-emerald-500 to-emerald-600 text-white rounded-2xl px-7 py-4 font-extrabold text-[16px] shadow-xl shadow-emerald-500/30 hover:shadow-emerald-500/45 hover:-translate-y-px transition-all flex items-center gap-2.5"
            >
              <MessageSquare className="h-5 w-5" />
              {T.trialButtonLabel}
            </a>
            <a
              href="#pricing"
              onClick={scrollTo('pricing')}
              className="bg-white text-blue-700 border-[1.5px] border-blue-200 rounded-2xl px-6 py-[15px] font-extrabold text-[15px] hover:border-blue-400 transition-colors"
            >
              {T.pricingButtonLabel}
            </a>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-slate-500 text-[13.5px] font-semibold">
            {[T.heroPoint1, T.heroPoint2, T.heroPoint3].filter(Boolean).map((p, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-500" strokeWidth={3} />
                {p}
              </span>
            ))}
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-6 bg-gradient-to-tl from-blue-100 via-transparent to-emerald-100 rounded-[2.5rem] blur-2xl opacity-70"></div>
          <div className="relative lg:-rotate-1">
            <BrowserFrame src={content.heroImageUrl} alt={T.featuresTitle} />
          </div>
        </div>
      </header>

      {/* ================= STATS ================= */}
      {content.stats.length > 0 && (
        <div className="bg-gradient-to-l from-blue-900 via-blue-700 to-emerald-600 text-white">
          <div className="max-w-6xl mx-auto px-5 py-7 grid grid-cols-2 md:grid-cols-4 gap-5">
            {content.stats.map((s: LandingStat) => {
              const t = lt(s);
              return (
                <div key={s.id} className="text-center">
                  <div className="font-black text-xl sm:text-2xl mb-1">{t.value}</div>
                  <div className="text-blue-100 text-[13px] font-semibold">{t.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= FEATURES ================= */}
      <section id="features" className="max-w-6xl mx-auto px-5 pt-20">
        <div className="text-center max-w-xl mx-auto mb-12">
          <div className="text-blue-600 font-extrabold text-[13.5px] tracking-wide mb-2">{T.featuresKicker}</div>
          <h2 className="text-3xl sm:text-4xl font-black mb-3">{T.featuresTitle}</h2>
          <p className="text-slate-500 leading-7">{T.featuresSubtitle}</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {content.features.map((f: LandingFeature, i: number) => {
            const t = lt(f);
            const green = i % 2 === 1;
            return (
              <div key={f.id} className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 hover:shadow-xl hover:shadow-blue-900/5 hover:-translate-y-0.5 transition-all">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${green ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-700'}`}>
                  <FeatureIcon name={f.icon} />
                </div>
                <h3 className="font-extrabold text-[15.5px] mb-1.5">{t.title}</h3>
                <p className="text-slate-500 text-[13px] leading-6">{t.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ================= REAL SCREENSHOTS ================= */}
      {(content.chartImageUrl || content.financeImageUrl) && (
        <section className="max-w-6xl mx-auto px-5 pt-16 grid md:grid-cols-2 gap-6">
          {content.chartImageUrl && <div className="md:rotate-1"><BrowserFrame src={content.chartImageUrl} alt="" /></div>}
          {content.financeImageUrl && <div className="md:-rotate-1 md:mt-10"><BrowserFrame src={content.financeImageUrl} alt="" /></div>}
        </section>
      )}

      {/* ================= STEPS ================= */}
      {content.steps.length > 0 && (
        <section id="how" className="max-w-6xl mx-auto px-5 pt-20">
          <div className="text-center max-w-xl mx-auto mb-12">
            <div className="text-blue-600 font-extrabold text-[13.5px] tracking-wide mb-2">{T.stepsKicker}</div>
            <h2 className="text-3xl sm:text-4xl font-black">{T.stepsTitle}</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {content.steps.map((s: LandingStep, i: number) => {
              const t = lt(s);
              return (
                <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-7">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-bl from-blue-600 to-emerald-500 text-white font-black text-lg flex items-center justify-center mb-4 shadow-lg shadow-blue-600/25">
                    {i + 1}
                  </div>
                  <h3 className="font-extrabold text-[17px] mb-2">{t.title}</h3>
                  <p className="text-slate-500 text-[14px] leading-7">{t.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ================= PRICING ================= */}
      <section id="pricing" className="max-w-6xl mx-auto px-5 pt-20">
        <div className="bg-gradient-to-b from-blue-50 to-transparent rounded-[2rem] px-4 sm:px-8 py-14">
          <div className="text-center max-w-xl mx-auto mb-12">
            <div className="text-blue-600 font-extrabold text-[13.5px] tracking-wide mb-2">{T.pricingKicker}</div>
            <h2 className="text-3xl sm:text-4xl font-black mb-3">{T.pricingTitle}</h2>
            <p className="text-slate-500 leading-7">{T.pricingSubtitle}</p>
          </div>
          <div className={`grid gap-5 ${content.plans.length === 1 ? 'md:grid-cols-1 max-w-md mx-auto' : content.plans.length === 2 ? 'md:grid-cols-2 max-w-3xl mx-auto' : 'md:grid-cols-3'}`}>
            {content.plans.map((p: LandingPlan) => {
              const t = lt(p);
              const feats: string[] = Array.isArray(t.features) ? t.features : [];
              return (
                <div
                  key={p.id}
                  className={`relative bg-white rounded-3xl p-7 flex flex-col ${p.popular ? 'border-[2.5px] border-emerald-500 shadow-2xl shadow-emerald-500/15 md:-mt-4 md:mb-[-1rem]' : 'border border-slate-200 shadow-sm'}`}
                >
                  {p.popular && (
                    <div className="absolute -top-3.5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 bg-gradient-to-l from-emerald-500 to-emerald-600 text-white font-extrabold text-[12.5px] px-5 py-1 rounded-full shadow-lg shadow-emerald-500/30 whitespace-nowrap flex items-center gap-1">
                      <Star className="h-3 w-3" fill="currentColor" />
                      {isEn ? 'Most popular' : 'الأكثر اختياراً'}
                    </div>
                  )}
                  <h3 className="font-extrabold text-lg">{t.name}</h3>
                  <p className="text-slate-400 text-[13px] mt-1 mb-5">{t.desc}</p>
                  <div className="flex items-baseline gap-2 mb-6">
                    <span className="font-black text-[42px] leading-none">{p.price}</span>
                    <span className="text-slate-400 font-bold text-[13px]">{t.period}</span>
                  </div>
                  <ul className="space-y-2.5 mb-7 flex-1">
                    {feats.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13.5px] font-semibold text-slate-600">
                        <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" strokeWidth={3} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={trialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-center rounded-xl py-3.5 font-extrabold text-[15px] transition-all ${p.popular ? 'bg-gradient-to-l from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/45' : 'border-[1.5px] border-blue-200 text-blue-700 hover:border-blue-400'}`}
                  >
                    {t.buttonLabel}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="max-w-6xl mx-auto px-5 pt-20 pb-4">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-l from-blue-900 via-blue-700 to-emerald-600 text-white text-center px-6 py-16">
          <div className="absolute -top-24 -end-24 w-72 h-72 rounded-full bg-emerald-400/20 blur-3xl"></div>
          <div className="absolute -bottom-24 -start-24 w-72 h-72 rounded-full bg-blue-400/20 blur-3xl"></div>
          <h2 className="relative text-3xl sm:text-4xl font-black mb-4">{T.ctaTitle}</h2>
          <p className="relative text-blue-100 text-[16px] mb-9 max-w-lg mx-auto leading-7">{T.ctaSubtitle}</p>
          <div className="relative flex flex-wrap justify-center gap-3.5">
            <a
              href={trialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white text-blue-900 rounded-2xl px-8 py-4 font-black text-[16px] shadow-xl hover:-translate-y-px transition-all flex items-center gap-2.5"
            >
              <MessageSquare className="h-5 w-5" />
              {T.ctaTrialLabel}
            </a>
            <button
              onClick={onLogin}
              className="border-2 border-white/50 text-white rounded-2xl px-7 py-[15px] font-extrabold text-[15.5px] hover:bg-white/10 transition-colors flex items-center gap-2"
            >
              {T.ctaLoginLabel}
              <Arrow className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer id="contact" className="border-t border-slate-200 bg-white mt-14">
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            {content.logoUrl
              ? <img src={content.logoUrl} alt={T.brandName} className="h-9 w-9 rounded-xl object-cover" />
              : <PulseLogo size={36} />}
            <span className="font-black text-[17px]">{T.brandName}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-slate-500 font-semibold text-[13.5px]">
            {content.whatsappCommunityUrl && (
              <a href={content.whatsappCommunityUrl} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-600 transition-colors">{T.footerCommunityLabel}</a>
            )}
            {content.facebookUrl && (
              <a href={content.facebookUrl} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">{T.footerFacebookLabel}</a>
            )}
            <span>{T.footerFaqLabel}</span>
          </div>
        </div>
        <div className="text-center text-slate-400 text-[12.5px] font-semibold pb-7">{T.footerCopyright}</div>
      </footer>
    </div>
  );
}
