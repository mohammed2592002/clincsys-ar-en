import {configuredSocialLinks} from '../utils/supportLinks';
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { 
  Activity, 
  UserCheck, 
  Briefcase, 
  AlertCircle, 
  Mail, 
  Lock, 
  EyeOff, 
  Eye, 
  RefreshCw, 
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  Globe,
  Send,
  ExternalLink,
  PhoneCall,
  Database,
  Headphones
} from 'lucide-react';
import { db, doc, getDocSmart } from '../dbClient';
import { SocialContact } from '../types';
import loginEmblem from '../assets/login-emblem.svg';
import './LoginScreen.css';

interface LoginScreenProps {
  loginRole: 'manager' | 'staff';
  setLoginRole: (role: 'manager' | 'staff') => void;
  loginEmail: string;
  setLoginEmail: (val: string) => void;
  loginPassword: string;
  setLoginPassword: (val: string) => void;
  loginError: string;
  setLoginError: (val: string) => void;
  loginLoading: boolean;
  showPassword: boolean;
  setShowPassword: (val: boolean) => void;
  handleLoginSubmit: (e: React.FormEvent) => void;
  onOpenDbNotice?: () => void;
}

export default function LoginScreen({
  loginRole,
  setLoginRole,
  loginEmail,
  setLoginEmail,
  loginPassword,
  setLoginPassword,
  loginError,
  setLoginError,
  loginLoading,
  showPassword,
  setShowPassword,
  handleLoginSubmit,
  onOpenDbNotice
}: LoginScreenProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const [trialPhone, setTrialPhone] = useState<string>('');
  const [socialLinks, setSocialLinks] = useState<SocialContact[]>([]);

  useEffect(() => {
    async function fetchSupportData() {
      try {
        const snap = await getDocSmart(doc(db, 'system_settings', 'support'));
        if (snap && snap.exists() && snap.data()) {
          const d = snap.data();
          if (d.trialPhoneNumber) {
            setTrialPhone(d.trialPhoneNumber);
          } else if (Array.isArray(d.phoneNumbers) && d.phoneNumbers.length > 0 && d.phoneNumbers[0].phone) {
            setTrialPhone(d.phoneNumbers[0].phone);
          }
          if (Array.isArray(d.socialLinks)) {
            setSocialLinks(configuredSocialLinks(d.socialLinks));
          }
        }
      } catch (err) {
        console.warn('Could not load support settings:', err);
      }
    }
    fetchSupportData();
  }, []);

  const handleRequestTrial = () => {
    const targetPhone = trialPhone;
    if (!targetPhone) return;
    let cleanPhone = targetPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('01')) {
      cleanPhone = '2' + cleanPhone;
    }
    const text = encodeURIComponent('السلام عليكم ورحمة الله وبركاته، أرغب في طلب نسخة تجريبية مجانية من نظام إدارة عيادات الأسنان (CoreDentSys) لمدة 7 أيام.');
    window.open(`https://wa.me/${cleanPhone}?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const getSocialIcon = (platform: string) => {
    switch (platform) {
      case 'facebook':
        return <Globe className="h-4 w-4 text-blue-600 shrink-0" />;
      case 'instagram':
        return <Globe className="h-4 w-4 text-pink-600 shrink-0" />;
      case 'telegram':
        return <Send className="h-4 w-4 text-sky-500 shrink-0" />;
      case 'whatsapp_group':
        return <MessageCircle className="h-4 w-4 text-emerald-500 shrink-0" />;
      case 'youtube':
        return <Globe className="h-4 w-4 text-red-600 shrink-0" />;
      case 'email':
        return <Mail className="h-4 w-4 text-amber-600 shrink-0" />;
      case 'website':
        return <Globe className="h-4 w-4 text-slate-700 shrink-0" />;
      default:
        return <ExternalLink className="h-4 w-4 text-indigo-600 shrink-0" />;
    }
  };

  return (
    <div className="cd-login" dir={isEn ? 'ltr' : 'rtl'}>
      <header className="cd-header">
        <a className="cd-brand" href="/" aria-label="CoreDentSys"><span className="cd-brandmark"><Activity /></span><span className="cd-brandname">Core<span>Dent</span>Sys</span></a>
        <nav className="cd-nav"><a className="cd-home" href="/">{isEn ? <ArrowLeft /> : <ArrowRight />}{t('auth.backToWebsite')}</a><button className="cd-language" type="button" onClick={() => i18n.changeLanguage(isEn ? 'ar' : 'en')}><Globe />{isEn ? 'العربية' : 'English'}</button></nav>
      </header>
      <main className="cd-main">
        <section className="cd-form-section" aria-labelledby="login-title"><div className="cd-form-wrap">
          <div className="cd-eyebrow">{t('auth.clinicEntry')}</div><h1 id="login-title">{t('auth.welcomeBack')}</h1><p className="cd-sub">{t('auth.signInDescription')}</p>
          <div className="cd-roles" role="group" aria-label={t('auth.chooseRole')}>
            <button type="button" aria-pressed={loginRole === 'manager'} className={`cd-role ${loginRole === 'manager' ? 'active' : ''}`} onClick={() => { setLoginRole('manager'); setLoginError(''); }}><UserCheck />{t('auth.managerTab')}</button>
            <button type="button" aria-pressed={loginRole === 'staff'} className={`cd-role ${loginRole === 'staff' ? 'active' : ''}`} onClick={() => { setLoginRole('staff'); setLoginError(''); }}><Briefcase />{t('auth.staffTab')}</button>
          </div>
          <AnimatePresence>{loginError && <motion.div role="alert" id="login-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="cd-error"><AlertCircle /><p>{loginError}</p></motion.div>}</AnimatePresence>
          <form onSubmit={handleLoginSubmit} aria-busy={loginLoading}>
            <div className="cd-field"><label htmlFor="login-email">{t('auth.email')}</label><div className="cd-input"><Mail /><input id="login-email" name="email" className="cd-latin" type="email" required autoComplete="username" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder={t('auth.emailPlaceholder')} dir="ltr" aria-describedby={loginError ? 'login-error' : undefined} /></div></div>
            <div className="cd-field"><label htmlFor="login-password">{loginRole === 'manager' ? t('auth.password') : `${t('auth.password')} / PIN`}</label><div className="cd-input"><Lock /><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder={t('auth.enterPassword')} dir="ltr" className="cd-password" aria-describedby={loginError ? 'login-error' : undefined} /><button className="cd-eye" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')} aria-pressed={showPassword}>{showPassword ? <EyeOff /> : <Eye />}</button></div></div>
            <button type="submit" className="cd-submit" disabled={loginLoading}>{loginLoading ? <><RefreshCw className="animate-spin" /><span>{t('auth.loginLoading')}</span></> : <><span>{t('auth.loginBtn')}</span>{isEn ? <ArrowRight /> : <ArrowLeft />}</>}</button>
          </form>
          <div className="cd-trial"><p>{t('auth.newToCoreDentSys')}</p><button type="button" onClick={handleRequestTrial} disabled={!trialPhone} title={!trialPhone ? t('auth.trialNotConfigured') : undefined}><MessageCircle />{t('auth.trialButton')}</button></div>
          {socialLinks.length > 0 && <div className="cd-support"><div className="cd-support-heading"><Headphones /><span>{t('auth.needHelp')}</span><b>{t('auth.contactSupport')}</b></div><div className="cd-support-links">{socialLinks.map(link => <a key={link.id || link.url} href={link.url} target="_blank" rel="noopener noreferrer" title={link.title}>{getSocialIcon(link.platform)}<span>{link.title}</span></a>)}</div></div>}
        </div></section>
        <aside className="cd-visual" aria-label={t('auth.brandPanel')}><img className="cd-emblem" src={loginEmblem} alt={t('auth.emblemAlt')} /><div className="cd-tiny"><span />{t('auth.designedForDentists')}</div><h2>{t('auth.organizedClinic')}<br /><span>{t('auth.bookingToFollowUp')}</span></h2><p className="cd-description">{t('auth.panelDescriptionLine1')}<br />{t('auth.panelDescriptionLine2')}</p></aside>
      </main>
      <footer className="cd-footer"><span><bdi>CoreDentSys</bdi> · {t('auth.dentalManagement')}</span></footer>
    </div>
  );
}
