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
  Database
} from 'lucide-react';
import { db, doc, getDocSmart } from '../dbClient';
import { SocialContact } from '../types';
import LanguageSwitcher from './LanguageSwitcher';

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
  const [trialPhone, setTrialPhone] = useState<string>('01012345678');
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
            setSocialLinks(d.socialLinks.filter((s: SocialContact) => s.url && s.url.trim()));
          }
        }
      } catch (err) {
        console.warn('Could not load support settings:', err);
      }
    }
    fetchSupportData();
  }, []);

  const handleRequestTrial = () => {
    let targetPhone = trialPhone || '01012345678';
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
    <div className="min-h-screen bg-slate-50 bg-gradient-to-br from-sky-100 via-slate-50 to-blue-100 text-slate-800 flex flex-col justify-center items-center p-4 sm:p-6 font-sans relative select-none overflow-hidden" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Top bar with Language Switcher */}
      <div className="absolute top-4 end-4 z-20">
        <LanguageSwitcher variant="pill" />
      </div>

      {/* Soft Ambient Sky Blue Background Orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[320px] bg-sky-300/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-cyan-200/40 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md mx-auto flex flex-col items-center">

        {/* Brand Logo Header */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-14 h-14 bg-white/80 border border-sky-200/80 rounded-2xl flex items-center justify-center text-sky-600 mb-3 shadow-md shadow-sky-100/50 backdrop-blur-md">
            <Activity className="h-7 w-7 text-sky-600" />
          </div>

          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            CoreDentSys
          </h1>
          <p className="text-xs text-sky-600 font-bold tracking-widest uppercase mt-0.5">
            {t('common.appSubtitle')}
          </p>
        </div>

        {/* Smooth Glassmorphic Card */}
        <div className="w-full bg-white/75 backdrop-blur-xl border border-white/80 p-6 sm:p-8 rounded-3xl shadow-xl shadow-sky-900/5 relative space-y-6 text-start">

          {/* Title Header */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-slate-900">{t('auth.loginBtn')}</h2>
          </div>

          {/* Role Switcher tabs */}
          <div className="grid grid-cols-2 gap-2 bg-slate-100/70 p-1.5 rounded-2xl text-xs border border-sky-100/80 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => { setLoginRole('manager'); setLoginError(''); }}
              className={`py-2.5 px-3 rounded-xl font-extrabold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                loginRole === 'manager' 
                  ? 'bg-white text-sky-700 shadow-sm border border-sky-200/80 scale-[1.01]' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="h-4 w-4 text-sky-600" />
              <span>{t('auth.managerRole')}</span>
            </button>
            <button
              type="button"
              onClick={() => { setLoginRole('staff'); setLoginError(''); }}
              className={`py-2.5 px-3 rounded-xl font-extrabold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                loginRole === 'staff' 
                  ? 'bg-white text-cyan-700 shadow-sm border border-cyan-200/80 scale-[1.01]' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Briefcase className="h-4 w-4 text-cyan-600" />
              <span>{t('auth.staffRole')}</span>
            </button>
          </div>

          {/* Error Banner */}
          <AnimatePresence>
            {loginError && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-rose-50/90 border border-rose-200 p-3 rounded-xl flex items-start gap-2.5 shadow-2xs"
              >
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-700 font-bold leading-relaxed">{loginError}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Login Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 text-start">
                {t('auth.email')}
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder={t('auth.emailPlaceholder')}
                  className="w-full ps-10 pe-10 py-3 bg-white/80 border border-sky-200/80 rounded-xl focus:outline-none focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100 text-sm text-slate-800 font-mono placeholder:text-slate-400 transition shadow-2xs"
                  dir="ltr"
                />
                <Mail className="absolute start-3.5 top-3.5 h-4 w-4 text-sky-500/70" />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5 text-start">
                {loginRole === 'manager' ? t('auth.password') : `${t('auth.password')} / PIN`}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder={t('auth.passwordPlaceholder')}
                  className="w-full ps-10 pe-10 py-3 bg-white/80 border border-sky-200/80 rounded-xl focus:outline-none focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100 text-sm font-mono text-slate-800 placeholder:text-slate-400 transition shadow-2xs"
                  dir="ltr"
                />
                <Lock className="absolute start-3.5 top-3.5 h-4 w-4 text-sky-500/70" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-3.5 top-3 text-slate-400 hover:text-sky-600 transition p-1 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loginLoading}
              className={`w-full text-white font-extrabold py-3.5 rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2 mt-2 cursor-pointer shadow-md ${
                loginRole === 'manager' 
                  ? 'bg-sky-600 hover:bg-sky-700 shadow-sky-200' 
                  : 'bg-cyan-600 hover:bg-cyan-700 shadow-cyan-200'
              }`}
            >
              {loginLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>{t('auth.loginLoading')}</span>
                </>
              ) : (
                <>
                  <span>{t('auth.loginBtn')}</span>
                  {isEn ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
                </>
              )}
            </button>

            {/* Request Free 7-Day Trial Button */}
            <div className="pt-2 border-t border-slate-200/80 mt-3">
              <button
                type="button"
                onClick={handleRequestTrial}
                className="w-full bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-extrabold py-3.5 px-4 rounded-xl transition-all text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-500/20 active:scale-[0.99] group"
              >
                <MessageCircle className="h-4 w-4 text-emerald-100 group-hover:scale-110 transition-transform fill-white/20" />
                <span>{t('auth.requestTrial')}</span>
              </button>
            </div>

            {/* Social Media Links from Technical Support */}
            {socialLinks.length > 0 && (
              <div className="pt-3 border-t border-slate-200/80 mt-3 flex flex-col items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500">{t('auth.support')}:</span>
                <div className="flex items-center justify-center flex-wrap gap-2">
                  {socialLinks.map((link) => (
                    <a
                      key={link.id || link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={link.title}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-sky-50 border border-slate-200/90 hover:border-sky-300 rounded-xl transition-all shadow-2xs hover:scale-105 flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-sky-700 cursor-pointer"
                    >
                      {getSocialIcon(link.platform)}
                      <span className="text-[11px] font-semibold">{link.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Security Badge */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs font-bold text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-sky-600" />
            <span>{isEn ? 'Encrypted & Secured System • CoreDentSys' : 'نظام مشفر ومؤمن • CoreDentSys'}</span>
          </div>
        </div>

      </div>
    </div>
  );
}
