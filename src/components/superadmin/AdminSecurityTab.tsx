import React, { useState, useEffect } from 'react';
import { 
  KeyRound, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  CheckCircle, 
  AlertCircle, 
  Save 
} from 'lucide-react';
import { useDialogs } from '../DialogContext';

interface AdminSecurityTabProps {}

export default function AdminSecurityTab({}: AdminSecurityTabProps) {
  const dialogs = useDialogs();

  const [emailInput, setEmailInput] = useState('admin@coredentsys.com');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchCredentials = async () => {
    try {
      const res = await fetch('/api/superadmin/credentials');
      if (res.ok) {
        const data = await res.json();
        if (data.email) {
          setEmailInput(data.email);
        }
      }
    } catch (err) {
      console.warn('Error fetching admin credentials:', err);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!emailInput.trim()) {
      setError('يرجى إدخال البريد الإلكتروني للأدمن');
      return;
    }
    if (!currentPassword.trim()) {
      setError('يرجى إدخال كلمة المرور الحالية للتأكيد');
      return;
    }
    if (!newPassword.trim()) {
      setError('يرجى إدخال كلمة المرور الجديدة');
      return;
    }
    if (newPassword.length < 6) {
      setError('يجب أن تتكون كلمة المرور الجديدة من 6 خانات على الأقل');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('كلمة المرور الجديدة وتأكيدها غير متطابقين');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/superadmin/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPassword.trim(),
          newEmail: emailInput.trim().toLowerCase(),
          newPassword: newPassword.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess('تم تغيير البريد الإلكتروني وكلمة المرور لحساب الأدمن بنجاح!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        fetchCredentials();
      } else {
        setError(data.message || 'فشل تغيير كلمة المرور والبريد الإلكتروني');
      }
    } catch (err: any) {
      setError('حدث خطأ أثناء الاتصال بالخادم: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl" dir="rtl">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-amber-600" />
            أمان وبيانات دخول السوبر أدمن
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            تعديل البريد الإلكتروني وكلمة المرور لحساب إدارة المنظومة بالكامل
          </p>
        </div>
      </div>

      {/* Security Form Card */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl font-bold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-bold flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0" />
              {success}
            </div>
          )}

          <div>
            <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-slate-400" />
              البريد الإلكتروني لحساب السوبر أدمن
            </label>
            <input
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full p-3 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-slate-400" />
              كلمة المرور الحالية (المطلوبة للتأكيد) *
            </label>
            <div className="relative">
              <input
                type={showCurrentPass ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="أدخل كلمة المرور الحالية"
                className="w-full pl-10 pr-3 py-3 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPass(!showCurrentPass)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showCurrentPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-slate-400" />
                كلمة المرور الجديدة *
              </label>
              <div className="relative">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="6 أحرف أو أرقام على الأقل"
                  className="w-full pl-10 pr-3 py-3 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(!showNewPass)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-bold mb-1.5 flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-slate-400" />
                تأكيد كلمة المرور الجديدة *
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="أعد كتابة كلمة المرور الجديدة"
                className="w-full p-3 border border-slate-200 rounded-xl text-xs text-slate-800 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 font-mono"
              />
            </div>
          </div>

          <div className="pt-3">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold rounded-xl shadow-md transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save className="h-4 w-4" />
              {loading ? 'جاري الحفظ والتحديث...' : 'حفظ بيانات الدخول الجديدة للأدمن'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
