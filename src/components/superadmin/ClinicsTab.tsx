import React, { useState, useMemo } from 'react';
import { db, doc, collection, setDoc, deleteDoc, updateDoc, getDocsSmart as getDocs } from '../../dbClient';
import { Clinic } from '../../types';
import { useDialogs } from '../DialogContext';
import { 
  Building2, 
  Search, 
  Plus, 
  CheckCircle, 
  AlertCircle, 
  Edit, 
  Trash2, 
  Power, 
  Phone, 
  Lock, 
  Eye, 
  EyeOff, 
  MessageSquare, 
  Download, 
  ExternalLink, 
  Users, 
  Calendar, 
  FileText, 
  Sparkles, 
  X, 
  Check, 
  ChevronLeft, 
  ChevronRight,
  Clock,
  Send,
  CreditCard,
  Wallet
} from 'lucide-react';
import { isClinicExpired, formatDateTime } from '../../utils/timeUtils';
import { resizeImageToWidth190 } from '../../utils';
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from '../../utils/phoneUtils';

interface ClinicsTabProps {
  clinics: Clinic[];
  clinicUsage: Array<{
    id: string;
    name: string;
    doctorName: string;
    isActive: boolean;
    numPatients: number;
    numAppointments: number;
    numShifts: number;
    createdAt?: string;
  }>;
  onRefreshClinics: () => Promise<void>;
  saveSession: (session: { type: 'clinic'; clinicId: string; clinicName: string } | { type: 'admin' } | { type: 'logged_out' }) => void;
}

export default function ClinicsTab({
  clinics,
  clinicUsage,
  onRefreshClinics,
  saveSession
}: ClinicsTabProps) {
  const dialogs = useDialogs();

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'expiring' | 'expired' | 'inactive'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Password visibility map (clinicId -> boolean)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  // Single clinic backup loading state
  const [downloadingClinicId, setDownloadingClinicId] = useState<string | null>(null);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClinic, setEditingClinic] = useState<Clinic | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  // Create Form State
  const [newName, setNewName] = useState('');
  const [newNameAr, setNewNameAr] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newLogo, setNewLogo] = useState('');
  const [newDoctorName, setNewDoctorName] = useState('');
  const [newDoctorPhone, setNewDoctorPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPrescriptionStyle, setNewPrescriptionStyle] = useState<'classic' | 'modern' | 'minimal' | 'elegant'>('classic');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPaidAmount, setNewPaidAmount] = useState<number | string>(500);
  const [newPaymentMethod, setNewPaymentMethod] = useState<'cash' | 'wallet' | 'card' | 'instapay'>('cash');
  const [newExpiresAt, setNewExpiresAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [newAllowedFeatures, setNewAllowedFeatures] = useState<string[]>([
    'patients', 'calendar', 'prescriptions', 'laboratory', 'financials'
  ]);

  // Edit Form State
  const [editName, setEditName] = useState('');
  const [editNameAr, setEditNameAr] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editLogo, setEditLogo] = useState('');
  const [editDoctorName, setEditDoctorName] = useState('');
  const [editDoctorPhone, setEditDoctorPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPrescriptionStyle, setEditPrescriptionStyle] = useState<'classic' | 'modern' | 'minimal' | 'elegant'>('classic');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editAllowedFeatures, setEditAllowedFeatures] = useState<string[]>([]);

  // Toggle password visibility for specific clinic
  const togglePasswordVisibility = (clinicId: string) => {
    setVisiblePasswords(prev => ({ ...prev, [clinicId]: !prev[clinicId] }));
  };

  // Helper: check if subscription date is expired
  const isSubscriptionExpired = (expiresAt?: string): boolean => {
    if (!expiresAt) return true;
    const now = new Date();
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime())) return true;
    return now > expiry;
  };

  // Helper: check if expiring within 7 days
  const isExpiringSoon = (expiresAt?: string): boolean => {
    if (!expiresAt) return false;
    const now = new Date();
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime())) return false;
    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 3600 * 24);
    return diffDays > 0 && diffDays <= 7;
  };

  // Helper: Get days remaining text
  const getDaysRemainingText = (expiresAt?: string): { text: string; color: string; isExpired: boolean } => {
    if (!expiresAt) return { text: 'غير محدد', color: 'text-slate-500 bg-slate-100', isExpired: false };
    const now = new Date();
    const expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime())) return { text: 'تاريخ غير صالح', color: 'text-slate-500 bg-slate-100', isExpired: false };

    const diffMs = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 3600 * 24));

    if (diffDays <= 0) {
      return { text: `منتهي منذ ${Math.abs(diffDays)} يوم`, color: 'text-rose-700 bg-rose-50 border-rose-200', isExpired: true };
    }
    if (diffDays === 1) {
      return { text: 'ينتهي اليوم/غداً', color: 'text-amber-700 bg-amber-50 border-amber-200', isExpired: false };
    }
    if (diffDays <= 7) {
      return { text: `متبقي ${diffDays} أيام`, color: 'text-amber-700 bg-amber-50 border-amber-200', isExpired: false };
    }
    return { text: `متبقي ${diffDays} يوم`, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', isExpired: false };
  };

  // Filtered & Paginated Clinics
  const filteredClinics = useMemo(() => {
    return clinics.filter(c => {
      // 1. Status Filter
      const isInactive = c.isActive === false;
      const isExpired = !isInactive && isSubscriptionExpired(c.subscriptionExpiresAt);
      const isExpiring = !isInactive && !isExpired && isExpiringSoon(c.subscriptionExpiresAt);
      const isActive = !isInactive && !isExpired;

      if (statusFilter === 'active' && !isActive) return false;
      if (statusFilter === 'expiring' && !isExpiring) return false;
      if (statusFilter === 'expired' && !isExpired) return false;
      if (statusFilter === 'inactive' && !isInactive) return false;

      // 2. Search Query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      const nameMatch = (c.name || '').toLowerCase().includes(q) ||
                        (c.nameAr || '').toLowerCase().includes(q) ||
                        (c.nameEn || '').toLowerCase().includes(q);
      const docMatch = (c.doctorName || '').toLowerCase().includes(q) ||
                       (c.doctorNameEn || '').toLowerCase().includes(q);
      const emailMatch = (c.email || '').toLowerCase().includes(q);
      const phoneMatch = (c.doctorPhone || '').toLowerCase().includes(q) ||
                         (c.additionalPhones && c.additionalPhones.some(p => p.toLowerCase().includes(q)));

      return nameMatch || docMatch || emailMatch || phoneMatch;
    });
  }, [clinics, searchQuery, statusFilter]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredClinics.length / pageSize));
  const paginatedClinics = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredClinics.slice(start, start + pageSize);
  }, [filteredClinics, currentPage, pageSize]);

  // Counts for status pills
  const statusCounts = useMemo(() => {
    let active = 0;
    let expiring = 0;
    let expired = 0;
    let inactive = 0;

    clinics.forEach(c => {
      const isInactive = c.isActive === false;
      const isExpired = !isInactive && isSubscriptionExpired(c.subscriptionExpiresAt);
      const isExpSoon = !isInactive && !isExpired && isExpiringSoon(c.subscriptionExpiresAt);

      if (isInactive) {
        inactive++;
      } else if (isExpired) {
        expired++;
      } else if (isExpSoon) {
        expiring++;
        active++;
      } else {
        active++;
      }
    });

    return { all: clinics.length, active, expiring, expired, inactive };
  }, [clinics]);

  // Action: Single Clinic Instant Backup
  const handleDownloadSingleClinicBackup = async (clinic: Clinic) => {
    setDownloadingClinicId(clinic.id);
    try {
      const cId = clinic.id;
      const [
        patientsSnap,
        appointmentsSnap,
        prescriptionsSnap,
        customMedSnap,
        customCatSnap,
        shiftsSnap,
        expensesSnap,
        inventorySnap,
        billingSnap,
        closingsSnap,
        labsSnap,
        labOrdersSnap,
        labWorkTypesSnap
      ] = await Promise.all([
        getDocs(collection(db, 'clinics', cId, 'patients')),
        getDocs(collection(db, 'clinics', cId, 'appointments')),
        getDocs(collection(db, 'clinics', cId, 'prescriptions')),
        getDocs(collection(db, 'clinics', cId, 'custom_medications')),
        getDocs(collection(db, 'clinics', cId, 'custom_categories')),
        getDocs(collection(db, 'clinics', cId, 'shifts')),
        getDocs(collection(db, 'clinics', cId, 'expenses')),
        getDocs(collection(db, 'clinics', cId, 'inventory')),
        getDocs(collection(db, 'clinics', cId, 'billing')),
        getDocs(collection(db, 'clinics', cId, 'closings')),
        getDocs(collection(db, 'clinics', cId, 'laboratories')),
        getDocs(collection(db, 'clinics', cId, 'lab_orders')),
        getDocs(collection(db, 'clinics', cId, 'lab_work_types'))
      ]);

      const patientsData = await Promise.all(
        patientsSnap.docs.map(async (pDoc) => {
          const pData = { id: pDoc.id, ...pDoc.data() } as any;
          const [recsSnap, teethSnap, xraysSnap] = await Promise.all([
            getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'records')),
            getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'teeth')),
            getDocs(collection(db, 'clinics', cId, 'patients', pDoc.id, 'xrays'))
          ]);
          return {
            ...pData,
            records: recsSnap.docs.map(r => ({ id: r.id, ...r.data() })),
            teeth: teethSnap.docs.map(t => ({ id: t.id, ...t.data() })),
            xrays: xraysSnap.docs.map(x => ({ id: x.id, ...x.data() }))
          };
        })
      );

      const clinicBackup = {
        platform: 'CrownDent SaaS Single Clinic Backup',
        clinicId: cId,
        clinicInfo: clinic,
        backupTimestamp: new Date().toISOString(),
        data: {
          patients: patientsData,
          appointments: appointmentsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          prescriptions: prescriptionsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          customMedications: customMedSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          customCategories: customCatSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          shifts: shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          expenses: expensesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          inventory: inventorySnap.docs.map(d => ({ id: d.id, ...d.data() })),
          billing: billingSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          dailyClosings: closingsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          laboratories: labsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          labOrders: labOrdersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
          labWorkTypes: labWorkTypesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
      };

      const dateStr = new Date().toISOString().split('T')[0];
      const safeName = (clinic.name || 'Clinic').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
      const blob = new Blob([JSON.stringify(clinicBackup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BACKUP_${safeName}_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      dialogs.alert(`تم استخراج وتنزيل النسخة الاحتياطية لعيادة "${clinic.name}" بنجاح!`, { severity: 'success' });
    } catch (err: any) {
      console.error('Error downloading single clinic backup:', err);
      dialogs.alert('حدث خطأ أثناء تنزيل نسخة العيادة: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setDownloadingClinicId(null);
    }
  };

  // Action: WhatsApp Renewal Reminder
  const handleSendWhatsAppReminder = (clinic: Clinic) => {
    const rawPhone = clinic.doctorPhone || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    if (!cleanPhone) {
      dialogs.alert('لا يوجد رقم هاتف مسجل للطبيب لإرسال رسالة الواتساب.', { severity: 'warning' });
      return;
    }

    // Format phone to international (Egypt default +20)
    let intlPhone = cleanPhone;
    if (intlPhone.startsWith('0')) {
      intlPhone = '2' + intlPhone;
    } else if (!intlPhone.startsWith('20') && intlPhone.length === 10) {
      intlPhone = '20' + intlPhone;
    }

    const expiryStr = clinic.subscriptionExpiresAt ? formatDateTime(clinic.subscriptionExpiresAt) : 'قريباً';
    const message = `مرحباً د. ${clinic.doctorName || ''} 👋\nتحية طيبة من إدارة منظومة CrownDent لإدارة العيادات 🦷\n\nنود تذكير سيادتكم بأن موعد تجديد اشتراك عيادتكم (${clinic.name}) هو:\n📅 ${expiryStr}\n\nيرجى التواصل معنا لتجديد الاشتراك لضمان استمرار عمل المنظومة والمزامنة السحابية بدون انقطاع.\nشكراً لثقتكم بنا ✨`;

    const waUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
  };

  // Action: Toggle Clinic Active Status
  const handleToggleClinicStatus = async (clinic: Clinic) => {
    const newStatus = clinic.isActive === false;
    const confirmText = newStatus 
      ? `هل أنت متأكد من رغبتك في تفعيل عيادة "${clinic.name}" والسماح لها بتسجيل الدخول؟`
      : `هل أنت متأكد من رغبتك في إيقاف وتعطيل عيادة "${clinic.name}" مؤقتاً؟`;

    const confirmed = await dialogs.confirm(confirmText);
    if (!confirmed) return;

    try {
      await updateDoc(doc(db, 'clinics', clinic.id), {
        isActive: newStatus,
        updatedAt: new Date().toISOString()
      });
      dialogs.alert(newStatus ? 'تم تفعيل العيادة بنجاح.' : 'تم إيقاف العيادة مؤقتاً.', { severity: 'success' });
      onRefreshClinics();
    } catch (err: any) {
      dialogs.alert('فشل تغيير حالة العيادة: ' + err.toString(), { severity: 'error' });
    }
  };

  // Action: Delete Clinic
  const handleDeleteClinic = async (clinic: Clinic) => {
    const confirmed = await dialogs.confirm(
      `تحذير حرج ⚠️: هل أنت متأكد تماماً من حذف عيادة "${clinic.name}" وجميع بياناتها وسجلات المرضى التابعة لها نهائياً؟ هذا الإجراء لا يمكن التراجع عنه!`
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'clinics', clinic.id));
      dialogs.alert('تم حذف العيادة نهائياً من المنظومة.', { severity: 'success' });
      onRefreshClinics();
    } catch (err: any) {
      dialogs.alert('فشل حذف العيادة: ' + err.toString(), { severity: 'error' });
    }
  };

  // Action: Open Edit Modal
  const openEditModal = (clinic: Clinic) => {
    setEditingClinic(clinic);
    setEditName(clinic.name || '');
    setEditNameAr(clinic.nameAr || '');
    setEditNameEn(clinic.nameEn || '');
    setEditLogo(clinic.logoUrl || '');
    setEditDoctorName(clinic.doctorName || '');
    setEditDoctorPhone(clinic.doctorPhone || '');
    setEditAddress(clinic.address || '');
    setEditPrescriptionStyle(clinic.prescriptionStyle || 'classic');
    setEditEmail(clinic.email || '');
    setEditPassword(clinic.password || '');
    setEditAllowedFeatures(clinic.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials']);
    setModalError('');
  };

  // Action: Save Edit Clinic
  const handleSaveEditClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClinic) return;
    setModalError('');

    if (!editName.trim() || !editEmail.trim() || !editPassword.trim()) {
      setModalError('يرجى ملء كافة الحقول الأساسية المطلوبة.');
      return;
    }

    const cleanPhone = formatEgyptianPhoneInput(editDoctorPhone.trim());
    if (editDoctorPhone.trim()) {
      const phoneErr = getEgyptianPhoneError(cleanPhone, false, 'رقم هاتف الطبيب');
      if (phoneErr) {
        setModalError(phoneErr);
        return;
      }
    }

    setActionLoading(true);
    try {
      await updateDoc(doc(db, 'clinics', editingClinic.id), {
        name: editName.trim(),
        nameAr: editNameAr.trim(),
        nameEn: editNameEn.trim(),
        logoUrl: editLogo.trim(),
        doctorName: editDoctorName.trim(),
        doctorPhone: cleanPhone,
        address: editAddress.trim(),
        prescriptionStyle: editPrescriptionStyle,
        email: editEmail.trim().toLowerCase(),
        password: editPassword.trim(),
        subscriptionExpiresAt: editingClinic.subscriptionExpiresAt || '',
        allowedFeatures: editAllowedFeatures,
        updatedAt: new Date().toISOString()
      });

      dialogs.alert('تم تحديث بيانات العيادة بنجاح!', { severity: 'success' });
      setEditingClinic(null);
      onRefreshClinics();
    } catch (err: any) {
      setModalError('حدث خطأ أثناء الحفظ: ' + err.toString());
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Create Clinic
  const handleCreateClinicSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    const nameClean = newName.trim();
    const emailClean = newEmail.trim().toLowerCase();
    const passClean = newPassword.trim();

    if (!nameClean || !emailClean || !passClean) {
      setModalError('يرجى ملء اسم العيادة والبريد الإلكتروني وكلمة المرور.');
      return;
    }

    const docPhoneClean = formatEgyptianPhoneInput(newDoctorPhone.trim());
    if (newDoctorPhone.trim()) {
      const phoneErr = getEgyptianPhoneError(docPhoneClean, false, 'رقم هاتف الطبيب');
      if (phoneErr) {
        setModalError(phoneErr);
        return;
      }
    }

    setActionLoading(true);
    try {
      const newClinicId = 'clinic_' + Date.now();
      const clinicData = {
        name: nameClean,
        nameAr: newNameAr.trim() || nameClean,
        nameEn: newNameEn.trim(),
        logoUrl: newLogo.trim(),
        doctorName: newDoctorName.trim() || 'د. طبيب أسنان',
        doctorPhone: docPhoneClean,
        address: newAddress.trim(),
        prescriptionStyle: newPrescriptionStyle,
        email: emailClean,
        password: passClean,
        createdAt: new Date().toISOString(),
        isActive: true,
        subscriptionExpiresAt: newExpiresAt,
        staffPin: '1234',
        staffMembers: [],
        allowedFeatures: newAllowedFeatures
      };

      await setDoc(doc(db, 'clinics', newClinicId), clinicData);

      // Record initial renewal/payment if amount > 0
      const paid = Number(newPaidAmount);
      if (paid > 0) {
        await setDoc(doc(db, 'renewals', 'ren_' + Date.now()), {
          clinicId: newClinicId,
          clinicName: nameClean,
          oldExpiry: new Date().toISOString(),
          newExpiry: newExpiresAt,
          renewedAt: new Date().toISOString(),
          amount: paid,
          paymentMethod: newPaymentMethod,
          notes: 'دفعة الاشتراك المبدئي عند إنشاء العيادة'
        });
      }

      dialogs.alert(`تم إنشاء وتفعيل عيادة "${nameClean}" بنجاح!`, { severity: 'success' });
      setShowAddModal(false);
      // Reset form
      setNewName('');
      setNewNameAr('');
      setNewNameEn('');
      setNewLogo('');
      setNewDoctorName('');
      setNewDoctorPhone('');
      setNewEmail('');
      setNewPassword('');
      onRefreshClinics();
    } catch (err: any) {
      setModalError('فشل إنشاء العيادة: ' + err.toString());
    } finally {
      setActionLoading(false);
    }
  };

  // Helper for Duration selection in forms
  const applyPresetDuration = (months: number, setter: (val: string) => void) => {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    const pad = (num: number) => String(num).padStart(2, '0');
    setter(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Header & Search & Add Button */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-emerald-600" />
            إدارة العيادات المشتركة ({clinics.length})
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            متابعة حسابات الأطباء، صلاحيات المنظومة، كلمات المرور وتجديد الاشتراكات السحابية
          </p>
        </div>

        <button
          id="btn-add-clinic-modal"
          onClick={() => {
            setShowAddModal(true);
            setModalError('');
          }}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl shadow-md transition cursor-pointer"
        >
          <Plus className="h-5 w-5" />
          إضافة عيادة جديدة
        </button>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Status Filter Buttons */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
            <button
              onClick={() => { setStatusFilter('all'); setCurrentPage(1); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              الكل
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'}`}>
                {statusCounts.all}
              </span>
            </button>

            <button
              onClick={() => { setStatusFilter('active'); setCurrentPage(1); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                statusFilter === 'active'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              نشطة
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusFilter === 'active' ? 'bg-emerald-700 text-white' : 'bg-emerald-200 text-emerald-800'}`}>
                {statusCounts.active}
              </span>
            </button>

            <button
              onClick={() => { setStatusFilter('expiring'); setCurrentPage(1); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                statusFilter === 'expiring'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              أوشكت على الانتهاء (≤7 أيام)
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusFilter === 'expiring' ? 'bg-amber-700 text-white' : 'bg-amber-200 text-amber-800'}`}>
                {statusCounts.expiring}
              </span>
            </button>

            <button
              onClick={() => { setStatusFilter('expired'); setCurrentPage(1); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                statusFilter === 'expired'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              منتهية الاشتراك
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusFilter === 'expired' ? 'bg-rose-700 text-white' : 'bg-rose-200 text-rose-800'}`}>
                {statusCounts.expired}
              </span>
            </button>

            <button
              onClick={() => { setStatusFilter('inactive'); setCurrentPage(1); }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                statusFilter === 'inactive'
                  ? 'bg-slate-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Power className="h-3.5 w-3.5" />
              موقوفة
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusFilter === 'inactive' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                {statusCounts.inactive}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[280px]">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="بحث بالعيادة، اسم الطبيب، الهاتف أو الإيميل..."
              className="w-full pl-4 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                مسح
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Clinics Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="p-3.5">العيادة والطبيب</th>
                <th className="p-3.5">بيانات الدخول</th>
                <th className="p-3.5">صلاحية الاشتراك</th>
                <th className="p-3.5">إحصائيات الاستخدام</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5 text-center">الإجراءات والتحكم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedClinics.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    لا توجد عيادات مطابقة لمعايير البحث أو الفلتر المحدد.
                  </td>
                </tr>
              ) : (
                paginatedClinics.map((clinic) => {
                  const usage = clinicUsage.find(u => u.id === clinic.id);
                  const isPasswordVisible = !!visiblePasswords[clinic.id];
                  const expiryInfo = getDaysRemainingText(clinic.subscriptionExpiresAt);
                  const isDownloading = downloadingClinicId === clinic.id;

                  return (
                    <tr key={clinic.id} className="hover:bg-slate-50/70 transition">
                      {/* Clinic & Doctor Info */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-3">
                          {clinic.logoUrl ? (
                            <img
                              src={clinic.logoUrl}
                              alt={clinic.name}
                              className="h-10 w-10 rounded-xl object-contain border border-slate-200 bg-white p-0.5 shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 font-bold flex items-center justify-center border border-emerald-100 shrink-0">
                              <Building2 className="h-5 w-5" />
                            </div>
                          )}
                          <div>
                            <div className="font-bold text-slate-800 text-sm">{clinic.name}</div>
                            <div className="text-slate-500 font-medium text-xs mt-0.5 flex items-center gap-1.5">
                              <span>د. {clinic.doctorName || 'غير محدد'}</span>
                              {clinic.doctorPhone && (
                                <span className="text-[11px] text-slate-400 font-mono" dir="ltr">
                                  {clinic.doctorPhone}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Credentials (Masked) */}
                      <td className="p-3.5 font-mono">
                        <div className="space-y-1">
                          <div className="text-slate-700 text-xs select-all">{clinic.email}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-900 font-bold bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                              {isPasswordVisible ? clinic.password : '••••••••'}
                            </span>
                            <button
                              onClick={() => togglePasswordVisibility(clinic.id)}
                              title={isPasswordVisible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                              className="p-1 text-slate-400 hover:text-slate-700 rounded transition cursor-pointer"
                            >
                              {isPasswordVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Expiry Date */}
                      <td className="p-3.5">
                        <div className="space-y-1">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${expiryInfo.color}`}>
                            <Clock className="h-3 w-3" />
                            {expiryInfo.text}
                          </span>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {clinic.subscriptionExpiresAt ? clinic.subscriptionExpiresAt.split('T')[0] : 'غير محدد'}
                          </div>
                        </div>
                      </td>

                      {/* Usage metrics */}
                      <td className="p-3.5">
                        <div className="flex items-center gap-3 text-slate-600">
                          <span title="عدد المرضى" className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg text-[11px] font-bold">
                            <Users className="h-3 w-3 text-indigo-500" />
                            {usage ? usage.numPatients : 0} مريض
                          </span>
                          <span title="عدد المواعيد" className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg text-[11px] font-bold">
                            <Calendar className="h-3 w-3 text-emerald-500" />
                            {usage ? usage.numAppointments : 0}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="p-3.5">
                        {clinic.isActive === false ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            موقوفة
                          </span>
                        ) : isSubscriptionExpired(clinic.subscriptionExpiresAt) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                            منتهية
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            نشطة
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Login / Switch Session */}
                          <button
                            onClick={() => saveSession({ type: 'clinic', clinicId: clinic.id, clinicName: clinic.name })}
                            title="تسجيل الدخول كطبيب للعيادة"
                            className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition cursor-pointer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>

                          {/* WhatsApp Reminder */}
                          <button
                            onClick={() => handleSendWhatsAppReminder(clinic)}
                            title="إرسال تذكير تجديد الاشتراك عبر الواتساب"
                            className="p-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg transition cursor-pointer"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>

                          {/* Single Clinic Backup */}
                          <button
                            onClick={() => handleDownloadSingleClinicBackup(clinic)}
                            disabled={isDownloading}
                            title="تنزيل نسخة احتياطية خاصة ببيانات هذه العيادة"
                            className="p-1.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded-lg transition cursor-pointer disabled:opacity-50"
                          >
                            <Download className={`h-4 w-4 ${isDownloading ? 'animate-bounce' : ''}`} />
                          </button>

                          {/* Edit Clinic */}
                          <button
                            onClick={() => openEditModal(clinic)}
                            title="تعديل بيانات العيادة وصلاحياتها"
                            className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition cursor-pointer"
                          >
                            <Edit className="h-4 w-4" />
                          </button>

                          {/* Toggle Active */}
                          <button
                            onClick={() => handleToggleClinicStatus(clinic)}
                            title={clinic.isActive === false ? 'تفعيل العيادة' : 'إيقاف العيادة مؤقتاً'}
                            className={`p-1.5 rounded-lg transition cursor-pointer ${
                              clinic.isActive === false
                                ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                          >
                            <Power className="h-4 w-4" />
                          </button>

                          {/* Delete Clinic */}
                          <button
                            onClick={() => handleDeleteClinic(clinic)}
                            title="حذف العيادة نهائياً"
                            className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <div className="text-xs text-slate-500 font-medium">
              عرض {((currentPage - 1) * pageSize) + 1} إلى {Math.min(currentPage * pageSize, filteredClinics.length)} من أصل {filteredClinics.length} عيادة
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <div className="text-xs font-bold text-slate-700 px-2">
                صفحة {currentPage} من {totalPages}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===================== CREATE CLINIC MODAL ===================== */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-6 w-6 text-emerald-400" />
                <h3 className="text-lg font-bold">إضافة عيادة جديدة للمنظومة</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateClinicSubmit} className="p-6 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">اسم العيادة (الرئيسي) *</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="مثال: عيادة الدكتور لطب الأسنان"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">اسم الطبيب المسؤول *</label>
                  <input
                    type="text"
                    required
                    value={newDoctorName}
                    onChange={(e) => setNewDoctorName(e.target.value)}
                    placeholder="د. محمد أحمد"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">البريد الإلكتروني لتسجيل الدخول *</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="doctor@example.com"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">كلمة المرور *</label>
                  <input
                    type="text"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="كلمة مرور الدخول"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    رقم هاتف الطبيب / الواتساب
                    <span className="text-xs text-slate-400 font-normal mr-1">(11 رقم يبدأ بـ 01)</span>
                  </label>
                  <input
                    type="tel"
                    maxLength={11}
                    inputMode="numeric"
                    value={newDoctorPhone}
                    onChange={(e) => setNewDoctorPhone(formatEgyptianPhoneInput(e.target.value))}
                    placeholder="01012345678"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 font-mono font-bold"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">عنوان العيادة</label>
                  <input
                    type="text"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="المدينة، الشارع"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800"
                  />
                </div>
              </div>

              {/* Subscription Expiry & Duration Presets */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                <label className="block text-slate-700 font-bold">مدة وتاريخ انتهاء الاشتراك *</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => applyPresetDuration(1, setNewExpiresAt)}
                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-100 transition text-[11px]"
                  >
                    شهر واحد (30 يوم)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetDuration(3, setNewExpiresAt)}
                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-100 transition text-[11px]"
                  >
                    3 أشهر
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetDuration(6, setNewExpiresAt)}
                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-100 transition text-[11px]"
                  >
                    6 أشهر
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetDuration(12, setNewExpiresAt)}
                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-bold hover:bg-slate-100 transition text-[11px]"
                  >
                    سنة كاملة (12 شهر)
                  </button>
                </div>
                <input
                  type="datetime-local"
                  required
                  value={newExpiresAt}
                  onChange={(e) => setNewExpiresAt(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 font-mono text-xs"
                />
              </div>

              {/* Initial Paid Amount */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                <div>
                  <label className="block text-emerald-900 font-bold mb-1">مبلغ الاشتراك المسدد المبدئي (ج.م)</label>
                  <input
                    type="number"
                    value={newPaidAmount}
                    onChange={(e) => setNewPaidAmount(e.target.value)}
                    placeholder="500"
                    className="w-full p-2.5 bg-white border border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-emerald-900 font-bold mb-1">طريقة الدفع</label>
                  <select
                    value={newPaymentMethod}
                    onChange={(e) => setNewPaymentMethod(e.target.value as any)}
                    className="w-full p-2.5 bg-white border border-emerald-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 font-bold"
                  >
                    <option value="cash">نقداً (كاش)</option>
                    <option value="wallet">محفظة إلكترونية (فودافون كاش)</option>
                    <option value="instapay">إنستاباي (InstaPay)</option>
                    <option value="card">بطاقة بنكية / فيزا</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-bold rounded-xl transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50 flex items-center gap-2"
                >
                  {actionLoading ? 'جاري الإنشاء...' : 'حفظ وتفعيل العيادة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== EDIT CLINIC MODAL ===================== */}
      {editingClinic && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit className="h-6 w-6 text-indigo-400" />
                <h3 className="text-lg font-bold">تعديل بيانات العيادة: {editingClinic.name}</h3>
              </div>
              <button
                onClick={() => setEditingClinic(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditClinic} className="p-6 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-bold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">اسم العيادة *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">اسم الطبيب المسؤول *</label>
                  <input
                    type="text"
                    required
                    value={editDoctorName}
                    onChange={(e) => setEditDoctorName(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">البريد الإلكتروني للدخول *</label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">كلمة المرور *</label>
                  <input
                    type="text"
                    required
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    رقم الهاتف / الواتساب
                    <span className="text-xs text-slate-400 font-normal mr-1">(11 رقم يبدأ بـ 01)</span>
                  </label>
                  <input
                    type="tel"
                    maxLength={11}
                    inputMode="numeric"
                    value={editDoctorPhone}
                    onChange={(e) => setEditDoctorPhone(formatEgyptianPhoneInput(e.target.value))}
                    placeholder="01012345678"
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono font-bold"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">العنوان</label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingClinic(null)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-bold rounded-xl transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition disabled:opacity-50 flex items-center gap-2"
                >
                  {actionLoading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
