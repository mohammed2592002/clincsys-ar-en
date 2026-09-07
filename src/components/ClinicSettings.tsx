import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  db, 
  updateDoc, 
  doc, 
  setDoc, 
  getDocsSmart as getDocs,
  getDocSmart, 
  collection 
} from '../dbClient';
import { Clinic, StaffMember, SupportSettings, SupportContact, SocialContact, DEFAULT_SUPPORT_SETTINGS, CustomDentalService, DentalTooth, QuestionnaireQuestion, DEFAULT_QUESTIONNAIRE_QUESTIONS, CustomPrescriptionPadConfig, DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG } from '../types';
import { CustomPrescriptionPadEditor } from './CustomPrescriptionPadEditor';
import { useDialogs } from './DialogContext';
import { 
  fetchNetworkTime, 
  getRealDate, 
  isClinicExpired, 
  formatDateTime,
  checkSubscriptionBlocked
} from '../utils/timeUtils';
import { safeStorage, getEffectivePadConfig, saveEffectivePadConfig } from '../utils/storage';
import { getLocalTodayStr, createZipBlob, readBackupFile } from '../utils/backupService';
import { resizeImageToWidth190 } from '../utils';
import { uploadFileToR2 } from '../utils/r2Upload';
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from '../utils/phoneUtils';


import { 
  Users, 
  Plus, 
  Trash2, 
  Activity, 
  Building2, 
  ShieldCheck, 
  Key, 
  CheckCircle, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  Settings, 
  Receipt, 
  UserPlus, 
  KeyRound, 
  Edit2, 
  X, 
  Database, 
  Download, 
  Upload, 
  HardDrive, 
  FileArchive,
  Sparkles, 
  Info,
  FileSpreadsheet,
  Edit,
  Ticket,
  Clock,
  Calendar as CalendarIcon,
  Phone,
  MapPin,
  CreditCard,
  Calendar,
  FileText,
  Beaker,
  Check,
  Headphones,
  MessageSquare,
  Globe,
  Send,
  ExternalLink,
  Share2,
  LifeBuoy,
  PhoneCall,
  Copy,
  Mail,
  Tag,
  Stethoscope,
  Search,
  ClipboardList,
  RotateCcw,
  Gift,
  Save,
  RefreshCw,
  ChevronDown,
  Filter
} from 'lucide-react';

type SessionState = 
  | { type: 'logged_out' }
  | { type: 'admin' }
  | { type: 'clinic'; clinicId: string; clinicName: string }
  | { type: 'clinic_staff'; clinicId: string; clinicName: string; staffName?: string; staffRole?: string };

interface ClinicSettingsProps {
  clinicId: string;
  clinic: Clinic;
  session: SessionState;
  setSession: (session: SessionState) => void;
  onClinicDataUpdated: (updated: Clinic) => void;
}

export default function ClinicSettings({ 
  clinicId, 
  clinic, 
  session, 
  setSession, 
  onClinicDataUpdated 
}: ClinicSettingsProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();

  // Local inputs/states
  const [staffPinInput, setStaffPinInput] = useState('1234');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('سكرتير / استقبال');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [showStaffPasswords, setShowStaffPasswords] = useState<{[key: string]: boolean}>({});
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [selectedStaffTabs, setSelectedStaffTabs] = useState<string[]>(['patients', 'calendar', 'prescriptions', 'laboratory', 'financials']);

  const isFeatureAllowedForClinic = (featId: string) => {
    const allowedFeatures = clinic.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];
    if (allowedFeatures.includes(featId)) return true;
    
    // If it's a sub-financial feature and clinic has 'financials' but no explicit sub-features set
    const subIds = ['financials_daily_closing', 'financials_closing_log', 'financials_reports', 'financials_patients_installments', 'financials_expenses'];
    if (subIds.includes(featId)) {
      const hasExplicitSubPerms = subIds.some(id => allowedFeatures.includes(id));
      if (!hasExplicitSubPerms && allowedFeatures.includes('financials')) return true;
    }
    return false;
  };

  const getClinicAllAllowedTabs = () => {
    const defaultTabs = ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];
    const clinicFeatures = clinic.allowedFeatures || defaultTabs;
    
    const subIds = ['financials_daily_closing', 'financials_closing_log', 'financials_reports', 'financials_patients_installments', 'financials_expenses'];
    const hasExplicitSubPerms = subIds.some(id => clinicFeatures.includes(id));
    
    let result = [...clinicFeatures];
    if (!hasExplicitSubPerms && clinicFeatures.includes('financials')) {
      result = [...result, ...subIds];
    }
    return result;
  };

  const [clinicNameInput, setClinicNameInput] = useState(clinic.name || clinic.nameEn || '');
  const [clinicNameArInput, setClinicNameArInput] = useState(clinic.nameAr || '');
  const [clinicNameEnInput, setClinicNameEnInput] = useState(clinic.nameEn || clinic.name || '');
  const [clinicLogoInput, setClinicLogoInput] = useState(clinic.logoUrl || '');
  const [clinicDoctorNameInput, setClinicDoctorNameInput] = useState(clinic.doctorName || '');
  const [clinicDoctorNameEnInput, setClinicDoctorNameEnInput] = useState(clinic.doctorNameEn || '');
  const [clinicDoctorPhoneInput, setClinicDoctorPhoneInput] = useState(clinic.doctorPhone || '');
  const [additionalPhonesInput, setAdditionalPhonesInput] = useState<string[]>(clinic.additionalPhones || []);
  const [clinicDoctorSpecialtyArInput, setClinicDoctorSpecialtyArInput] = useState(clinic.doctorSpecialtyAr || '');
  const [clinicDoctorSpecialtyEnInput, setClinicDoctorSpecialtyEnInput] = useState(clinic.doctorSpecialtyEn || '');
  const [clinicHoursInput, setClinicHoursInput] = useState(clinic.clinicHours || '');
  const [clinicAddressInput, setClinicAddressInput] = useState(clinic.address || '');
  const [clinicPrescriptionStyleInput, setClinicPrescriptionStyleInput] = useState<'classic' | 'modern' | 'minimal' | 'elegant' | 'custom_pad'>(clinic.prescriptionStyle || 'classic');
  const [clinicPrescriptionLayoutInput, setClinicPrescriptionLayoutInput] = useState<'traditional' | 'table'>(clinic.prescriptionLayout || 'traditional');
  const [customPrescriptionPadConfigInput, setCustomPrescriptionPadConfigInput] = useState<CustomPrescriptionPadConfig>(() => getEffectivePadConfig(clinicId, clinic.customPrescriptionPadConfig));
  const [clinicConsultationPriceInput, setClinicConsultationPriceInput] = useState<number>(clinic.consultationPrice || 0);
  const [bookingSystemModeInput, setBookingSystemModeInput] = useState<'time' | 'turn' | 'hybrid'>(clinic.bookingSystemMode || 'hybrid');

  useEffect(() => {
    if (clinic) {
      if (clinic.name || clinic.nameEn) setClinicNameInput(clinic.name || clinic.nameEn || '');
      if (clinic.nameAr) setClinicNameArInput(clinic.nameAr || '');
      if (clinic.nameEn || clinic.name) setClinicNameEnInput(clinic.nameEn || clinic.name || '');
      if (clinic.logoUrl !== undefined) setClinicLogoInput(clinic.logoUrl || '');
      if (clinic.doctorName !== undefined) setClinicDoctorNameInput(clinic.doctorName || '');
      if (clinic.doctorNameEn !== undefined) setClinicDoctorNameEnInput(clinic.doctorNameEn || '');
      if (clinic.doctorPhone !== undefined) setClinicDoctorPhoneInput(clinic.doctorPhone || '');
      if (clinic.additionalPhones !== undefined) setAdditionalPhonesInput(clinic.additionalPhones || []);
      if (clinic.doctorSpecialtyAr !== undefined) setClinicDoctorSpecialtyArInput(clinic.doctorSpecialtyAr || '');
      if (clinic.doctorSpecialtyEn !== undefined) setClinicDoctorSpecialtyEnInput(clinic.doctorSpecialtyEn || '');
      if (clinic.clinicHours !== undefined) setClinicHoursInput(clinic.clinicHours || '');
      if (clinic.address !== undefined) setClinicAddressInput(clinic.address || '');
      if (clinic.prescriptionStyle) setClinicPrescriptionStyleInput(clinic.prescriptionStyle || 'classic');
      if (clinic.prescriptionLayout) setClinicPrescriptionLayoutInput(clinic.prescriptionLayout || 'traditional');
      if (clinic.customPrescriptionPadConfig) setCustomPrescriptionPadConfigInput(getEffectivePadConfig(clinicId, clinic.customPrescriptionPadConfig));
      if (clinic.consultationPrice !== undefined) setClinicConsultationPriceInput(clinic.consultationPrice || 0);
      if (clinic.bookingSystemMode) setBookingSystemModeInput(clinic.bookingSystemMode || 'hybrid');
    }
  }, [
    clinic.name,
    clinic.nameAr,
    clinic.nameEn,
    clinic.logoUrl,
    clinic.doctorName,
    clinic.doctorNameEn,
    clinic.doctorPhone,
    clinic.additionalPhones,
    clinic.doctorSpecialtyAr,
    clinic.doctorSpecialtyEn,
    clinic.clinicHours,
    clinic.address,
    clinic.prescriptionStyle,
    clinic.prescriptionLayout,
    clinic.consultationPrice,
    clinic.bookingSystemMode,
    clinicId
  ]);

  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupRestoreStatus, setBackupRestoreStatus] = useState('');
  const [exportFormat, setExportFormat] = useState<'zip' | 'json' | 'db' | 'sql'>('zip');
  
  // Auto Daily Backup States
  const [autoBackupEnabled, setAutoBackupEnabled] = useState<boolean>(() => {
    return safeStorage.getItem(`auto_backup_enabled_${clinicId}`) === 'true' || clinic?.autoBackupEnabled === true;
  });
  const [autoBackupFormat, setAutoBackupFormat] = useState<'zip' | 'json' | 'db' | 'sql'>(() => {
    return (safeStorage.getItem(`auto_backup_format_${clinicId}`) as 'zip' | 'json' | 'db' | 'sql') || clinic?.autoBackupFormat || 'zip';
  });
  const [lastAutoBackupDate, setLastAutoBackupDate] = useState<string>(() => {
    return safeStorage.getItem(`auto_backup_last_date_${clinicId}`) || 'لم تتم بعد اليوم';
  });

  const [settingsSubTab, setSettingsSubTab] = useState<'profile' | 'services_prices' | 'questionnaire' | 'staff' | 'backup' | 'subscription' | 'payment_methods' | 'tech_support' | 'loyalty_program'>('profile');
  const [profileSubSection, setProfileSubSection] = useState<'identity' | 'doctor' | 'contact' | 'style' | 'booking'>('identity');

  // Loyalty Program State & Redemptions Log
  const [loyaltyEnabledInput, setLoyaltyEnabledInput] = useState<boolean>(clinic.loyaltyProgramEnabled !== false);
  const [loyaltyEarnEgpThresholdInput, setLoyaltyEarnEgpThresholdInput] = useState<number | string>(clinic.loyaltyEarnEgpThreshold ?? 100);
  const [loyaltyEarnPointsInput, setLoyaltyEarnPointsInput] = useState<number | string>(clinic.loyaltyEarnPoints ?? 20);
  const [loyaltyRedeemPointsThresholdInput, setLoyaltyRedeemPointsThresholdInput] = useState<number | string>(clinic.loyaltyRedeemPointsThreshold ?? 1000);
  const [loyaltyRedeemDiscountEgpInput, setLoyaltyRedeemDiscountEgpInput] = useState<number | string>(clinic.loyaltyRedeemDiscountEgp ?? 250);
  const [loyaltyMinRedeemPointsInput, setLoyaltyMinRedeemPointsInput] = useState<number | string>(clinic.loyaltyMinRedeemPoints ?? '');

  const [redemptionLogs, setRedemptionLogs] = useState<Array<{
    id: string;
    patientId: string;
    patientName: string;
    patientPhone: string;
    date: string;
    createdAt?: string;
    amount: number;
    notes: string;
    appointmentId: string;
    serviceName: string;
  }>>([]);
  const [isLoadingRedemptions, setIsLoadingRedemptions] = useState(false);
  const [redemptionSearchTerm, setRedemptionSearchTerm] = useState('');
  const [redemptionPeriodFilter, setRedemptionPeriodFilter] = useState<'all' | 'day' | 'week' | 'month'>('all');
  const [redemptionVisibleCount, setRedemptionVisibleCount] = useState<number>(5);
  const [showRedemptionsLog, setShowRedemptionsLog] = useState(false);

  useEffect(() => {
    if (settingsSubTab === 'loyalty_program' && showRedemptionsLog) {
      fetchLoyaltyRedemptions();
    }
  }, [settingsSubTab, showRedemptionsLog, clinicId]);

  useEffect(() => {
    if (clinic) {
      setLoyaltyEnabledInput(clinic.loyaltyProgramEnabled !== false);
      setLoyaltyEarnEgpThresholdInput(clinic.loyaltyEarnEgpThreshold ?? 100);
      setLoyaltyEarnPointsInput(clinic.loyaltyEarnPoints ?? 20);
      setLoyaltyRedeemPointsThresholdInput(clinic.loyaltyRedeemPointsThreshold ?? 1000);
      setLoyaltyRedeemDiscountEgpInput(clinic.loyaltyRedeemDiscountEgp ?? 250);
      setLoyaltyMinRedeemPointsInput(clinic.loyaltyMinRedeemPoints ?? '');
    }
  }, [
    clinic.loyaltyProgramEnabled,
    clinic.loyaltyEarnEgpThreshold,
    clinic.loyaltyEarnPoints,
    clinic.loyaltyRedeemPointsThreshold,
    clinic.loyaltyRedeemDiscountEgp,
    clinic.loyaltyMinRedeemPoints
  ]);

  // Patient Questionnaire State
  const [questionnaireQuestions, setQuestionnaireQuestions] = useState<QuestionnaireQuestion[]>(() => {
    return clinic.questionnaireQuestions && clinic.questionnaireQuestions.length > 0
      ? clinic.questionnaireQuestions
      : DEFAULT_QUESTIONNAIRE_QUESTIONS;
  });
  const [showAddQuestionForm, setShowAddQuestionForm] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [newQuestionPlaceholder, setNewQuestionPlaceholder] = useState('');
  const [newQuestionCategory, setNewQuestionCategory] = useState('');

  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editQuestionText, setEditQuestionText] = useState('');
  const [editQuestionPlaceholder, setEditQuestionPlaceholder] = useState('');
  const [editQuestionCategory, setEditQuestionCategory] = useState('');

  useEffect(() => {
    if (clinic.questionnaireQuestions && clinic.questionnaireQuestions.length > 0) {
      setQuestionnaireQuestions(clinic.questionnaireQuestions);
    } else {
      setQuestionnaireQuestions(DEFAULT_QUESTIONNAIRE_QUESTIONS);
    }
  }, [clinic.questionnaireQuestions]);

  const handleSaveQuestionsList = async (newList: QuestionnaireQuestion[], successMessage: string) => {
    try {
      setSettingsError('');
      setSettingsSuccess('');
      setQuestionnaireQuestions(newList);
      await updateDoc(doc(db, 'clinics', clinicId), {
        questionnaireQuestions: newList
      });
      onClinicDataUpdated({
        ...clinic,
        questionnaireQuestions: newList
      });
      setSettingsSuccess(successMessage);
    } catch (err: any) {
      console.error("Error updating questionnaire questions:", err);
      setSettingsError("حدث خطأ أثناء حفظ أسئلة الاستبيان.");
    }
  };

  const handleAddQuestionInSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestionText.trim()) {
      setSettingsError('يرجى إدخال نص السؤال المضاف للاستبيان');
      return;
    }
    const newQ: QuestionnaireQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      text: newQuestionText.trim(),
      placeholder: newQuestionPlaceholder.trim() || 'اكتب التفاصيل في حال الإجابة بـ نعم...',
      category: newQuestionCategory.trim() || 'أسئلة عامة',
      enabled: true
    };
    const newList = [...questionnaireQuestions, newQ];
    await handleSaveQuestionsList(newList, 'تمت إضافة السؤال بنجاح إلى استبيان المرضى!');
    setNewQuestionText('');
    setNewQuestionPlaceholder('');
    setNewQuestionCategory('');
    setShowAddQuestionForm(false);
  };

  const handleToggleQuestionInSettings = async (qId: string) => {
    const newList = questionnaireQuestions.map(q => 
      q.id === qId ? { ...q, enabled: !q.enabled } : q
    );
    await handleSaveQuestionsList(newList, 'تم تحديث حالة السؤال في الاستبيان');
  };

  const handleStartEditQuestion = (q: QuestionnaireQuestion) => {
    setEditingQuestionId(q.id);
    setEditQuestionText(q.text);
    setEditQuestionPlaceholder(q.placeholder || '');
    setEditQuestionCategory(q.category || '');
  };

  const handleSaveEditedQuestion = async (qId: string) => {
    if (!editQuestionText.trim()) {
      setSettingsError('يرجى إدخال نص السؤال');
      return;
    }
    const newList = questionnaireQuestions.map(q => 
      q.id === qId ? {
        ...q,
        text: editQuestionText.trim(),
        placeholder: editQuestionPlaceholder.trim(),
        category: editQuestionCategory.trim()
      } : q
    );
    await handleSaveQuestionsList(newList, 'تم تعديل السؤال بنجاح!');
    setEditingQuestionId(null);
  };

  const handleDeleteQuestionInSettings = async (qId: string, qText: string) => {
    const confirmed = await dialogs.confirm({
      title: 'حذف سؤال من الاستبيان',
      message: `هل أنت تأكد من حذف السؤال "${qText}" من استبيان العيادة؟`,
      confirmLabel: 'نعم، احذف السؤال',
      variant: 'danger'
    });
    if (!confirmed) return;

    const newList = questionnaireQuestions.filter(q => q.id !== qId);
    await handleSaveQuestionsList(newList, 'تم حذف السؤال من استبيان المرضى');
  };

  const handleResetQuestionsToDefaults = async () => {
    const confirmed = await dialogs.confirm({
      title: 'استعادة الأسئلة الافتراضية',
      message: 'هل تريد إعادة ضبط استبيان المرضى للأسئلة الافتراضية للعيادة؟',
      confirmLabel: 'نعم، استعادة الافتراضي',
      variant: 'warning'
    });
    if (!confirmed) return;

    await handleSaveQuestionsList(DEFAULT_QUESTIONNAIRE_QUESTIONS, 'تمت استعادة الأسئلة الافتراضية لاستبيان العيادة بنجاح');
  };

  // Price List & Services State
  const defaultServicesList: CustomDentalService[] = [
    { id: '1', name: 'حشو ليزر تجميلي', price: 600, condition: 'filled', category: 'حشوات وعلاج عصب' },
    { id: '2', name: 'حشو عصب كامل', price: 1500, condition: 'filled', category: 'حشوات وعلاج عصب' },
    { id: '3', name: 'خلع جراحي / عادي', price: 700, condition: 'missing', category: 'خلع وجراحة' },
    { id: '4', name: 'تنظيف وتلميع الجذور', price: 450, condition: 'healthy', category: 'تنظيف وقاية وتجميل' },
    { id: '5', name: 'تلبيسة زيركون تجميلية', price: 2500, condition: 'crown', category: 'تركيبات وتلبيسات' },
    { id: '6', name: 'علاج عصب أطفال', price: 800, condition: 'filled', category: 'طب أسنان الأطفال' },
    { id: '7', name: 'زراعة ضرس فوري', price: 7500, condition: 'implant', category: 'زراعة وجسور' },
    { id: '8', name: 'جسر خزفي 3 وحدات', price: 4500, condition: 'bridge', category: 'زراعة وجسور' },
    { id: '9', name: 'تركيب تقويم أسنان (كامل/فكين)', price: 8000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' }
  ];

  const defaultCategoriesList = [
    'حشوات وعلاج عصب',
    'خلع وجراحة',
    'تقويم وتجميل الأسنان',
    'تركيبات وتلبيسات',
    'زراعة وجسور',
    'تنظيف وقاية وتجميل',
    'طب أسنان الأطفال',
    'عام'
  ];

  const [settingsServicesList, setSettingsServicesList] = useState<CustomDentalService[]>(() => {
    const list = (clinic.customDentalServices && clinic.customDentalServices.length > 0)
      ? clinic.customDentalServices
      : defaultServicesList;
    if (!list.some(s => s.condition === 'ortho' || s.category === 'تقويم وتجميل الأسنان')) {
      return [...list, { id: '9', name: 'تركيب تقويم أسنان (كامل/فكين)', price: 8000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' }];
    }
    return list;
  });

  const [settingsCategoriesList, setSettingsCategoriesList] = useState<string[]>(() => {
    const list = (clinic.dentalServiceCategories && clinic.dentalServiceCategories.length > 0)
      ? clinic.dentalServiceCategories
      : defaultCategoriesList;
    if (!list.includes('تقويم وتجميل الأسنان')) {
      return [...list, 'تقويم وتجميل الأسنان'];
    }
    return list;
  });

  useEffect(() => {
    if (clinic.customDentalServices && clinic.customDentalServices.length > 0) {
      const list = clinic.customDentalServices;
      if (!list.some(s => s.condition === 'ortho' || s.category === 'تقويم وتجميل الأسنان')) {
        setSettingsServicesList([...list, { id: '9', name: 'تركيب تقويم أسنان (كامل/فكين)', price: 8000, condition: 'ortho', category: 'تقويم وتجميل الأسنان' }]);
      } else {
        setSettingsServicesList(list);
      }
    }
  }, [clinic.customDentalServices]);

  useEffect(() => {
    if (clinic.dentalServiceCategories && clinic.dentalServiceCategories.length > 0) {
      const list = clinic.dentalServiceCategories;
      if (!list.includes('تقويم وتجميل الأسنان')) {
        setSettingsCategoriesList([...list, 'تقويم وتجميل الأسنان']);
      } else {
        setSettingsCategoriesList(list);
      }
    }
  }, [clinic.dentalServiceCategories]);

  // Form states for services & categories in settings
  const [srvName, setSrvName] = useState('');
  const [srvCategory, setSrvCategory] = useState('حشوات وعلاج عصب');
  const [srvPrice, setSrvPrice] = useState<number>(500);
  const [srvCondition, setSrvCondition] = useState<DentalTooth['condition']>('filled');
  const [editingSrvId, setEditingSrvId] = useState<string | null>(null);

  const [newCatNameInput, setNewCatNameInput] = useState('');
  const [editingCatIdx, setEditingCatIdx] = useState<number | null>(null);
  const [editCatValInput, setEditCatValInput] = useState('');

  const [serviceSearchTerm, setServiceSearchTerm] = useState('');
  const [selectedCatFilter, setSelectedCatFilter] = useState<string>('all');
  const [servicesActiveTab, setServicesActiveTab] = useState<'services' | 'categories'>('services');

  const handleSaveServicesToClinic = async (updatedServices: CustomDentalService[]) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setSettingsServicesList(updatedServices);
    if (clinicId) {
      safeStorage.setItem(`dental_services_${clinicId}`, JSON.stringify(updatedServices));
    }
    try {
      const docRef = doc(db, 'clinics', clinicId);
      await updateDoc(docRef, { customDentalServices: updatedServices });
      onClinicDataUpdated({ ...clinic, customDentalServices: updatedServices });
      setSettingsSuccess('تم حفظ قائمة الأسعار والخدمات بنجاح!');
    } catch (err: any) {
      setSettingsError('حدث خطأ أثناء حفظ قائمة الأسعار: ' + (err.message || err.toString()));
    }
  };

  const handleSaveCategoriesToClinic = async (updatedCategories: string[]) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setSettingsCategoriesList(updatedCategories);
    if (clinicId) {
      safeStorage.setItem(`dental_categories_${clinicId}`, JSON.stringify(updatedCategories));
    }
    try {
      const docRef = doc(db, 'clinics', clinicId);
      await updateDoc(docRef, { dentalServiceCategories: updatedCategories });
      onClinicDataUpdated({ ...clinic, dentalServiceCategories: updatedCategories });
      setSettingsSuccess('تم حفظ أقسام الخدمات بنجاح!');
    } catch (err: any) {
      setSettingsError('حدث خطأ أثناء حفظ الأقسام: ' + (err.message || err.toString()));
    }
  };

  const handleAddOrUpdateServiceInSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!srvName.trim()) {
      dialogs.alert('يرجى كتابة اسم الخدمة أو الإجراء الطبي أولاً', { severity: 'warning' });
      return;
    }

    let updated: CustomDentalService[];
    if (editingSrvId) {
      updated = settingsServicesList.map(s => s.id === editingSrvId ? {
        id: editingSrvId,
        name: srvName.trim(),
        price: Number(srvPrice) || 0,
        condition: srvCondition,
        category: srvCategory
      } : s);
      setEditingSrvId(null);
    } else {
      const newSrv: CustomDentalService = {
        id: 'srv_' + Date.now(),
        name: srvName.trim(),
        price: Number(srvPrice) || 0,
        condition: srvCondition,
        category: srvCategory
      };
      updated = [newSrv, ...settingsServicesList];
    }

    setSrvName('');
    await handleSaveServicesToClinic(updated);
  };

  const handleEditServiceInSettings = (srv: CustomDentalService) => {
    setEditingSrvId(srv.id);
    setSrvName(srv.name);
    setSrvPrice(srv.price);
    setSrvCondition(srv.condition);
    setSrvCategory(srv.category || settingsCategoriesList[0] || 'عام');
    setServicesActiveTab('services');
  };

  const handleDeleteServiceInSettings = async (id: string) => {
    if (await dialogs.confirm('هل أنت متأكد من حذف هذه الخدمة من قائمة العيادة؟')) {
      const updated = settingsServicesList.filter(s => s.id !== id);
      await handleSaveServicesToClinic(updated);
    }
  };

  const handleAddCategoryInSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCatNameInput.trim();
    if (!name) return;
    if (settingsCategoriesList.includes(name)) {
      dialogs.alert('هذا القسم موجود بالفعل في قائمة الأقسام', { severity: 'warning' });
      return;
    }
    const updated = [...settingsCategoriesList, name];
    setNewCatNameInput('');
    await handleSaveCategoriesToClinic(updated);
  };

  const handleUpdateCategoryInSettings = async (oldCat: string, newCat: string) => {
    const trimmed = newCat.trim();
    if (!trimmed || trimmed === oldCat) {
      setEditingCatIdx(null);
      return;
    }
    const updatedCategories = settingsCategoriesList.map(c => c === oldCat ? trimmed : c);
    const updatedServices = settingsServicesList.map(s => s.category === oldCat ? { ...s, category: trimmed } : s);
    setEditingCatIdx(null);
    await handleSaveCategoriesToClinic(updatedCategories);
    await handleSaveServicesToClinic(updatedServices);
  };

  const handleDeleteCategoryInSettings = async (catToDelete: string) => {
    if (settingsCategoriesList.length <= 1) {
      dialogs.alert('يجب الإبقاء على قسم واحد على الأقل في القائمة', { severity: 'warning' });
      return;
    }
    if (await dialogs.confirm(`هل أنت متأكد من حذف قسم (${catToDelete})؟ سيتم تحويل خدمات هذا القسم إلى قسم (عام).`)) {
      const updatedCategories = settingsCategoriesList.filter(c => c !== catToDelete);
      const updatedServices = settingsServicesList.map(s => s.category === catToDelete ? { ...s, category: 'عام' } : s);
      await handleSaveCategoriesToClinic(updatedCategories);
      await handleSaveServicesToClinic(updatedServices);
    }
  };

  // Technical Support & Social Media State
  const [supportSettings, setSupportSettings] = useState<SupportSettings>(DEFAULT_SUPPORT_SETTINGS);
  const [loadingSupportSettings, setLoadingSupportSettings] = useState(false);
  const [copiedClinicId, setCopiedClinicId] = useState(false);
  const [trialPhoneInput, setTrialPhoneInput] = useState<string>('01012345678');
  const [savingTrialPhone, setSavingTrialPhone] = useState(false);

  useEffect(() => {
    async function loadSupportData() {
      setLoadingSupportSettings(true);
      try {
        const docRef = doc(db, 'system_settings', 'support');
        const snap = await getDocSmart(docRef);
        if (snap && snap.exists() && snap.data()) {
          const d = snap.data();
          const trialP = d.trialPhoneNumber || DEFAULT_SUPPORT_SETTINGS.trialPhoneNumber || '01012345678';
          setTrialPhoneInput(trialP);
          setSupportSettings({
            trialPhoneNumber: trialP,
            phoneNumbers: Array.isArray(d.phoneNumbers) ? d.phoneNumbers : DEFAULT_SUPPORT_SETTINGS.phoneNumbers,
            socialLinks: Array.isArray(d.socialLinks) ? d.socialLinks : DEFAULT_SUPPORT_SETTINGS.socialLinks,
            workingHoursNotice: d.workingHoursNotice || DEFAULT_SUPPORT_SETTINGS.workingHoursNotice
          });
        }
      } catch (err) {
        console.warn('Failed to load support settings in clinic settings:', err);
      } finally {
        setLoadingSupportSettings(false);
      }
    }
    loadSupportData();
  }, []);

  const handleSaveTrialPhone = async () => {
    const clean = formatEgyptianPhoneInput(trialPhoneInput);
    const phoneErr = getEgyptianPhoneError(clean, true, 'رقم التواصل للنسخة التجريبية');
    if (phoneErr) {
      dialogs.alert(phoneErr, { severity: 'warning' });
      return;
    }
    setSavingTrialPhone(true);
    try {
      const docRef = doc(db, 'system_settings', 'support');
      await setDoc(docRef, {
        ...supportSettings,
        trialPhoneNumber: clean,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      setSupportSettings(prev => ({ ...prev, trialPhoneNumber: clean }));
      dialogs.alert('تم حفظ رقم التواصل لطلب النسخة التجريبية (7 أيام) بنجاح!', { severity: 'success' });
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء حفظ الرقم: ' + (err?.message || err), { severity: 'error' });
    } finally {
      setSavingTrialPhone(false);
    }
  };

  const handleOpenWhatsApp = (phoneNum: string) => {
    let cleanPhone = phoneNum.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('01')) {
      cleanPhone = '2' + cleanPhone;
    }

    const clinicName = clinic.nameAr || clinic.name || 'غير محدد';
    const doctorName = clinic.doctorName || clinic.doctorNameEn || 'غير محدد';
    const clinicIdCode = clinic.id || 'غير محدد';

    const messageText = `السلام عليكم ورحمة الله وبركاته،
أنا الدكتور: ${doctorName}
اسم العيادة: ${clinicName}
كود العيادة (ID): ${clinicIdCode}

أحتاج إلى مساعدة واستفسار من فريق الدعم الفني.`;

    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyClinicId = () => {
    navigator.clipboard.writeText(clinic.id || '');
    setCopiedClinicId(true);
    setTimeout(() => setCopiedClinicId(false), 2000);
  };

  const renderSocialIcon = (platform: string) => {
    switch (platform) {
      case 'facebook':
        return <Globe className="h-5 w-5 text-blue-600 shrink-0" />;
      case 'instagram':
        return <Globe className="h-5 w-5 text-pink-600 shrink-0" />;
      case 'telegram':
        return <Send className="h-5 w-5 text-sky-500 shrink-0" />;
      case 'whatsapp_group':
        return <PhoneCall className="h-5 w-5 text-emerald-500 shrink-0" />;
      case 'youtube':
        return <Globe className="h-5 w-5 text-red-600 shrink-0" />;
      case 'email':
        return <Mail className="h-5 w-5 text-amber-600 shrink-0" />;
      case 'website':
        return <Globe className="h-5 w-5 text-slate-700 shrink-0" />;
      default:
        return <ExternalLink className="h-5 w-5 text-indigo-600 shrink-0" />;
    }
  };

  // Custom Payment Methods Management
  const [newPaymentMethodName, setNewPaymentMethodName] = useState('');
  const [reassignWarningMethod, setReassignWarningMethod] = useState<string | null>(null);
  const [reassignTargetMethod, setReassignTargetMethod] = useState('');
  const [isCheckingPaymentUsage, setIsCheckingPaymentUsage] = useState(false);

  // Synchronize state with clinic prop changes
  useEffect(() => {
    if (clinic) {
      setClinicNameArInput(clinic.nameAr || '');
      setClinicNameEnInput(clinic.nameEn || '');
      setClinicNameInput(clinic.name || '');
      setClinicLogoInput(clinic.logoUrl || '');
      setClinicDoctorNameInput(clinic.doctorName || '');
      setClinicDoctorNameEnInput(clinic.doctorNameEn || '');
      setClinicDoctorPhoneInput(clinic.doctorPhone || '');
      setAdditionalPhonesInput(clinic.additionalPhones || []);
      setClinicDoctorSpecialtyArInput(clinic.doctorSpecialtyAr || '');
      setClinicDoctorSpecialtyEnInput(clinic.doctorSpecialtyEn || '');
      setClinicHoursInput(clinic.clinicHours || '');
      setClinicAddressInput(clinic.address || '');
      setClinicPrescriptionStyleInput(clinic.prescriptionStyle || 'classic');
      setClinicPrescriptionLayoutInput(clinic.prescriptionLayout || 'traditional');
      setCustomPrescriptionPadConfigInput(getEffectivePadConfig(clinic.id, clinic.customPrescriptionPadConfig));
      setClinicConsultationPriceInput(clinic.consultationPrice !== undefined ? Number(clinic.consultationPrice) : 0);
      setBookingSystemModeInput(clinic.bookingSystemMode || 'hybrid');
      setStaffPinInput(clinic.staffPin || '1234');
      
      if (!editingStaffId) {
        setSelectedStaffTabs(getClinicAllAllowedTabs());
      }
    }
  }, [clinic.id, clinic.name, clinic.logoUrl, clinic.doctorName, clinic.doctorPhone, clinic.allowedFeatures, editingStaffId]);

  const handleUpdateStaffPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setSettingsSuccess('');
    setSettingsError('');
    if (staffPinInput.length !== 4 || isNaN(Number(staffPinInput))) {
      dialogs.alert('يجب أن يكون الرمز السري مكوناً من 4 أرقام فقط!', { severity: 'warning' });
      return;
    }
    try {
      const docRef = doc(db, 'clinics', clinicId);
      await updateDoc(docRef, {
        staffPin: staffPinInput
      });
      
      const updatedClinic = { ...clinic, staffPin: staffPinInput };
      onClinicDataUpdated(updatedClinic);
      setSettingsSuccess('تم تحديث رمز دخول السكرتارية العام بنجاح!');
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء حفظ الرمز السري: ' + err.toString(), { severity: 'error' });
    }
  };

  const handleSaveStaffMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setSettingsSuccess('');
    setSettingsError('');
    if (!newStaffName.trim() || !newStaffPassword.trim()) {
      dialogs.alert('يرجى كتابة اسم الموظف وكلمة المرور المخصصة له', { severity: 'warning' });
      return;
    }
    
    let finalStaffTabs = selectedStaffTabs.filter(t => isFeatureAllowedForClinic(t));
    if (!finalStaffTabs.includes('financials')) {
      const subIds = ['financials_daily_closing', 'financials_closing_log', 'financials_reports', 'financials_patients_installments', 'financials_expenses'];
      finalStaffTabs = finalStaffTabs.filter(t => !subIds.includes(t));
    }

    if (finalStaffTabs.length === 0) {
      dialogs.alert('يرجى تحديد تبويب واحد على الأقل مسموح بالوصول إليه للموظف من التبويبات المتاحة للعيادة!', { severity: 'warning' });
      return;
    }

    const cleanStaffPhone = formatEgyptianPhoneInput(newStaffPhone);
    if (newStaffPhone.trim()) {
      const staffPhoneErr = getEgyptianPhoneError(cleanStaffPhone, false, 'رقم هاتف الموظف');
      if (staffPhoneErr) {
        dialogs.alert(staffPhoneErr, { severity: 'warning' });
        return;
      }
    }

    try {
      const currentMembers = clinic.staffMembers || [];
      let updatedMembers: StaffMember[];
      if (editingStaffId) {
        updatedMembers = currentMembers.map(m => m.id === editingStaffId ? {
          ...m,
          name: newStaffName.trim(),
          role: newStaffRole.trim() || 'سكرتير / استقبال',
          password: newStaffPassword.trim(),
          phone: cleanStaffPhone,
          allowedTabs: finalStaffTabs
        } : m);
      } else {
        const newMember: StaffMember = {
          id: Date.now().toString(),
          name: newStaffName.trim(),
          role: newStaffRole.trim() || 'سكرتير / استقبال',
          password: newStaffPassword.trim(),
          phone: cleanStaffPhone,
          allowedTabs: finalStaffTabs,
          createdAt: new Date().toISOString()
        };
        updatedMembers = [...currentMembers, newMember];
      }
      
      const docRef = doc(db, 'clinics', clinicId);
      await updateDoc(docRef, {
        staffMembers: updatedMembers
      });
      
      const updatedClinic = { ...clinic, staffMembers: updatedMembers };
      onClinicDataUpdated(updatedClinic);

      setNewStaffName('');
      setNewStaffPassword('');
      setNewStaffPhone('');
      setSelectedStaffTabs(getClinicAllAllowedTabs());
      setEditingStaffId(null);
      setSettingsSuccess(editingStaffId ? 'تم تعديل حساب وصلاحيات الموظف/السكرتير بنجاح!' : 'تمت إضافة حساب وتحديد صلاحيات الموظف/السكرتير بنجاح!');
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء حفظ الموظف: ' + err.toString(), { severity: 'error' });
    }
  };

  const handleStartEditStaff = (member: StaffMember) => {
    const filteredTabs = (member.allowedTabs || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials']).filter(t => isFeatureAllowedForClinic(t));
    setEditingStaffId(member.id);
    setNewStaffName(member.name);
    setNewStaffRole(member.role);
    setNewStaffPassword(member.password);
    setNewStaffPhone(member.phone || '');
    setSelectedStaffTabs(filteredTabs);
    setSettingsSuccess('');
    setSettingsError('');
  };

  const handleCancelEditStaff = () => {
    setEditingStaffId(null);
    setNewStaffName('');
    setNewStaffPassword('');
    setNewStaffPhone('');
    setSelectedStaffTabs(getClinicAllAllowedTabs());
  };

  const handleRemoveStaffMember = async (memberId: string, memberName: string) => {
    if (!await dialogs.confirm(`هل أنت متأكد من حذف حساب الموظف/السكرتير (${memberName}) وإلغاء صلاحية دخوله؟`)) return;
    try {
      const currentMembers = clinic.staffMembers || [];
      const updatedMembers = currentMembers.filter(m => m.id !== memberId);
      const docRef = doc(db, 'clinics', clinicId);
      await updateDoc(docRef, {
        staffMembers: updatedMembers
      });
      
      const updatedClinic = { ...clinic, staffMembers: updatedMembers };
      onClinicDataUpdated(updatedClinic);

      if (editingStaffId === memberId) handleCancelEditStaff();
      setSettingsSuccess(`تم حذف حساب الموظف (${memberName}) بنجاح.`);
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء حذف الموظف: ' + err.toString(), { severity: 'error' });
    }
  };

  const handleUpdateClinicBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setSettingsSuccess('');
    setSettingsError('');
    const nameClean = clinicNameInput.trim() || clinic.name || clinic.nameEn || 'عيادة أسنان';
    const nameArClean = clinicNameArInput.trim() || clinic.nameAr || nameClean;
    const nameEnClean = clinicNameEnInput.trim() || clinic.nameEn || nameClean;
    const docNameClean = clinicDoctorNameInput.trim() || clinic.doctorName || '';
    const docNameEnClean = clinicDoctorNameEnInput.trim() || clinic.doctorNameEn || '';
    const docPhoneClean = formatEgyptianPhoneInput(clinicDoctorPhoneInput.trim() || clinic.doctorPhone || '');
    const docSpecialtyArClean = clinicDoctorSpecialtyArInput.trim() || clinic.doctorSpecialtyAr || '';
    const docSpecialtyEnClean = clinicDoctorSpecialtyEnInput.trim() || clinic.doctorSpecialtyEn || '';
    const hoursClean = clinicHoursInput.trim() || clinic.clinicHours || '';
    const addressClean = clinicAddressInput.trim() || clinic.address || '';
    
    // Validate main doctor phone if provided
    if (docPhoneClean) {
      const docPhoneErr = getEgyptianPhoneError(docPhoneClean, false, 'رقم هاتف الطبيب / العيادة الأساسي');
      if (docPhoneErr) {
        dialogs.alert(docPhoneErr, { severity: 'warning' });
        return;
      }
    }

    // Clean and filter additional phones, making sure they are not empty and limited to 4 items
    const cleanAdditionalPhones = additionalPhonesInput
      .map(p => formatEgyptianPhoneInput(p.trim()))
      .filter(p => p !== '')
      .slice(0, 4);

    for (let i = 0; i < cleanAdditionalPhones.length; i++) {
      const pErr = getEgyptianPhoneError(cleanAdditionalPhones[i], false, `رقم الهاتف الإضافي (${i + 1})`);
      if (pErr) {
        dialogs.alert(pErr, { severity: 'warning' });
        return;
      }
    }

    try {
      const docRef = doc(db, 'clinics', clinicId);
      const finalPadConfig = getEffectivePadConfig(clinicId, customPrescriptionPadConfigInput);
      saveEffectivePadConfig(clinicId, finalPadConfig);
      safeStorage.setItem(`clinic_booking_mode_${clinicId}`, bookingSystemModeInput);

      // Validate booking mode change if changed
      if (bookingSystemModeInput !== (clinic.bookingSystemMode || 'hybrid')) {
        const currentMode = clinic.bookingSystemMode || 'hybrid';
        try {
          const appsSnap = await getDocs(collection(db, 'clinics', clinicId, 'appointments'));
          const activeApps = appsSnap.docs
            .map(d => d.data())
            .filter((a: any) => a.status !== 'cancelled');

          if (activeApps.length > 0) {
            let msg = 'عفوا هناك موعد محجوز';
            if (currentMode === 'turn' || activeApps.some((a: any) => a.bookingType === 'turn' || a.turnNumber !== undefined)) {
              msg = 'عفوا هناك موعد محجوز بالأدوار';
            } else if (currentMode === 'time' || activeApps.some((a: any) => a.bookingType === 'time')) {
              msg = 'عفوا هناك موعد محجوز بالساعات';
            }
            dialogs.alert(msg, { severity: 'warning' });
            setBookingSystemModeInput(currentMode);
            return;
          }
        } catch (err) {
          console.error('Error checking appointments in handleUpdateClinicBranding:', err);
        }
      }

      const updatedFields = {
        name: nameEnClean || nameClean,
        nameAr: nameArClean,
        nameEn: nameEnClean || nameClean,
        logoUrl: clinicLogoInput,
        doctorName: docNameClean,
        doctorNameEn: docNameEnClean,
        doctorPhone: docPhoneClean,
        additionalPhones: cleanAdditionalPhones,
        doctorSpecialtyAr: docSpecialtyArClean,
        doctorSpecialtyEn: docSpecialtyEnClean,
        clinicHours: hoursClean,
        address: addressClean,
        prescriptionStyle: clinicPrescriptionStyleInput,
        prescriptionLayout: clinicPrescriptionLayoutInput,
        customPrescriptionPadConfig: finalPadConfig,
        consultationPrice: Number(clinicConsultationPriceInput) || 0,
        bookingSystemMode: bookingSystemModeInput,
      };

      await updateDoc(docRef, updatedFields);
      
      const updatedClinic = {
        ...clinic,
        ...updatedFields
      };
      onClinicDataUpdated(updatedClinic);
      setAdditionalPhonesInput(cleanAdditionalPhones);
      
      if (session.type === 'clinic' || session.type === 'clinic_staff') {
        const updatedSession = { ...session, clinicName: nameEnClean || nameClean };
        setSession(updatedSession);
        safeStorage.setItem('dental_saas_session', JSON.stringify(updatedSession));
      }
      
      setSettingsSuccess('تم حفظ بيانات العيادة وهوية الروشتة بنجاح!');
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء حفظ الإعدادات: ' + err.toString(), { severity: 'error' });
    }
  };

  const handleSelectBookingMode = async (targetMode: 'time' | 'turn' | 'hybrid') => {
    const currentMode = clinic.bookingSystemMode || 'hybrid';
    if (targetMode === currentMode) {
      setBookingSystemModeInput(targetMode);
      return;
    }

    try {
      const appsSnap = await getDocs(collection(db, 'clinics', clinicId, 'appointments'));
      const activeApps = appsSnap.docs
        .map(d => d.data())
        .filter((a: any) => a.status !== 'cancelled');

      if (activeApps.length > 0) {
        let msg = 'عفوا هناك موعد محجوز';
        if (currentMode === 'turn' || activeApps.some((a: any) => a.bookingType === 'turn' || a.turnNumber !== undefined)) {
          msg = 'عفوا هناك موعد محجوز بالأدوار';
        } else if (currentMode === 'time' || activeApps.some((a: any) => a.bookingType === 'time')) {
          msg = 'عفوا هناك موعد محجوز بالساعات';
        }
        dialogs.alert(msg, { severity: 'warning' });
        setBookingSystemModeInput(currentMode);
        return;
      }
    } catch (err) {
      console.error('Error checking appointments before mode change:', err);
    }

    setBookingSystemModeInput(targetMode);
  };

  const handleSaveLoyaltySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setSettingsSuccess('');
    setSettingsError('');

    try {
      const docRef = doc(db, 'clinics', clinicId);
      const parsedEarnEgp = loyaltyEarnEgpThresholdInput === '' ? 100 : Number(loyaltyEarnEgpThresholdInput);
      const parsedEarnPts = loyaltyEarnPointsInput === '' ? 20 : Number(loyaltyEarnPointsInput);
      const parsedRedeemPts = loyaltyRedeemPointsThresholdInput === '' ? 1000 : Number(loyaltyRedeemPointsThresholdInput);
      const parsedRedeemEgp = loyaltyRedeemDiscountEgpInput === '' ? 250 : Number(loyaltyRedeemDiscountEgpInput);
      const parsedMinRedeemPts = loyaltyMinRedeemPointsInput === '' || loyaltyMinRedeemPointsInput === null ? 0 : Number(loyaltyMinRedeemPointsInput);

      const updatedFields = {
        loyaltyProgramEnabled: loyaltyEnabledInput,
        loyaltyEarnEgpThreshold: isNaN(parsedEarnEgp) || parsedEarnEgp <= 0 ? 100 : parsedEarnEgp,
        loyaltyEarnPoints: isNaN(parsedEarnPts) || parsedEarnPts < 0 ? 20 : parsedEarnPts,
        loyaltyRedeemPointsThreshold: isNaN(parsedRedeemPts) || parsedRedeemPts <= 0 ? 1000 : parsedRedeemPts,
        loyaltyRedeemDiscountEgp: isNaN(parsedRedeemEgp) || parsedRedeemEgp < 0 ? 250 : parsedRedeemEgp,
        loyaltyMinRedeemPoints: isNaN(parsedMinRedeemPts) || parsedMinRedeemPts < 0 ? 0 : parsedMinRedeemPts,
        updatedAt: new Date().toISOString()
      };

      await setDoc(docRef, updatedFields, { merge: true });
      
      const updatedClinic = {
        ...clinic,
        ...updatedFields
      };
      onClinicDataUpdated(updatedClinic);

      setSettingsSuccess('تم حفظ إعدادات نظام ولاء المرضى والمكافآت بنجاح!');
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء حفظ إعدادات الولاء: ' + err.toString(), { severity: 'error' });
    }
  };

  const fetchLoyaltyRedemptions = async () => {
    setIsLoadingRedemptions(true);
    try {
      const [appsSnap, patientsSnap] = await Promise.all([
        getDocs(collection(db, 'clinics', clinicId, 'appointments')),
        getDocs(collection(db, 'clinics', clinicId, 'patients'))
      ]);

      const patientMap: Record<string, { name: string; phone: string }> = {};
      patientsSnap.docs.forEach(docSnap => {
        const p = docSnap.data();
        patientMap[docSnap.id] = { name: p.name || 'مريض غير معروف', phone: p.phone || '-' };
      });

      const logs: Array<{
        id: string;
        patientId: string;
        patientName: string;
        patientPhone: string;
        date: string;
        createdAt?: string;
        amount: number;
        notes: string;
        appointmentId: string;
        serviceName: string;
      }> = [];

      appsSnap.docs.forEach(docSnap => {
        const app = docSnap.data();
        const pInfo = patientMap[app.patientId] || { name: app.patientName || 'مريض غير معروف', phone: app.patientPhone || '-' };

        if (app.payments && Array.isArray(app.payments)) {
          app.payments.forEach((pay: any) => {
            if (pay && pay.paymentMethod && (pay.paymentMethod === 'نقاط الولاء' || pay.paymentMethod.includes('نقاط'))) {
              logs.push({
                id: pay.id || `red_${docSnap.id}_${Math.random()}`,
                patientId: app.patientId || '',
                patientName: pInfo.name,
                patientPhone: pInfo.phone,
                date: pay.date || app.date || '-',
                createdAt: pay.createdAt || app.createdAt || new Date().toISOString(),
                amount: Number(pay.amount) || 0,
                notes: pay.notes || app.notes || 'خصم استبدال نقاط الولاء',
                appointmentId: docSnap.id,
                serviceName: app.type || app.service || 'جلسة / علاج'
              });
            }
          });
        } else if (app.paymentMethod && (app.paymentMethod === 'نقاط الولاء' || app.paymentMethod.includes('نقاط'))) {
          logs.push({
            id: `red_${docSnap.id}`,
            patientId: app.patientId || '',
            patientName: pInfo.name,
            patientPhone: pInfo.phone,
            date: app.date || '-',
            createdAt: app.createdAt || new Date().toISOString(),
            amount: Number(app.paidAmount) || Number(app.price) || 0,
            notes: app.notes || 'خصم استبدال نقاط الولاء',
            appointmentId: docSnap.id,
            serviceName: app.type || app.service || 'جلسة / علاج'
          });
        }
      });

      logs.sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());
      setRedemptionLogs(logs);
    } catch (err) {
      console.error("Error fetching loyalty redemptions:", err);
    } finally {
      setIsLoadingRedemptions(false);
    }
  };

  const isLogInPeriod = (log: { date: string; createdAt?: string }, filter: 'all' | 'day' | 'week' | 'month') => {
    if (filter === 'all') return true;
    const rawDate = log.date && log.date !== '-' ? log.date : log.createdAt;
    if (!rawDate) return false;

    let d = new Date(rawDate);
    if (isNaN(d.getTime())) {
      const parts = rawDate.split('/');
      if (parts.length === 3) {
        d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      }
    }
    if (isNaN(d.getTime())) return true;

    const now = new Date();
    if (filter === 'day') {
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    }
    if (filter === 'week') {
      const diffTime = Math.abs(now.getTime() - d.getTime());
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      return diffDays <= 7;
    }
    if (filter === 'month') {
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth()
      );
    }
    return true;
  };

  const filteredRedemptionLogs = redemptionLogs.filter(log => {
    if (!isLogInPeriod(log, redemptionPeriodFilter)) return false;
    if (!redemptionSearchTerm.trim()) return true;
    const term = redemptionSearchTerm.toLowerCase();
    return (
      log.patientName.toLowerCase().includes(term) ||
      log.patientPhone.toLowerCase().includes(term) ||
      log.notes.toLowerCase().includes(term) ||
      log.serviceName.toLowerCase().includes(term)
    );
  });

  const totalDiscountGranted = filteredRedemptionLogs.reduce((sum, log) => sum + log.amount, 0);
  const uniquePatientsCount = new Set(filteredRedemptionLogs.map(log => log.patientId || log.patientName)).size;
  const displayedRedemptionLogs = filteredRedemptionLogs.slice(0, redemptionVisibleCount);

  const handleSaveAutoBackupSettings = async (enabled: boolean, format: 'zip' | 'json' | 'db' | 'sql', notify: boolean = true) => {
    setAutoBackupEnabled(enabled);
    setAutoBackupFormat(format);
    safeStorage.setItem(`auto_backup_enabled_${clinicId}`, enabled ? 'true' : 'false');
    safeStorage.setItem(`auto_backup_format_${clinicId}`, format);

    try {
      await updateDoc(doc(db, 'clinics', clinicId), {
        autoBackupEnabled: enabled,
        autoBackupFormat: format
      });
      if (notify) {
        dialogs.alert(
          enabled
            ? `تم تفعيل النسخ الاحتياطي التلقائي للعيادة يومياً الساعة 12:00 منتصف الليل بنجاح ببرمجة صيغة (.${format}).`
            : `تم تحديد صيغة النسخ الاحتياطي التلقائي (.${format}).`,
          { severity: 'success' }
        );
      }
    } catch (err) {
      console.warn('Could not persist auto-backup settings to Firestore:', err);
    }
  };

  const handleExportBackup = async (overrideFormat?: 'zip' | 'json' | 'db' | 'sql', isAuto: boolean = false) => {
    const targetFormat = overrideFormat || exportFormat;
    try {
      setIsBackingUp(true);
      setBackupRestoreStatus(isAuto ? 'جاري تنفيذ النسخ الاحتياطي التلقائي اليومي...' : 'جاري استخراج وتجميع بيانات العيادة الحالية فقط...');
      
      const cleanName = (clinic.name || clinic.nameAr || clinic.nameEn || 'Clinic').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_');
      const dateStr = new Date().toISOString().split('T')[0];

      // 1. Fetch patients and their subcollections (records, teeth, xrays) for THIS clinic ONLY
      const patientsSnap = await getDocs(collection(db, 'clinics', clinicId, 'patients'));
      const patientsData = await Promise.all(
        patientsSnap.docs.map(async (patientDoc) => {
          const pData = { id: patientDoc.id, ...patientDoc.data() } as any;
          const [recordsSnap, teethSnap, xraysSnap] = await Promise.all([
            getDocs(collection(db, 'clinics', clinicId, 'patients', patientDoc.id, 'records')),
            getDocs(collection(db, 'clinics', clinicId, 'patients', patientDoc.id, 'teeth')),
            getDocs(collection(db, 'clinics', clinicId, 'patients', patientDoc.id, 'xrays'))
          ]);
          return {
            ...pData,
            records: recordsSnap.docs.map(rDoc => ({ id: rDoc.id, ...rDoc.data() } as any)),
            teeth: teethSnap.docs.map(tDoc => ({ id: tDoc.id, ...tDoc.data() } as any)),
            xrays: xraysSnap.docs.map(xDoc => ({ id: xDoc.id, ...xDoc.data() } as any))
          };
        })
      );

      // 2. Fetch appointments for THIS clinic ONLY
      const appointmentsSnap = await getDocs(collection(db, 'clinics', clinicId, 'appointments'));
      const appointmentsData = appointmentsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // 3. Fetch prescriptions for THIS clinic ONLY
      const prescriptionsSnap = await getDocs(collection(db, 'clinics', clinicId, 'prescriptions'));
      const prescriptionsData = prescriptionsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // 4. Fetch custom medications, categories & shifts for THIS clinic ONLY
      const customMedSnap = await getDocs(collection(db, 'clinics', clinicId, 'custom_medications'));
      const customMedData = customMedSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const customCatSnap = await getDocs(collection(db, 'clinics', clinicId, 'custom_categories'));
      const customCatData = customCatSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const shiftsSnap = await getDocs(collection(db, 'clinics', clinicId, 'shifts'));
      const shiftsData = shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // 5. Fetch expenses for THIS clinic ONLY
      const expensesSnap = await getDocs(collection(db, 'clinics', clinicId, 'expenses'));
      const expensesData = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // 6. Fetch additional platform data for THIS clinic ONLY
      const inventorySnap = await getDocs(collection(db, 'clinics', clinicId, 'inventory'));
      const inventoryData = inventorySnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const billingSnap = await getDocs(collection(db, 'clinics', clinicId, 'billing'));
      const billingData = billingSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const closingsSnap = await getDocs(collection(db, 'clinics', clinicId, 'closings'));
      const closingsData = closingsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const laboratoriesSnap = await getDocs(collection(db, 'clinics', clinicId, 'laboratories'));
      const laboratoriesData = laboratoriesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const labOrdersSnap = await getDocs(collection(db, 'clinics', clinicId, 'lab_orders'));
      const labOrdersData = labOrdersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      const labWorkTypesSnap = await getDocs(collection(db, 'clinics', clinicId, 'lab_work_types'));
      const labWorkTypesData = labWorkTypesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // TYPE 1: ANSI SQL File (.sql)
      if (targetFormat === 'sql') {
        const escapeSQLVal = (val: any): string => {
          if (val === undefined || val === null) return 'NULL';
          if (typeof val === 'number') return val.toString();
          const clean = val.toString().replace(/'/g, "''");
          return `'${clean}'`;
        };

        let sqlContent = `-- CMS Clinic Isolated SQL Backup Dump\n`;
        sqlContent += `-- Generated: ${new Date().toISOString()}\n`;
        sqlContent += `-- Clinic Name: ${clinic.name || clinic.nameAr || 'Clinic'}\n`;
        sqlContent += `-- Clinic ID: ${clinicId}\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS patients (\n`;
        sqlContent += `  patient_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  name VARCHAR(255) NOT NULL,\n`;
        sqlContent += `  phone VARCHAR(50),\n`;
        sqlContent += `  age VARCHAR(50),\n`;
        sqlContent += `  medical_history TEXT,\n`;
        sqlContent += `  created_at VARCHAR(100)\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS medical_sessions (\n`;
        sqlContent += `  session_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  patient_id VARCHAR(100),\n`;
        sqlContent += `  patient_name VARCHAR(255),\n`;
        sqlContent += `  tooth_number VARCHAR(100),\n`;
        sqlContent += `  procedure_name VARCHAR(255),\n`;
        sqlContent += `  cost DECIMAL(10,2),\n`;
        sqlContent += `  paid DECIMAL(10,2),\n`;
        sqlContent += `  remaining DECIMAL(10,2),\n`;
        sqlContent += `  session_date VARCHAR(50),\n`;
        sqlContent += `  notes TEXT\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS appointments (\n`;
        sqlContent += `  appointment_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  patient_id VARCHAR(100),\n`;
        sqlContent += `  patient_name VARCHAR(255),\n`;
        sqlContent += `  patient_phone VARCHAR(50),\n`;
        sqlContent += `  appointment_date VARCHAR(50),\n`;
        sqlContent += `  appointment_time VARCHAR(50),\n`;
        sqlContent += `  treatment_type VARCHAR(255),\n`;
        sqlContent += `  status VARCHAR(50),\n`;
        sqlContent += `  expected_cost DECIMAL(10,2)\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS prescriptions (\n`;
        sqlContent += `  prescription_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  patient_id VARCHAR(100),\n`;
        sqlContent += `  patient_name VARCHAR(255),\n`;
        sqlContent += `  prescription_date VARCHAR(50),\n`;
        sqlContent += `  medications TEXT,\n`;
        sqlContent += `  notes TEXT\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS expenses (\n`;
        sqlContent += `  expense_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  title VARCHAR(255),\n`;
        sqlContent += `  amount DECIMAL(10,2),\n`;
        sqlContent += `  category VARCHAR(100),\n`;
        sqlContent += `  payment_method VARCHAR(100),\n`;
        sqlContent += `  expense_date VARCHAR(50),\n`;
        sqlContent += `  type VARCHAR(50),\n`;
        sqlContent += `  notes TEXT\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS shifts (\n`;
        sqlContent += `  shift_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  operator_name VARCHAR(255),\n`;
        sqlContent += `  opened_at VARCHAR(100),\n`;
        sqlContent += `  closed_at VARCHAR(100),\n`;
        sqlContent += `  total_revenue DECIMAL(10,2),\n`;
        sqlContent += `  expenses_total DECIMAL(10,2),\n`;
        sqlContent += `  status VARCHAR(50)\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS inventory (\n`;
        sqlContent += `  item_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  name VARCHAR(255),\n`;
        sqlContent += `  quantity DECIMAL(10,2),\n`;
        sqlContent += `  min_quantity DECIMAL(10,2),\n`;
        sqlContent += `  unit VARCHAR(50),\n`;
        sqlContent += `  price DECIMAL(10,2)\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS billing (\n`;
        sqlContent += `  billing_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  patient_id VARCHAR(100),\n`;
        sqlContent += `  patient_name VARCHAR(255),\n`;
        sqlContent += `  total_amount DECIMAL(10,2),\n`;
        sqlContent += `  paid_amount DECIMAL(10,2),\n`;
        sqlContent += `  remaining_amount DECIMAL(10,2),\n`;
        sqlContent += `  invoice_date VARCHAR(50)\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS daily_closings (\n`;
        sqlContent += `  closing_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  closing_date VARCHAR(50),\n`;
        sqlContent += `  total_income DECIMAL(10,2),\n`;
        sqlContent += `  total_expenses DECIMAL(10,2),\n`;
        sqlContent += `  net_income DECIMAL(10,2)\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS laboratories (\n`;
        sqlContent += `  lab_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  name VARCHAR(255),\n`;
        sqlContent += `  phone VARCHAR(50),\n`;
        sqlContent += `  address TEXT\n`;
        sqlContent += `);\n\n`;

        sqlContent += `CREATE TABLE IF NOT EXISTS lab_orders (\n`;
        sqlContent += `  order_id VARCHAR(100) PRIMARY KEY,\n`;
        sqlContent += `  lab_id VARCHAR(100),\n`;
        sqlContent += `  lab_name VARCHAR(255),\n`;
        sqlContent += `  patient_name VARCHAR(255),\n`;
        sqlContent += `  order_type VARCHAR(255),\n`;
        sqlContent += `  cost DECIMAL(10,2),\n`;
        sqlContent += `  paid DECIMAL(10,2),\n`;
        sqlContent += `  status VARCHAR(50),\n`;
        sqlContent += `  sent_date VARCHAR(50),\n`;
        sqlContent += `  delivery_date VARCHAR(50)\n`;
        sqlContent += `);\n\n`;

        sqlContent += `-- Data Insertion for Clinic: ${clinic.name || clinicId} --\n\n`;

        sqlContent += `-- Inserting Patients Data (${patientsData.length})\n`;
        patientsData.forEach(p => {
          sqlContent += `INSERT INTO patients (patient_id, name, phone, age, medical_history, created_at) VALUES (${escapeSQLVal(p.id)}, ${escapeSQLVal(p.name)}, ${escapeSQLVal(p.phone)}, ${escapeSQLVal(p.age)}, ${escapeSQLVal(p.medicalHistory)}, ${escapeSQLVal(p.createdAt || '')});\n`;
        });

        sqlContent += `\n-- Inserting Medical Sessions Data\n`;
        patientsData.forEach(p => {
          if (p.records && p.records.length > 0) {
            p.records.forEach((r: any) => {
              const costVal = Number(r.cost) || 0;
              const paidVal = Number(r.paid) || 0;
              sqlContent += `INSERT INTO medical_sessions (session_id, patient_id, patient_name, tooth_number, procedure_name, cost, paid, remaining, session_date, notes) VALUES (${escapeSQLVal(r.id)}, ${escapeSQLVal(p.id)}, ${escapeSQLVal(p.name)}, ${escapeSQLVal(r.toothNumber)}, ${escapeSQLVal(r.procedure)}, ${costVal}, ${paidVal}, ${costVal - paidVal}, ${escapeSQLVal(r.date)}, ${escapeSQLVal(r.notes)});\n`;
            });
          }
        });

        sqlContent += `\n-- Inserting Appointments Data (${appointmentsData.length})\n`;
        appointmentsData.forEach(app => {
          sqlContent += `INSERT INTO appointments (appointment_id, patient_id, patient_name, patient_phone, appointment_date, appointment_time, treatment_type, status, expected_cost) VALUES (${escapeSQLVal(app.id)}, ${escapeSQLVal(app.patientId || '')}, ${escapeSQLVal(app.patientName)}, ${escapeSQLVal(app.patientPhone)}, ${escapeSQLVal(app.date)}, ${escapeSQLVal(app.time)}, ${escapeSQLVal(app.treatmentType)}, ${escapeSQLVal(app.status)}, ${Number(app.expectedCost) || 0});\n`;
        });

        sqlContent += `\n-- Inserting Prescriptions Data (${prescriptionsData.length})\n`;
        prescriptionsData.forEach(pres => {
          const medsStr = Array.isArray(pres.medications)
            ? pres.medications.map((m: any) => `${m.name} (${m.dosage})`).join(' | ')
            : (pres.medicationsText || '');
          sqlContent += `INSERT INTO prescriptions (prescription_id, patient_id, patient_name, prescription_date, medications, notes) VALUES (${escapeSQLVal(pres.id)}, ${escapeSQLVal(pres.patientId || '')}, ${escapeSQLVal(pres.patientName || '')}, ${escapeSQLVal(pres.date)}, ${escapeSQLVal(medsStr)}, ${escapeSQLVal(pres.notes)});\n`;
        });

        sqlContent += `\n-- Inserting Expenses Data (${expensesData.length})\n`;
        expensesData.forEach((exp) => {
          sqlContent += `INSERT INTO expenses (expense_id, title, amount, category, payment_method, expense_date, type, notes) VALUES (${escapeSQLVal(exp.id)}, ${escapeSQLVal(exp.title)}, ${Number(exp.amount) || 0}, ${escapeSQLVal(exp.category)}, ${escapeSQLVal(exp.paymentMethod || 'كاش')}, ${escapeSQLVal(exp.date)}, ${escapeSQLVal(exp.type || 'shift')}, ${escapeSQLVal(exp.notes)});\n`;
        });

        sqlContent += `\n-- Inserting Shifts Data (${shiftsData.length})\n`;
        shiftsData.forEach((s) => {
          sqlContent += `INSERT INTO shifts (shift_id, operator_name, opened_at, closed_at, total_revenue, expenses_total, status) VALUES (${escapeSQLVal(s.id)}, ${escapeSQLVal(s.operatorName)}, ${escapeSQLVal(s.openedAt)}, ${escapeSQLVal(s.closedAt)}, ${Number(s.totalRevenue || s.expected) || 0}, ${Number(s.expensesTotal || s.cashExpenses) || 0}, ${escapeSQLVal(s.status)});\n`;
        });

        sqlContent += `\n-- Inserting Inventory Data (${inventoryData.length})\n`;
        inventoryData.forEach((inv) => {
          sqlContent += `INSERT INTO inventory (item_id, name, quantity, min_quantity, unit, price) VALUES (${escapeSQLVal(inv.id)}, ${escapeSQLVal(inv.name)}, ${Number(inv.quantity) || 0}, ${Number(inv.minQuantity) || 0}, ${escapeSQLVal(inv.unit)}, ${Number(inv.price) || 0});\n`;
        });

        sqlContent += `\n-- Inserting Billing Data (${billingData.length})\n`;
        billingData.forEach((b) => {
          sqlContent += `INSERT INTO billing (billing_id, patient_id, patient_name, total_amount, paid_amount, remaining_amount, invoice_date) VALUES (${escapeSQLVal(b.id)}, ${escapeSQLVal(b.patientId)}, ${escapeSQLVal(b.patientName)}, ${Number(b.totalAmount) || 0}, ${Number(b.paidAmount) || 0}, ${Number(b.remainingAmount) || 0}, ${escapeSQLVal(b.date)});\n`;
        });

        sqlContent += `\n-- Inserting Laboratories Data (${laboratoriesData.length})\n`;
        laboratoriesData.forEach((lab) => {
          sqlContent += `INSERT INTO laboratories (lab_id, name, phone, address) VALUES (${escapeSQLVal(lab.id)}, ${escapeSQLVal(lab.name)}, ${escapeSQLVal(lab.phone)}, ${escapeSQLVal(lab.address)});\n`;
        });

        sqlContent += `\n-- Inserting Lab Orders Data (${labOrdersData.length})\n`;
        labOrdersData.forEach((lo) => {
          sqlContent += `INSERT INTO lab_orders (order_id, lab_id, lab_name, patient_name, order_type, cost, paid, status, sent_date, delivery_date) VALUES (${escapeSQLVal(lo.id)}, ${escapeSQLVal(lo.labId)}, ${escapeSQLVal(lo.labName)}, ${escapeSQLVal(lo.patientName)}, ${escapeSQLVal(lo.type || lo.orderType)}, ${Number(lo.cost) || 0}, ${Number(lo.paid) || 0}, ${escapeSQLVal(lo.status)}, ${escapeSQLVal(lo.sentDate)}, ${escapeSQLVal(lo.deliveryDate)});\n`;
        });

        const blob = new Blob([sqlContent], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CMS_ClinicBackup_${cleanName}_${dateStr}.sql`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setBackupRestoreStatus('تم تنزيل النسخة الاحتياطية بصيغة SQL (.sql) للعيادة بنجاح!');
        if (!isAuto) {
          dialogs.alert(`تم استخراج ملف استعلامات SQL بنجاح (.sql) ببيانات هذه العيادة فقط.`, { severity: 'success' });
        }
        return;
      }

      // JSON / DB / ZIP Payload Object
      const exportObject = {
        platform: 'Clinic SaaS System',
        fileType: 'CLINIC_DATABASE_BACKUP',
        exportTimestamp: new Date().toISOString(),
        clinicId: clinicId,
        clinicName: clinic.name || clinic.nameAr || clinic.nameEn,
        clinicInfo: clinic,
        data: {
          patients: patientsData,
          appointments: appointmentsData,
          prescriptions: prescriptionsData,
          custom_medications: customMedData,
          custom_categories: customCatData,
          shifts: shiftsData,
          expenses: expensesData,
          inventory: inventoryData,
          billing: billingData,
          closings: closingsData,
          laboratories: laboratoriesData,
          lab_orders: labOrdersData,
          lab_work_types: labWorkTypesData
        }
      };

      const jsonStr = JSON.stringify(exportObject, null, 2);

      // Handle ZIP format
      if (targetFormat === 'zip') {
        setBackupRestoreStatus('جاري ضغط بيانات العيادة في أرشيف ZIP...');
        const innerFileName = `clinic_${cleanName}_data.json`;
        const zipBlob = await createZipBlob(innerFileName, jsonStr);

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CMS_ClinicBackup_${cleanName}_${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setBackupRestoreStatus('تم تنزيل النسخة الاحتياطية المضغوطة (.zip) للعيادة بنجاح!');
        if (!isAuto) {
          dialogs.alert(`تم تحميل ملف أرشيف العيادة المضغوط (.zip) بنجاح فائق! تم تقليص حجم الملف بنسبة تصل إلى 85% مع حفظ كافة البيانات: (${patientsData.length}) مريض، (${appointmentsData.length}) موعد، (${prescriptionsData.length}) روشتة، (${inventoryData.length}) صنف مخزن، (${billingData.length}) فاتورة، و(${laboratoriesData.length}) معمل.`, { severity: 'success' });
        }
        return;
      }

      const ext = targetFormat === 'json' ? 'json' : 'db';
      const mime = targetFormat === 'json' ? 'application/json' : 'application/octet-stream';
      const blob = new Blob([jsonStr], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CMS_ClinicBackup_${cleanName}_${dateStr}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBackupRestoreStatus(`تم تنزيل النسخة الاحتياطية بصيغة (.${ext}) للعيادة بنجاح!`);
      if (!isAuto) {
        dialogs.alert(`تم تحميل ملف نسخة العيادة (.${ext}) بنجاح! يحتوي فقط على بيانات عيادتك: (${patientsData.length}) مريض، (${appointmentsData.length}) موعد، (${prescriptionsData.length}) روشتة، (${inventoryData.length}) صنف مخزن، (${billingData.length}) فاتورة، و(${laboratoriesData.length}) معمل.`, { severity: 'success' });
      }
    } catch (err: any) {
      console.error('Export Backup Error:', err);
      if (!isAuto) {
        dialogs.alert('حدث خطأ أثناء أخذ النسخة الاحتياطية: ' + err.toString(), { severity: 'error' });
      }
      setBackupRestoreStatus('فشل تنزيل النسخة الاحتياطية.');
    } finally {
      setIsBackingUp(false);
    }
  };

  // Automatic Daily Backup Engine (Midnight / Connection Listener)
  useEffect(() => {
    const checkAndRunAutoBackup = async () => {
      if (!clinicId) return;
      const isEnabled = safeStorage.getItem(`auto_backup_enabled_${clinicId}`) === 'true' || clinic?.autoBackupEnabled === true;
      if (!isEnabled) return;

      const fmt = (safeStorage.getItem(`auto_backup_format_${clinicId}`) as 'zip' | 'json' | 'db' | 'sql') || clinic?.autoBackupFormat || 'zip';
      const todayStr = getLocalTodayStr();
      const lastDate = safeStorage.getItem(`auto_backup_last_date_${clinicId}`);

      if (lastDate !== todayStr) {
        console.log('Automated daily backup triggered for clinic:', clinicId);
        safeStorage.setItem(`auto_backup_last_date_${clinicId}`, todayStr);
        setLastAutoBackupDate(todayStr);
        await handleExportBackup((fmt as 'zip' | 'sql' | 'json' | 'db') || 'zip', true);
      }
    };

    checkAndRunAutoBackup();

    const handleOnline = () => {
      console.log('Network connected! Checking pending clinic auto backups...');
      checkAndRunAutoBackup();
    };

    window.addEventListener('online', handleOnline);

    const intervalId = setInterval(() => {
      checkAndRunAutoBackup();
    }, 60000);

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(intervalId);
    };
  }, [clinicId, clinic?.autoBackupEnabled, clinic?.autoBackupFormat]);

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const confirmed = await dialogs.confirm(
      'هل أنت متأكد من رغبتك في رفع واستعادة البيانات من هذا الملف؟ يدعم النظام الملفات المضغوطة (.zip) وملفات (.json/.db/.sql). سيتم استرجاع وإضافة كافة ملفات المرضى، المواعيد، الجلسات الطبية، الروشتات، المخزن، الفواتير، الإغلاقات اليومية، والطلبات المعملية الموجودة بالملف إلى عيادتك الحالية في الوقت الفعلي.'
    );

    if (!confirmed) {
      e.target.value = '';
      return;
    }

    try {
      setIsRestoring(true);
      setBackupRestoreStatus('جاري فك ضغط وقراءة وتحليل ملف النسخة الاحتياطية...');
      
      const { text: content } = await readBackupFile(file);
      if (!content) throw new Error('الملف فارغ أو لا يمكن قراءته.');
      const parsed = JSON.parse(content);
      
      const backupData = parsed.data || parsed;
      if (!backupData.patients && !backupData.appointments && !backupData.prescriptions) {
        throw new Error('صيغة ملف النسخة الاحتياطية غير متوافقة مع هذا النظام.');
      }

      // 1. Restore Clinic Info
      if (parsed.clinicInfo) {
        setBackupRestoreStatus('جاري استعادة هوية وبيانات العيادة...');
        await setDoc(doc(db, 'clinics', clinicId), parsed.clinicInfo, { merge: true });
      }

      // 2. Restore Patients and Records
      setBackupRestoreStatus('جاري استعادة سجلات المرضى والجلسات الطبية...');
      let restoredPatients = 0;
      let restoredRecords = 0;
      if (Array.isArray(backupData.patients)) {
        for (const p of backupData.patients) {
          const { records, id, ...pDocData } = p;
          const targetId = id || pDocData.phone || Math.random().toString(36).substring(2, 11);
          await setDoc(doc(db, 'clinics', clinicId, 'patients', targetId), pDocData, { merge: true });
          restoredPatients++;

          if (Array.isArray(records)) {
            for (const r of records) {
              const { id: rId, ...rDocData } = r;
              const recId = rId || Math.random().toString(36).substring(2, 11);
              await setDoc(doc(db, 'clinics', clinicId, 'patients', targetId, 'records', recId), rDocData, { merge: true });
              restoredRecords++;
            }
          }

          if (Array.isArray(p.teeth)) {
            for (const t of p.teeth) {
              const { id: tId, ...tDocData } = t;
              const toothId = tId || Math.random().toString(36).substring(2, 11);
              await setDoc(doc(db, 'clinics', clinicId, 'patients', targetId, 'teeth', toothId), tDocData, { merge: true });
            }
          }

          if (Array.isArray(p.xrays)) {
            for (const x of p.xrays) {
              const { id: xId, ...xDocData } = x;
              const xrayId = xId || Math.random().toString(36).substring(2, 11);
              await setDoc(doc(db, 'clinics', clinicId, 'patients', targetId, 'xrays', xrayId), xDocData, { merge: true });
            }
          }
        }
      }

      // 3. Restore Appointments and Prescriptions
      setBackupRestoreStatus('جاري استعادة المواعيد والروشتات الطبية...');
      let restoredAppointments = 0;
      if (Array.isArray(backupData.appointments)) {
        for (const app of backupData.appointments) {
          const { id, ...appDocData } = app;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'appointments', id), appDocData, { merge: true });
            restoredAppointments++;
          }
        }
      }

      if (Array.isArray(backupData.prescriptions)) {
        for (const rx of backupData.prescriptions) {
          const { id, ...rxData } = rx;
          if (id) await setDoc(doc(db, 'clinics', clinicId, 'prescriptions', id), rxData, { merge: true });
        }
      }

      // 4. Restore Custom Medications and Categories
      setBackupRestoreStatus('جاري استعادة إعدادات الأدوية والأقسام المخصصة...');
      const customMedsList = backupData.custom_medications || backupData.customMedications;
      if (Array.isArray(customMedsList)) {
        for (const med of customMedsList) {
          const { id, ...medData } = med;
          if (id) await setDoc(doc(db, 'clinics', clinicId, 'custom_medications', id), medData, { merge: true });
        }
      }

      const customCatsList = backupData.custom_categories || backupData.customCategories;
      if (Array.isArray(customCatsList)) {
        for (const cat of customCatsList) {
          const { id, ...catData } = cat;
          if (id) await setDoc(doc(db, 'clinics', clinicId, 'custom_categories', id), catData, { merge: true });
        }
      }

      // 5. Restore Shifts & Expenses
      let restoredExpenses = 0;
      if (Array.isArray(backupData.shifts)) {
        for (const shift of backupData.shifts) {
          const { id, ...shiftData } = shift;
          if (id) await setDoc(doc(db, 'clinics', clinicId, 'shifts', id), shiftData, { merge: true });
        }
      }

      const expensesList = backupData.expenses || backupData.expenseList;
      if (Array.isArray(expensesList)) {
        for (const exp of expensesList) {
          const { id, ...expData } = exp;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'expenses', id), expData, { merge: true });
            restoredExpenses++;
          }
        }
      }

      // 6. Restore Inventory
      setBackupRestoreStatus('جاري استعادة المخزن وجرد المواد والخدمات...');
      let restoredInventory = 0;
      if (Array.isArray(backupData.inventory)) {
        for (const item of backupData.inventory) {
          const { id, ...itemData } = item;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'inventory', id), itemData, { merge: true });
            restoredInventory++;
          }
        }
      }

      // 7. Restore Billing / Invoices
      setBackupRestoreStatus('جاري استعادة الفواتير وحسابات العيادة...');
      let restoredBilling = 0;
      if (Array.isArray(backupData.billing)) {
        for (const inv of backupData.billing) {
          const { id, ...invData } = inv;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'billing', id), invData, { merge: true });
            restoredBilling++;
          }
        }
      }

      // 8. Restore Daily Closings
      let restoredClosings = 0;
      const closingsList = backupData.closings || backupData.dailyClosings;
      if (Array.isArray(closingsList)) {
        for (const closing of closingsList) {
          const { id, ...closingData } = closing;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'closings', id), closingData, { merge: true });
            restoredClosings++;
          }
        }
      }

      // 9. Restore Laboratories, Orders and Work Types
      setBackupRestoreStatus('جاري استعادة بيانات المعامل والطلبات المعملية...');
      let restoredLaboratories = 0;
      if (Array.isArray(backupData.laboratories)) {
        for (const lab of backupData.laboratories) {
          const { id, ...labData } = lab;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'laboratories', id), labData, { merge: true });
            restoredLaboratories++;
          }
        }
      }

      let restoredLabOrders = 0;
      const labOrdersList = backupData.lab_orders || backupData.labOrders;
      if (Array.isArray(labOrdersList)) {
        for (const order of labOrdersList) {
          const { id, ...orderData } = order;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'lab_orders', id), orderData, { merge: true });
            restoredLabOrders++;
          }
        }
      }

      const labWorkTypesList = backupData.lab_work_types || backupData.labWorkTypes;
      if (Array.isArray(labWorkTypesList)) {
        for (const wt of labWorkTypesList) {
          const { id, ...wtData } = wt;
          if (id) {
            await setDoc(doc(db, 'clinics', clinicId, 'lab_work_types', id), wtData, { merge: true });
          }
        }
      }

      setBackupRestoreStatus('تم استعادة واسترجاع جميع البيانات بنجاح 100%!');
      dialogs.alert(`تمت استعادة كافة البيانات والملفات الطبية والتشغيلية بنجاح تام! تم استرجاع: (${restoredPatients}) مريض، (${restoredRecords}) جلسة علاجية، (${restoredAppointments}) موعد، (${restoredExpenses}) بند مصروفات، (${restoredInventory}) صنف مخزن، (${restoredBilling}) فاتورة، (${restoredClosings}) إغلاق مالي، (${restoredLaboratories}) معمل، و(${restoredLabOrders}) طلب معملي.`, { severity: 'success' });
      
      // Trigger a refresh of the clinic data locally
      if (parsed.clinicInfo) {
        onClinicDataUpdated(parsed.clinicInfo);
      }
    } catch (parseErr: any) {
      console.error('Import Restore Error:', parseErr);
      dialogs.alert('فشل قراءة الملف أو استعادة البيانات: ' + parseErr.toString(), { severity: 'error' });
      setBackupRestoreStatus('حدث خطأ أثناء استعادة البيانات.');
    } finally {
      setIsRestoring(false);
      e.target.value = '';
    }
  };

  // Helper to match payment methods (with legacy fallback)
  const isMatchingPaymentMethod = (appMethod: string | undefined, target: string) => {
    if (!appMethod) return false;
    const normApp = appMethod.toLowerCase().trim();
    const normTarget = target.toLowerCase().trim();
    if (normApp === normTarget) return true;
    if (normTarget === 'كاش' && normApp === 'cash') return true;
    if (normTarget === 'فيزا' && (normApp === 'card' || normApp === 'visa')) return true;
    if (normTarget === 'إنستاباي' && normApp === 'instapay') return true;
    if (normTarget === 'محفظة' && normApp === 'wallet') return true;
    return false;
  };

  const handleAddPaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSuccess('');
    setSettingsError('');
    const name = newPaymentMethodName.trim();
    if (!name) {
      dialogs.alert('يرجى إدخال اسم طريقة الدفع أولاً', { severity: 'warning' });
      return;
    }
    const currentMethods = clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
    if (currentMethods.some(m => m.toLowerCase().trim() === name.toLowerCase().trim())) {
      dialogs.alert('طريقة الدفع هذه مضافة بالفعل!', { severity: 'warning' });
      return;
    }

    try {
      const updatedMethods = [...currentMethods, name];
      const docRef = doc(db, 'clinics', clinicId);
      await updateDoc(docRef, { paymentMethods: updatedMethods });
      onClinicDataUpdated({ ...clinic, paymentMethods: updatedMethods });
      setNewPaymentMethodName('');
      setSettingsSuccess(`تمت إضافة طريقة الدفع (${name}) بنجاح!`);
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء إضافة طريقة الدفع: ' + err.toString(), { severity: 'error' });
    }
  };

  const handleDeletePaymentMethodCheck = async (methodToDelete: string) => {
    setSettingsSuccess('');
    setSettingsError('');
    setIsCheckingPaymentUsage(true);

    try {
      // 1. Fetch appointments & expenses to check usage
      const appRef = collection(db, 'clinics', clinicId, 'appointments');
      const appointmentsSnap = await getDocs(appRef);
      const appointmentsList: any[] = [];
      appointmentsSnap.forEach((d: any) => {
        appointmentsList.push({ id: d.id, ...d.data() });
      });

      const expRef = collection(db, 'clinics', clinicId, 'expenses');
      const expensesSnap = await getDocs(expRef);
      const expensesList: any[] = [];
      expensesSnap.forEach((d: any) => {
        expensesList.push({ id: d.id, ...d.data() });
      });

      const usedInAppointments = appointmentsList.filter(app => isMatchingPaymentMethod(app.paymentMethod, methodToDelete));
      const usedInExpenses = expensesList.filter(exp => isMatchingPaymentMethod(exp.paymentMethod, methodToDelete));

      const totalUsage = usedInAppointments.length + usedInExpenses.length;

      if (totalUsage > 0) {
        // Method is used, prompt reassignment!
        setReassignWarningMethod(methodToDelete);
        const currentMethods = clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
        const alternatives = currentMethods.filter(m => m !== methodToDelete);
        setReassignTargetMethod(alternatives[0] || '');
      } else {
        // Not used, delete immediately after simple confirm
        if (await dialogs.confirm(`هل أنت متأكد من حذف طريقة الدفع (${methodToDelete})؟`)) {
          const currentMethods = clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
          const updatedMethods = currentMethods.filter(m => m !== methodToDelete);
          const docRef = doc(db, 'clinics', clinicId);
          await updateDoc(docRef, { paymentMethods: updatedMethods });
          onClinicDataUpdated({ ...clinic, paymentMethods: updatedMethods });
          setSettingsSuccess(`تم حذف طريقة الدفع (${methodToDelete}) بنجاح!`);
        }
      }
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء فحص الاستخدام: ' + err.toString(), { severity: 'error' });
    } finally {
      setIsCheckingPaymentUsage(false);
    }
  };

  const handleConfirmReassignAndDelete = async () => {
    if (!reassignWarningMethod) return;
    if (!reassignTargetMethod) {
      dialogs.alert('يرجى تحديد طريقة دفع بديلة لترحيل البيانات إليها.', { severity: 'warning' });
      return;
    }

    try {
      setIsCheckingPaymentUsage(true);
      // 1. Fetch appointments & expenses to update
      const appRef = collection(db, 'clinics', clinicId, 'appointments');
      const appointmentsSnap = await getDocs(appRef);
      const appointmentsList: any[] = [];
      appointmentsSnap.forEach((d: any) => {
        appointmentsList.push({ id: d.id, ...d.data() });
      });

      const expRef = collection(db, 'clinics', clinicId, 'expenses');
      const expensesSnap = await getDocs(expRef);
      const expensesList: any[] = [];
      expensesSnap.forEach((d: any) => {
        expensesList.push({ id: d.id, ...d.data() });
      });

      const usedInAppointments = appointmentsList.filter(app => isMatchingPaymentMethod(app.paymentMethod, reassignWarningMethod));
      const usedInExpenses = expensesList.filter(exp => isMatchingPaymentMethod(exp.paymentMethod, reassignWarningMethod));

      // Update matching appointments
      for (const appItem of usedInAppointments) {
        await updateDoc(doc(db, 'clinics', clinicId, 'appointments', appItem.id), {
          paymentMethod: reassignTargetMethod
        });
      }

      // Update matching expenses
      for (const expItem of usedInExpenses) {
        await updateDoc(doc(db, 'clinics', clinicId, 'expenses', expItem.id), {
          paymentMethod: reassignTargetMethod
        });
      }

      // 2. Remove from clinic paymentMethods list
      const currentMethods = clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
      const updatedMethods = currentMethods.filter(m => m !== reassignWarningMethod);

      const docRef = doc(db, 'clinics', clinicId);
      await updateDoc(docRef, { paymentMethods: updatedMethods });
      onClinicDataUpdated({ ...clinic, paymentMethods: updatedMethods });

      setSettingsSuccess(`تم ترحيل عدد (${usedInAppointments.length}) مدفوعات و (${usedInExpenses.length}) مصاريف إلى (${reassignTargetMethod}) وحذف طريقة الدفع (${reassignWarningMethod}) بنجاح!`);
      setReassignWarningMethod(null);
      setReassignTargetMethod('');
    } catch (err: any) {
      dialogs.alert('حدث خطأ أثناء ترحيل البيانات وحذف طريقة الدفع: ' + err.toString(), { severity: 'error' });
    } finally {
      setIsCheckingPaymentUsage(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
      
      {/* Right Side Navigation tabs (takes 1 column on lg) */}
      <div className="lg:col-span-1">
        <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
          <p className="text-[10px] text-slate-400 font-black px-2 uppercase tracking-wider mb-2">
            {isEn ? 'Settings Sections' : 'أقسام لوحة الإعدادات'}
          </p>
          
          {/* Identity Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('profile');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'profile'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Activity className={`h-4 w-4 shrink-0 ${settingsSubTab === 'profile' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Clinic Identity & Rx Pad' : 'هوية العيادة والروشتة'}</span>
          </button>

          {/* Price List & Services Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('services_prices');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'services_prices'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Tag className={`h-4 w-4 shrink-0 ${settingsSubTab === 'services_prices' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Services & Price List' : 'قائمة الأسعار والخدمات'}</span>
          </button>

          {/* Patient Questionnaire Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('questionnaire');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'questionnaire'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <ClipboardList className={`h-4 w-4 shrink-0 ${settingsSubTab === 'questionnaire' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Patient Questionnaire' : 'استبيان المرضى'}</span>
          </button>

          {/* Staff Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('staff');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'staff'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Users className={`h-4 w-4 shrink-0 ${settingsSubTab === 'staff' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Staff Management' : 'شؤون الموظفين'}</span>
          </button>

          {/* Backup Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('backup');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'backup'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Database className={`h-4 w-4 shrink-0 ${settingsSubTab === 'backup' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Backup & Restore' : 'النسخ والنسخ الاحتياطي'}</span>
          </button>

          {/* Subscription Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('subscription');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'subscription'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Receipt className={`h-4 w-4 shrink-0 ${settingsSubTab === 'subscription' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Subscription Details' : 'تفاصيل الاشتراك'}</span>
          </button>

          {/* Payment Methods Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('payment_methods');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'payment_methods'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <CreditCard className={`h-4 w-4 shrink-0 ${settingsSubTab === 'payment_methods' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Payment Methods' : 'طرق الدفع بالعيادة'}</span>
          </button>

          {/* Loyalty Program Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('loyalty_program');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'loyalty_program'
                ? 'bg-amber-50 text-amber-800 border-amber-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Gift className={`h-4 w-4 shrink-0 ${settingsSubTab === 'loyalty_program' ? 'text-amber-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Loyalty Program' : 'نظام ولاء المرضى والمكافآت'}</span>
          </button>

          {/* Technical Support Tab */}
          <button
            type="button"
            onClick={() => {
              setSettingsSubTab('tech_support');
              setSettingsSuccess('');
              setSettingsError('');
            }}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-right cursor-pointer ${
              settingsSubTab === 'tech_support'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-500 shadow-3xs'
                : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <Headphones className={`h-4 w-4 shrink-0 ${settingsSubTab === 'tech_support' ? 'text-emerald-600' : 'text-slate-400'}`} />
            <span>{isEn ? 'Technical Support' : 'قسم الدعم الفني والتواصل'}</span>
          </button>
        </div>
      </div>

      {/* Left Side Tab Content Panel */}
      <div className="lg:col-span-3">
        
        {/* Settings alerts */}
        {settingsSuccess && (
          <div className="mb-4 bg-emerald-50 border-r-4 border-emerald-500 p-3.5 rounded-2xl flex items-center gap-2 text-xs font-bold text-emerald-800 animate-fade-in">
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{settingsSuccess}</span>
          </div>
        )}
        {settingsError && (
          <div className="mb-4 bg-rose-50 border-r-4 border-rose-500 p-3.5 rounded-2xl flex items-center gap-2 text-xs font-bold text-rose-800 animate-fade-in">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{settingsError}</span>
          </div>
        )}

        {/* 1. CLINIC BRANDING TAB */}
        {settingsSubTab === 'profile' && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Visual Header / Guidance */}
            <div className="bg-gradient-to-l from-emerald-50 via-teal-50/20 to-transparent p-6 rounded-3xl border border-emerald-100/70">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-emerald-600 animate-pulse" />
                    {isEn ? 'Clinic Settings & Rx Pad' : 'إعدادات العيادة'}
                  </h2>
                </div>
                <div className="shrink-0 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full text-[11px] font-black text-emerald-700 flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  {isEn ? 'Verified Smart Rx' : 'روشتة ذكية ومعتمدة'}
                </div>
              </div>
            </div>

            <div className="max-w-4xl space-y-6">
              
              {/* Form Panel */}
              <div className="space-y-6">
                <form onSubmit={handleUpdateClinicBranding} className="space-y-6 text-right">
                  
                  {/* Modern Tab Selector to switch between the 5 compact settings tabs */}
                  <div className="bg-slate-100/70 p-1.5 rounded-2xl border border-slate-200/80 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1 shadow-3xs">
                    <button
                      type="button"
                      onClick={() => setProfileSubSection('identity')}
                      className={`py-2 px-1.5 rounded-xl text-[10.5px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                        profileSubSection === 'identity'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{isEn ? 'Clinic Name & Logo' : 'اسم وشعار العيادة'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setProfileSubSection('doctor')}
                      className={`py-2 px-1.5 rounded-xl text-[10.5px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                        profileSubSection === 'doctor'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      <span>{isEn ? 'Doctor Info' : 'بيانات الطبيب'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setProfileSubSection('contact')}
                      className={`py-2 px-1.5 rounded-xl text-[10.5px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                        profileSubSection === 'contact'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{isEn ? 'Address & Contact' : 'العناوين والاتصال'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setProfileSubSection('style')}
                      className={`py-2 px-1.5 rounded-xl text-[10.5px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                        profileSubSection === 'style'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      <Settings className="h-3.5 w-3.5 shrink-0" />
                      <span>{isEn ? 'Rx Style & Fee' : 'مظهر الروشتة والسعر'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setProfileSubSection('booking')}
                      className={`py-2 px-1.5 rounded-xl text-[10.5px] font-black transition-all flex items-center justify-center gap-1 cursor-pointer ${
                        profileSubSection === 'booking'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
                      }`}
                    >
                      <Ticket className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                      <span>{isEn ? 'Booking System' : 'نظام الحجز'}</span>
                    </button>
                  </div>

                  {/* Render only the active sub-section card */}
                  {profileSubSection === 'identity' && (
                    <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-3xs space-y-6 animate-fade-in">
                      <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
                        <span className="p-2.5 bg-emerald-50 rounded-2xl shrink-0">
                          <Building2 className="h-5 w-5 text-emerald-600" />
                        </span>
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-black text-slate-800">
                            {isEn ? '1. Clinic Name & Official Logo' : '1. اسم العيادة والشعار الرسمي'}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold">
                            {isEn ? 'Clinic name appears on top header and logo as watermark in Rx pad' : 'يُطبع اسم العيادة في أعلى الروشتة والشعار بالمنتصف كعلامة مائية متميزة'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-black text-slate-700">
                              {isEn ? 'Clinic Name (Arabic)' : 'اسم العيادة (باللغة العربية)'} <span className="text-rose-500">*</span>
                            </label>
                            <span className="text-[9px] text-slate-400 font-bold">{isEn ? 'Right Header' : 'يظهر بالترويسة اليمنى'}</span>
                          </div>
                          <input
                            type="text"
                            required
                            value={clinicNameArInput}
                            onChange={(e) => setClinicNameArInput(e.target.value)}
                            placeholder={isEn ? 'e.g. Smile Dental Clinic' : 'مثال: عيادة الابتسامة لطب الأسنان'}
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-black text-slate-700">
                              {isEn ? 'Clinic Name (English)' : 'اسم العيادة (باللغة الإنجليزية)'} <span className="text-rose-500">*</span>
                            </label>
                            <span className="text-[9px] text-slate-400 font-bold">{isEn ? 'Left Header' : 'يظهر بالترويسة اليسرى'}</span>
                          </div>
                          <input
                            type="text"
                            required
                            value={clinicNameEnInput}
                            onChange={(e) => {
                              setClinicNameEnInput(e.target.value);
                              setClinicNameInput(e.target.value);
                            }}
                            placeholder="e.g. Smile Clinic for Dentistry"
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs text-left font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                            dir="ltr"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-[11px] font-black text-slate-700">شعار العيادة الرسمي:</label>
                        <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50/40 p-4 rounded-2xl border border-slate-200/50">
                          {clinicLogoInput && clinicLogoInput.trim() !== '' ? (
                            <div className="relative shrink-0 group">
                              <img 
                                src={clinicLogoInput} 
                                alt="Logo Preview" 
                                className="w-20 h-20 rounded-2xl object-contain border-2 border-emerald-500/20 bg-white p-2 shadow-sm transition-all group-hover:scale-105"
                              />
                              <button
                                type="button"
                                onClick={() => setClinicLogoInput('')}
                                className="absolute -top-2 -left-2 bg-rose-500 hover:bg-rose-600 text-white rounded-full w-5.5 h-5.5 flex items-center justify-center text-xs font-black border-2 border-white shadow-md transition-all cursor-pointer"
                                title="حذف الشعار"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <div className="w-20 h-20 rounded-2xl bg-white flex flex-col items-center justify-center border-2 border-dashed border-slate-200 text-slate-400 shrink-0 shadow-3xs">
                              <Building2 className="h-6 w-6 text-slate-300" />
                              <span className="text-[9px] text-slate-400 mt-1 font-black">بلا شعار</span>
                            </div>
                          )}
                          <div className="flex-1 space-y-2 text-right w-full">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  if (file.size > 1024 * 1024 * 5) {
                                    dialogs.alert('حجم الصورة كبير جداً! الحد الأقصى المسموح به هو 5 ميجابايت.', { severity: 'warning' });
                                    return;
                                  }
                                  uploadFileToR2(file, 'logos', clinic.id)
                                    .then((r2Url) => {
                                      setClinicLogoInput(r2Url);
                                      dialogs.alert('تم رفع شعار العيادة بنجاح على Cloudflare R2!', { severity: 'success' });
                                    })
                                    .catch((err) => {
                                      console.warn('R2 logo upload failed, falling back to local compression:', err);
                                      resizeImageToWidth190(file)
                                        .then((resizedBase64) => setClinicLogoInput(resizedBase64))
                                        .catch(() => dialogs.alert('حدث خطأ أثناء معالجة الصورة.', { severity: 'error' }));
                                    });
                                }
                              }}
                              className="w-full text-xs text-slate-500 file:ml-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[11px] file:font-black file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100/80 cursor-pointer"
                            />

                            <p className="text-[10px] text-slate-400 leading-normal font-medium">الامتدادات المدعومة: PNG, JPG, WebP. يتم تعديل حجم وضغط الصورة تلقائياً لتبدو بأبهى دقة طباعة.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {profileSubSection === 'doctor' && (
                    <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-3xs space-y-6 animate-fade-in">
                      <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
                        <span className="p-2.5 bg-blue-50 rounded-2xl shrink-0">
                          <Users className="h-5 w-5 text-blue-600" />
                        </span>
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-black text-slate-800">
                            {isEn ? '2. Doctor Name & Medical Specialty' : '2. اسم الطبيب والتخصص الطبي'}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold">
                            {isEn ? 'Printed on the Rx header in both Arabic and English' : 'تُطبع هذه البيانات في ترويسة الروشتة العلوية باللغتين العربية والإنجليزية لضمان المظهر الاحترافي'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-black text-slate-700">
                              {isEn ? 'Doctor Name (Arabic)' : 'اسم الطبيب المعالج (بالعربية)'} <span className="text-rose-500">*</span>
                            </label>
                            <span className="text-[9px] text-slate-400 font-bold">{isEn ? 'Right Side' : 'على اليمين'}</span>
                          </div>
                          <input
                            type="text"
                            required
                            value={clinicDoctorNameInput}
                            onChange={(e) => setClinicDoctorNameInput(e.target.value)}
                            placeholder={isEn ? 'e.g. Dr. Mohamed El-Saadany' : 'مثال: د. محمد السعدني'}
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-black text-slate-700">
                              {isEn ? 'Doctor Name (English)' : 'اسم الطبيب (بالأحرف الإنجليزية)'} <span className="text-rose-500">*</span>
                            </label>
                            <span className="text-[9px] text-slate-400 font-bold">{isEn ? 'Left Side' : 'على اليسار'}</span>
                          </div>
                          <input
                            type="text"
                            required
                            value={clinicDoctorNameEnInput}
                            onChange={(e) => setClinicDoctorNameEnInput(e.target.value)}
                            placeholder="e.g. Dr. Mohamed El-Saadany"
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs text-left font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                            dir="ltr"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-black text-slate-700">
                              {isEn ? 'Medical Specialty (Arabic)' : 'التخصص الطبي (بالعربية)'}
                            </label>
                            <span className="text-[9px] text-slate-400 font-bold">{isEn ? 'Under Arabic Name' : 'يظهر أسفل الاسم العربي'}</span>
                          </div>
                          <input
                            type="text"
                            value={clinicDoctorSpecialtyArInput}
                            onChange={(e) => setClinicDoctorSpecialtyArInput(e.target.value)}
                            placeholder={isEn ? 'e.g. Consultant Dentist & Implantologist' : 'مثال: أخصائي طب وجراحة وزراعة الأسنان'}
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-black text-slate-700">
                              {isEn ? 'Medical Specialty (English)' : 'التخصص الطبي (بالإنجليزية)'}
                            </label>
                            <span className="text-[9px] text-slate-400 font-bold">{isEn ? 'Under English Name' : 'يظهر أسفل الاسم الإنجليزي'}</span>
                          </div>
                          <input
                            type="text"
                            value={clinicDoctorSpecialtyEnInput}
                            onChange={(e) => setClinicDoctorSpecialtyEnInput(e.target.value)}
                            placeholder="e.g. Dentist & Oral Surgery Specialist"
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs text-left font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                            dir="ltr"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {profileSubSection === 'contact' && (
                    <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-3xs space-y-6 animate-fade-in">
                      <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
                        <span className="p-2.5 bg-indigo-50 rounded-2xl shrink-0">
                          <Phone className="h-5 w-5 text-indigo-600" />
                        </span>
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-black text-slate-800">
                            {isEn ? '3. Contact, Address & Working Hours' : '3. الاتصال والعناوين ومواعيد العمل'}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold">
                            {isEn ? 'Printed at the bottom Rx footer for easy patient contact' : 'تُطبع هذه البيانات في تذييل الروشتة بالأسفل لتسهيل التواصل والزيارة للمريض'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div className="sm:col-span-2 space-y-1.5">
                          <label className="block text-[11px] font-black text-slate-700">
                            {isEn ? 'Main Contact & Booking Phone' : 'رقم هاتف الاتصال والحجز الرئيسي'} <span className="text-rose-500">*</span>
                            <span className="text-[10px] text-slate-400 font-normal mr-1">(11 digits)</span>
                          </label>
                          <input
                            type="tel"
                            required
                            maxLength={11}
                            inputMode="numeric"
                            value={clinicDoctorPhoneInput}
                            onChange={(e) => setClinicDoctorPhoneInput(formatEgyptianPhoneInput(e.target.value))}
                            placeholder="01012345678"
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs text-left font-mono font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                            dir="ltr"
                          />
                        </div>

                        {additionalPhonesInput.map((phone, index) => (
                          <div key={index} className="sm:col-span-2 space-y-1.5 bg-slate-50/40 p-4 rounded-2xl border border-slate-200 animate-fade-in">
                            <div className="flex items-center justify-between">
                              <label className="block text-[11px] font-black text-slate-700">
                                {isEn ? `Additional Phone ${index + 1}` : `رقم هاتف إضافي للعيادة ${index + 1}`}
                                <span className="text-[10px] text-slate-400 font-normal mr-1">(11 digits)</span>
                              </label>
                              <button
                                type="button"
                                onClick={() => {
                                  setAdditionalPhonesInput(prev => prev.filter((_, i) => i !== index));
                                }}
                                className="text-[10px] text-rose-500 hover:text-rose-700 font-extrabold flex items-center gap-0.5 cursor-pointer"
                              >
                                <span>{isEn ? '× Remove' : '× حذف الرقم'}</span>
                              </button>
                            </div>
                            <input
                              type="tel"
                              maxLength={11}
                              inputMode="numeric"
                              value={phone}
                              onChange={(e) => {
                                const val = formatEgyptianPhoneInput(e.target.value);
                                setAdditionalPhonesInput(prev => prev.map((p, i) => i === index ? val : p));
                              }}
                              placeholder="01198765432"
                              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs text-left font-mono font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                              dir="ltr"
                            />
                          </div>
                        ))}

                        {additionalPhonesInput.length < 4 && (
                          <div className="sm:col-span-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (additionalPhonesInput.length >= 4) return;
                                setAdditionalPhonesInput(prev => [...prev, '']);
                              }}
                              className="w-full py-2.5 border-2 border-dashed border-slate-200 hover:border-indigo-500 text-slate-500 hover:text-indigo-700 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-slate-50/20 hover:bg-indigo-50/20"
                            >
                              <Plus className="h-3.5 w-3.5 text-indigo-500" />
                              <span>{isEn ? `Add Another Phone Number (${4 - additionalPhonesInput.length} left)` : `إضافة رقم هاتف آخر للعيادة (متبقي ${4 - additionalPhonesInput.length} أرقام إضافية متاحة)`}</span>
                            </button>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-black text-slate-700">
                            {isEn ? 'Detailed Clinic Address' : 'عنوان العيادة التفصيلي'} <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={clinicAddressInput}
                            onChange={(e) => setClinicAddressInput(e.target.value)}
                            placeholder={isEn ? 'e.g. Cairo, Tayaran St., 1st Floor' : 'مثال: القاهرة، شارع الطيران، بجوار مستشفى التأمين، الدور الأول'}
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-black text-slate-700">
                            {isEn ? 'Clinic Working Hours' : 'مواعيد وساعات العمل بالعيادة'} <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            required
                            value={clinicHoursInput}
                            onChange={(e) => setClinicHoursInput(e.target.value)}
                            placeholder={isEn ? 'e.g. Daily 5 PM - 10 PM except Friday' : 'مثال: يومياً من 5 لـ 10 مساءً عدا الجمعة'}
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {profileSubSection === 'style' && (
                    <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-3xs space-y-6 animate-fade-in">
                      <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
                        <span className="p-2.5 bg-purple-50 rounded-2xl shrink-0">
                          <Settings className="h-5 w-5 text-purple-600" />
                        </span>
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-black text-slate-800">
                            {isEn ? '4. Rx Pad Design & Consultation Fee' : '4. تصميم الروشتة وأسعار الخدمات'}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold">
                            {isEn ? 'Customize medication layout, color theme, and default consultation price' : 'تخصيص مظهر عرض الأدوية ولون التصميم المطبوع بالإضافة للقيمة الافتراضية للكشف'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-black text-slate-700">
                            {isEn ? 'Visual Theme & Style:' : 'نمط ولون التصميم البصري:'}
                          </label>
                          <select
                            value={clinicPrescriptionStyleInput}
                            onChange={(e) => setClinicPrescriptionStyleInput(e.target.value as any)}
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs bg-white text-slate-800 font-bold cursor-pointer transition-all shadow-3xs"
                          >
                            <option value="classic">{isEn ? 'Classic Cyan' : 'كلاسيكي سماوي (Classic Cyan)'}</option>
                            <option value="modern">{isEn ? 'Modern Emerald' : 'حديث زمردي (Modern Emerald)'}</option>
                            <option value="minimal">{isEn ? 'Minimal Black' : 'بسيط وهادئ (Minimal Black)'}</option>
                            <option value="elegant">{isEn ? 'Elegant Royal' : 'ملكي بنفسجي (Elegant Royal)'}</option>
                            <option value="custom_pad">{isEn ? '🎨 Pre-printed Custom Pad' : '🎨 تصميمي الخاص (روشتة العيادة المطبوعة مسبقاً من المطبعة)'}</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-black text-slate-700">
                            {isEn ? 'Medication Layout:' : 'تنسيق عرض الأدوية:'}
                          </label>
                          <select
                            value={clinicPrescriptionLayoutInput}
                            onChange={(e) => setClinicPrescriptionLayoutInput(e.target.value as 'traditional' | 'table')}
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs bg-white text-slate-800 font-bold cursor-pointer transition-all shadow-3xs"
                          >
                            <option value="traditional">{isEn ? 'Traditional Spaced Rx Symbols' : 'رموز Rx وقائمة تقليدية متباعدة'}</option>
                            <option value="table">{isEn ? 'Structured Grid Table' : 'جدول بيانات مسطر ومنظم بالكامل'}</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-[11px] font-black text-slate-700">
                            {isEn ? 'Default Consultation Fee (EGP)' : 'سعر الكشف الافتراضي (ج.م)'} <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            required
                            value={clinicConsultationPriceInput}
                            onChange={(e) => setClinicConsultationPriceInput(Number(e.target.value) || 0)}
                            placeholder="200"
                            className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-xs font-bold text-slate-800 transition-all placeholder:text-slate-400 focus:bg-white"
                          />
                        </div>
                      </div>

                      {/* Custom Prescription Pad Visual Editor */}
                      {clinicPrescriptionStyleInput === 'custom_pad' && (
                        <div className="pt-4 animate-fade-in">
                          <CustomPrescriptionPadEditor
                            config={getEffectivePadConfig(clinic?.id, customPrescriptionPadConfigInput)}
                            onChange={(newCfg) => {
                              setCustomPrescriptionPadConfigInput(newCfg);
                              saveEffectivePadConfig(clinic?.id, newCfg);
                              if (newCfg.backgroundImage) {
                                setClinicPrescriptionStyleInput('custom_pad');
                              }
                            }}
                            doctorName={clinicDoctorNameInput}
                            clinicName={clinicNameArInput || clinicNameInput}
                            clinicId={clinic?.id}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {profileSubSection === 'booking' && (
                    <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-3xs space-y-6 animate-fade-in">
                      <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
                        <span className="p-2.5 bg-indigo-50 rounded-2xl shrink-0">
                          <Ticket className="h-5 w-5 text-indigo-600" />
                        </span>
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-black text-slate-800">
                            {isEn ? '5. Appointment Booking System' : '5. نظام حجز المواعيد بالعيادة'}
                          </h3>
                          <p className="text-[10px] text-slate-400 font-semibold">
                            {isEn ? 'Select the clinic appointment booking system format...' : 'حدد نظام وتنسيق حجز المواعيد المعتمد للعيادة. خيارك المحدد ينطبق تلقائياً وبشكل مباشر على سجل المواعيد.'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                          type="button"
                          onClick={() => handleSelectBookingMode('turn')}
                          className={`p-5 rounded-2xl border text-right transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                            bookingSystemModeInput === 'turn'
                              ? 'bg-amber-50/90 border-amber-500 ring-2 ring-amber-500/20 shadow-sm'
                              : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/80 text-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black text-amber-950 flex items-center gap-2">
                              <Ticket className="h-5 w-5 text-amber-600" />
                              {isEn ? 'Queue Numbers System' : 'نظام الدور (بالأرقام)'}
                            </span>
                            {bookingSystemModeInput === 'turn' ? (
                              <span className="text-xs bg-amber-600 text-white font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 shadow-2xs">
                                <CheckCircle className="h-3.5 w-3.5" />
                                {isEn ? 'Active' : 'معتمد'}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 font-medium">{isEn ? 'Select' : 'تحديد'}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed font-medium">
                            {isEn ? 'Sequential queue numbers (#1, #2...). Best for first-come, first-served consultations.' : 'تسجيل وحجز المواعيد بـ أرقام متسلسلة تلقائية (مثال: دور #1، دور #2...). يناسب الكشوفات بناءً على أسبقية الحضور.'}
                          </p>
                          <div className="pt-2 border-t border-amber-200/50 flex items-center justify-between text-[11px] font-bold text-amber-900">
                            <span>{isEn ? 'Display:' : 'طريقة العرض:'}</span>
                            <span className="bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md font-mono">{isEn ? 'Turn #1' : 'دور #1'}</span>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSelectBookingMode('time')}
                          className={`p-5 rounded-2xl border text-right transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                            bookingSystemModeInput === 'time'
                              ? 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm'
                              : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/80 text-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black text-indigo-950 flex items-center gap-2">
                              <Clock className="h-5 w-5 text-indigo-600" />
                              {isEn ? 'Time Slot System' : 'نظام الساعات (توقيت محدد)'}
                            </span>
                            {bookingSystemModeInput === 'time' ? (
                              <span className="text-xs bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 shadow-2xs">
                                <CheckCircle className="h-3.5 w-3.5" />
                                {isEn ? 'Active' : 'معتمد'}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 font-medium">{isEn ? 'Select' : 'تحديد'}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed font-medium">
                            {isEn ? 'Specific time slots (e.g. 05:30 PM). Best for scheduled surgeries and procedural sessions.' : 'تسجيل المواعيد بـ توقيتات محددة بالساعة والدقيقة (مثال: 05:30 م). يناسب العمليات والتركيبات والجلسات المحددة بوقت.'}
                          </p>
                          <div className="pt-2 border-t border-indigo-200/50 flex items-center justify-between text-[11px] font-bold text-indigo-900">
                            <span>{isEn ? 'Display:' : 'طريقة العرض:'}</span>
                            <span className="bg-indigo-100 border border-indigo-300 px-2 py-0.5 rounded-md font-mono">05:30 PM</span>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Save Button */}
                  <button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-4 rounded-2xl text-xs transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="h-4.5 w-4.5" />
                    <span>
                      {profileSubSection === 'booking' 
                        ? (isEn ? 'Save & Apply Booking System' : 'حفظ وتطبيق نظام الحجز المعتمد للمواعيد فوراً')
                        : (isEn ? 'Save Clinic Identity & Update Rx' : 'حفظ واعتماد هوية العيادة وتحديث الروشتات فوراً')}
                    </span>
                  </button>
                </form>
              </div>

            </div>

          </div>
        )}

        {/* PRICE LIST & SERVICES TAB */}
        {settingsSubTab === 'services_prices' && (
          <div className="space-y-6 animate-fade-in">
            {/* Header Banner */}
            <div className="bg-gradient-to-l from-emerald-500/10 via-teal-500/5 to-transparent p-6 rounded-3xl border border-emerald-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
                  <Tag className="h-5 w-5 text-emerald-600" />
                  {isEn ? 'Price List & Medical Services' : 'قائمة الأسعار والخدمات الطبية'}
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {isEn ? 'Specify all services and procedures offered by your clinic and their fees in EGP. Used for invoicing and tooth condition updates.' : 'قم بتحديد جميع الخدمات والإجراءات التي تقدمها عيادتك وأسعارها بالجنيه المصري. يتم استخدام هذه القائمة عند تحديد الإجراء للمريض لحساب الفاتورة وتغيير الرسم البياني للأسنان تلقائياً.'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-400 block">{isEn ? 'Total Services:' : 'إجمالي الخدمات:'}</span>
                  <span className="text-sm font-black text-emerald-600">{settingsServicesList.length}</span>
                </div>
                <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-400 block">{isEn ? 'Categories:' : 'عدد الأقسام:'}</span>
                  <span className="text-sm font-black text-indigo-600">{settingsCategoriesList.length}</span>
                </div>
              </div>
            </div>

            {/* Navigation Tabs (Services vs Categories) */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setServicesActiveTab('services')}
                  className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                    servicesActiveTab === 'services'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Stethoscope className="h-4 w-4" />
                  <span>{isEn ? `Procedures & Services (${settingsServicesList.length})` : `الإجراءات والخدمات (${settingsServicesList.length})`}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setServicesActiveTab('categories')}
                  className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                    servicesActiveTab === 'categories'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Tag className="h-4 w-4" />
                  <span>{isEn ? `Categories & Filters (${settingsCategoriesList.length})` : `أقسام وفلاتر الخدمات (${settingsCategoriesList.length})`}</span>
                </button>
              </div>

              {servicesActiveTab === 'services' && (
                <div className="relative min-w-[200px]">
                  <Search className="h-4 w-4 text-slate-400 absolute right-3 top-2.5" />
                  <input
                    type="text"
                    value={serviceSearchTerm}
                    onChange={(e) => setServiceSearchTerm(e.target.value)}
                    placeholder={isEn ? 'Search service or price...' : 'بحث عن خدمة أو سعر...'}
                    className="w-full pr-9 pl-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-3xs"
                  />
                </div>
              )}
            </div>

            {/* SERVICES VIEW */}
            {servicesActiveTab === 'services' && (
              <div className="space-y-6">
                
                {/* Form to Add / Edit Service */}
                <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="text-xs sm:text-sm font-black text-slate-800 flex items-center gap-1.5">
                      <Plus className="h-4 w-4 text-emerald-600" />
                      {editingSrvId 
                        ? (isEn ? 'Edit Medical Service' : 'تعديل بيانات الخدمة الطبية')
                        : (isEn ? 'Add New Medical Service / Procedure' : 'إضافة خدمة أو إجراء طبي جديد لقائمة العيادة')}
                    </h3>
                    {editingSrvId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSrvId(null);
                          setSrvName('');
                          setSrvPrice(500);
                        }}
                        className="text-xs font-bold text-rose-600 hover:underline"
                      >
                        {isEn ? 'Cancel Edit' : 'إلغاء التعديل'}
                      </button>
                    )}
                  </div>

                  <form onSubmit={handleAddOrUpdateServiceInSettings} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-4">
                      <label className="block text-[11px] font-extrabold text-slate-700 mb-1">
                        {isEn ? 'Service / Procedure Name' : 'اسم الخدمة أو الإجراء الطبي'} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={srvName}
                        onChange={(e) => setSrvName(e.target.value)}
                        placeholder={isEn ? 'e.g. Composite Filling, Scaling, Extraction...' : 'مثال: حشو ليزر تجميلي، تنظيف جير، خلع عقل...'}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 bg-slate-50/50 focus:bg-white"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-extrabold text-slate-700 mb-1">{isEn ? 'Category' : 'القسم / التصنيف'}</label>
                      <select
                        value={srvCategory}
                        onChange={(e) => setSrvCategory(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
                      >
                        {settingsCategoriesList.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-extrabold text-slate-700 mb-1">{isEn ? 'Approved Price (EGP)' : 'السعر المعتمد (ج.م)'}</label>
                      <input
                        type="number"
                        required
                        min="0"
                        value={srvPrice}
                        onChange={(e) => setSrvPrice(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-black font-mono text-emerald-700 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-extrabold text-slate-700 mb-1">{isEn ? 'Tooth Chart Condition' : 'شكل لون الضرس في الخريطة'}</label>
                      <select
                        value={srvCondition}
                        onChange={(e) => setSrvCondition(e.target.value as DentalTooth['condition'])}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 bg-white cursor-pointer"
                      >
                        <option value="filled">{isEn ? 'Filled' : 'حشو (Filled)'}</option>
                        <option value="missing">{isEn ? 'Missing' : 'خلع / مفقود (Missing)'}</option>
                        <option value="crown">{isEn ? 'Crown' : 'تلبيسة / طربوش (Crown)'}</option>
                        <option value="healthy">{isEn ? 'Healthy / Cleaning' : 'تنظيف / سليم (Healthy)'}</option>
                        <option value="implant">{isEn ? 'Implant' : 'زراعة (Implant)'}</option>
                        <option value="bridge">{isEn ? 'Bridge' : 'جسر (Bridge)'}</option>
                        <option value="decayed">{isEn ? 'Decayed' : 'تسوس (Decayed)'}</option>
                        <option value="ortho">{isEn ? 'Ortho' : 'تقويم أسنان (Ortho)'}</option>
                      </select>
                    </div>

                    <div className="sm:col-span-12 flex justify-end pt-2">
                      <button
                        type="submit"
                        className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Check className="h-4 w-4 stroke-[3]" />
                        <span>{editingSrvId ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? '➕ Save Service & Price' : '➕ حفظ الخدمة وسعرها')}</span>
                      </button>
                    </div>
                  </form>
                </div>

                {/* Category Filter Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                  <span className="text-xs font-bold text-slate-400 shrink-0 ml-1">{isEn ? 'Filter by Category:' : 'تصفية حسب القسم:'}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCatFilter('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                      selectedCatFilter === 'all'
                        ? 'bg-emerald-600 text-white shadow-3xs'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {isEn ? `All (${settingsServicesList.length})` : `الكل (${settingsServicesList.length})`}
                  </button>
                  {settingsCategoriesList.map(cat => {
                    const count = settingsServicesList.filter(s => (s.category || 'عام') === cat).length;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCatFilter(cat)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer ${
                          selectedCatFilter === cat
                            ? 'bg-emerald-600 text-white shadow-3xs'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Services Table / Cards List */}
                <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs overflow-hidden">
                  {(() => {
                    const term = serviceSearchTerm.trim().toLowerCase();
                    const filteredServices = settingsServicesList.filter(s => {
                      const matchesCat = selectedCatFilter === 'all' || (s.category || 'عام') === selectedCatFilter;
                      const matchesSearch = !term || 
                        s.name.toLowerCase().includes(term) || 
                        (s.category || 'عام').toLowerCase().includes(term);
                      return matchesCat && matchesSearch;
                    });

                    return (
                      <>
                        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <span className="text-xs font-black text-slate-800">{isEn ? `Available Services (${filteredServices.length}):` : `قائمة الخدمات المتاحة (${filteredServices.length}):`}</span>
                          <div className="relative min-w-[220px]">
                            <Search className="h-4 w-4 text-slate-400 absolute right-3 top-2.5" />
                            <input
                              type="text"
                              value={serviceSearchTerm}
                              onChange={(e) => setServiceSearchTerm(e.target.value)}
                              placeholder={isEn ? 'Search by service or category...' : 'بحث باسم الخدمة أو القسم...'}
                              className="w-full pr-9 pl-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-3xs"
                            />
                          </div>
                        </div>

                        {filteredServices.length === 0 ? (
                          <div className="p-8 text-center text-slate-400 text-xs font-bold">
                            {isEn ? 'No services found matching search or selected category.' : 'لا توجد خدمات مطابقة للبحث أو القسم المحدد.'}
                          </div>
                        ) : (
                          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                            {filteredServices.map((srv) => (
                              <div
                                key={srv.id}
                                className="p-4 bg-white hover:bg-emerald-50/30 rounded-2xl border border-slate-200 hover:border-emerald-300 transition-all shadow-3xs flex flex-col justify-between gap-3 group relative"
                              >
                                <div className="space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <h4 className="text-xs font-black text-slate-900 leading-snug">{srv.name}</h4>
                                    <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100">
                                      <button
                                        type="button"
                                        onClick={() => handleEditServiceInSettings(srv)}
                                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                                        title={isEn ? 'Edit Service' : 'تعديل الخدمة والسعر'}
                                      >
                                        <Edit2 className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteServiceInSettings(srv.id)}
                                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                                        title={isEn ? 'Delete Service' : 'حذف الخدمة'}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                    <span className="bg-slate-100 text-slate-600 font-extrabold px-2 py-0.5 rounded-md">
                                      📁 {srv.category || 'عام'}
                                    </span>
                                    <span className="bg-indigo-50 text-indigo-700 font-extrabold px-2 py-0.5 rounded-md">
                                      🦷 {
                                        srv.condition === 'filled' ? (isEn ? 'Filled' : 'حشو') :
                                        srv.condition === 'missing' ? (isEn ? 'Missing' : 'خلع / مفقود') :
                                        srv.condition === 'crown' ? (isEn ? 'Crown' : 'تلبيسة') :
                                        srv.condition === 'implant' ? (isEn ? 'Implant' : 'زراعة') :
                                        srv.condition === 'bridge' ? (isEn ? 'Bridge' : 'جسر') :
                                        srv.condition === 'decayed' ? (isEn ? 'Decayed' : 'تسوس') :
                                        srv.condition === 'ortho' ? (isEn ? 'Ortho' : 'تقويم') : (isEn ? 'Healthy' : 'تنظيف / سليم')
                                      }
                                    </span>
                                  </div>
                                </div>

                                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400 font-bold">{isEn ? 'Approved Price:' : 'السعر المعتمد:'}</span>
                                  <span className="text-xs font-black font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100/80">
                                    {srv.price.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

              </div>
            )}

            {/* CATEGORIES VIEW */}
            {servicesActiveTab === 'categories' && (
              <div className="space-y-6">
                
                {/* Form to Add Category */}
                <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-2xs space-y-4">
                  <h3 className="text-xs sm:text-sm font-black text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3">
                    <Plus className="h-4 w-4 text-emerald-600" />
                    {isEn ? 'Add New Category' : 'إضافة قسم أو تصنيف خدمات جديد'}
                  </h3>

                  <form onSubmit={handleAddCategoryInSettings} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-[11px] font-extrabold text-slate-700 mb-1">{isEn ? 'New Category Name' : 'اسم القسم الجديد'}</label>
                      <input
                        type="text"
                        required
                        value={newCatNameInput}
                        onChange={(e) => setNewCatNameInput(e.target.value)}
                        placeholder={isEn ? 'e.g. Orthodontics, Pediatric, Oral Surgery...' : 'مثال: تقويم الأسنان، طب أسنان الأطفال، جراحة الفك...'}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 bg-slate-50/50 focus:bg-white"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition shadow-xs flex items-center gap-1 cursor-pointer h-[38px]"
                    >
                      <Plus className="h-4 w-4" />
                      <span>{isEn ? 'Add Category' : 'إضافة قسم'}</span>
                    </button>
                  </form>
                </div>

                {/* Categories List */}
                <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs overflow-hidden">
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <span className="text-xs font-black text-slate-800">{isEn ? `Available Categories (${settingsCategoriesList.length}):` : `الأقسام الحالية المتاحة لتبويب الخدمات (${settingsCategoriesList.length}):`}</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {settingsCategoriesList.map((cat, idx) => {
                      const count = settingsServicesList.filter(s => (s.category || 'عام') === cat).length;
                      return (
                        <div key={cat} className="p-4 flex items-center justify-between gap-3 text-xs">
                          {editingCatIdx === idx ? (
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                type="text"
                                value={editCatValInput}
                                onChange={(e) => setEditCatValInput(e.target.value)}
                                className="flex-1 px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 bg-white"
                              />
                              <button
                                type="button"
                                onClick={() => handleUpdateCategoryInSettings(cat, editCatValInput)}
                                className="px-3 py-1.5 bg-emerald-600 text-white font-black rounded-xl text-xs shadow-xs"
                              >
                                {isEn ? 'Save' : 'حفظ'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCatIdx(null)}
                                className="px-3 py-1.5 bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
                              >
                                {isEn ? 'Cancel' : 'إلغاء'}
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="font-black text-slate-800">📁 {cat}</span>
                                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-bold">
                                  {count} {isEn ? 'services' : 'خدمة'}
                                </span>
                              </div>

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCatIdx(idx);
                                    setEditCatValInput(cat);
                                  }}
                                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                                  title={isEn ? 'Edit Category' : 'تعديل اسم القسم'}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                {settingsCategoriesList.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteCategoryInSettings(cat)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                                    title="حذف القسم"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}

          </div>
        )}

        {/* PATIENT QUESTIONNAIRE SETTINGS TAB */}
        {settingsSubTab === 'questionnaire' && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-emerald-600" />
                  {isEn ? 'Patient Intake Questionnaire Settings' : 'إعدادات استبيان المرضى الأولي (أسئلة حجز الاستقبال)'}
                </h2>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {isEn ? 'Customize medical questions shown during new patient registration for medical history collection.' : 'يمكنك تخصيص وتعديل وإضافة الأسئلة الطبية التي تظهر في نموذج تسجيل المريض الجديد لموظف الاستقبال لجمع التاريخ الطبي والتنبيهات المسبقة.'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowAddQuestionForm(prev => !prev)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>
                    {showAddQuestionForm 
                      ? (isEn ? 'Close Form' : 'إغلاق نموذج الإضافة') 
                      : (isEn ? 'Add Question' : 'إضافة سؤال استبيان')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleResetQuestionsToDefaults}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition shrink-0 cursor-pointer"
                  title={isEn ? 'Reset to Default Questions' : 'استعادة الأسئلة الافتراضية للعيادة'}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-600" />
                  <span>{isEn ? 'Reset Defaults' : 'استعادة الأسئلة الافتراضية'}</span>
                </button>
              </div>
            </div>

            {/* Add New Question Form - Only visible when toggled */}
            {showAddQuestionForm && (
              <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200/80 space-y-4 animate-fade-in">
                <h3 className="text-xs font-black text-slate-800 flex items-center gap-2">
                  <Plus className="h-4 w-4 text-emerald-600" />
                  {isEn ? 'Add New Questionnaire Question' : 'إضافة سؤال جديد لاستبيان الاستقبال'}
                </h3>
                <form onSubmit={handleAddQuestionInSettings} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-6">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        {isEn ? 'Question Text *' : 'نص السؤال الطبي *'}
                      </label>
                      <input
                        type="text"
                        value={newQuestionText}
                        onChange={(e) => setNewQuestionText(e.target.value)}
                        placeholder={isEn ? 'e.g. Are you taking painkillers or blood thinners?' : 'مثال: هل تتناول أدوية مسكنة للآلام أو مضادات التجلط؟'}
                        className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        {isEn ? 'Category (Optional)' : 'تصنيف السؤال (اختياري)'}
                      </label>
                      <input
                        type="text"
                        value={newQuestionCategory}
                        onChange={(e) => setNewQuestionCategory(e.target.value)}
                        placeholder={isEn ? 'e.g. Medications / Chronic / Allergy' : 'مثال: أدوية / أمراض مزمنة / حساسية'}
                        className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        {isEn ? 'Placeholder for Details' : 'توضيح خانة التفاصيل عند اختيار (نعم)'}
                      </label>
                      <input
                        type="text"
                        value={newQuestionPlaceholder}
                        onChange={(e) => setNewQuestionPlaceholder(e.target.value)}
                        placeholder={isEn ? 'e.g. List medication names...' : 'مثال: اكتب أسماء الأدوية بانتظام...'}
                        className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddQuestionForm(false)}
                      className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      {isEn ? 'Cancel' : 'إلغاء'}
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>{isEn ? 'Save Question' : 'حفظ وإضافة السؤال'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Questions List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-800">
                  {isEn ? `Current Questions (${questionnaireQuestions.filter(q => q.enabled !== false).length} enabled of ${questionnaireQuestions.length})` : `أسئلة الاستبيان الحالية (${questionnaireQuestions.filter(q => q.enabled !== false).length} مفعل من أصل ${questionnaireQuestions.length})`}
                </h3>
                <span className="text-[11px] text-slate-500">
                  {isEn ? 'Shown to receptionists during patient intake' : 'تظهر هذه الأسئلة لموظف الاستقبال عند إضافة أو تعديل مريض'}
                </span>
              </div>

              {questionnaireQuestions.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
                  {isEn ? 'No questions registered. Click "Reset Defaults" or add a new question.' : 'لا توجد أسئلة مسجلة بالاستبيان حالياً. اضغط على "استعادة الأسئلة الافتراضية" أو أضف سؤالاً جديداً.'}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {questionnaireQuestions.map((q, index) => {
                    const isEditingThis = editingQuestionId === q.id;
                    return (
                      <div
                        key={q.id}
                        className={`p-4 rounded-2xl border transition-all ${
                          q.enabled !== false
                            ? 'bg-white border-slate-200 shadow-2xs'
                            : 'bg-slate-50/70 border-slate-200/60 opacity-60'
                        }`}
                      >
                        {isEditingThis ? (
                          /* Inline Edit Form */
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                              <div className="md:col-span-6">
                                <label className="block text-[11px] font-bold text-slate-700 mb-1">{isEn ? 'Question Text' : 'نص السؤال'}</label>
                                <input
                                  type="text"
                                  value={editQuestionText}
                                  onChange={(e) => setEditQuestionText(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-bold"
                                />
                              </div>
                              <div className="md:col-span-3">
                                <label className="block text-[11px] font-bold text-slate-700 mb-1">{isEn ? 'Category' : 'التصنيف'}</label>
                                <input
                                  type="text"
                                  value={editQuestionCategory}
                                  onChange={(e) => setEditQuestionCategory(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-medium"
                                />
                              </div>
                              <div className="md:col-span-3">
                                <label className="block text-[11px] font-bold text-slate-700 mb-1">{isEn ? 'Placeholder' : 'توضيح التفاصيل'}</label>
                                <input
                                  type="text"
                                  value={editQuestionPlaceholder}
                                  onChange={(e) => setEditQuestionPlaceholder(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-xl text-xs font-medium"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingQuestionId(null)}
                                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition"
                              >
                                {isEn ? 'Cancel' : 'إلغاء'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEditedQuestion(q.id)}
                                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition"
                              >
                                {isEn ? 'Save' : 'حفظ التعديل'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Display View */
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-black text-slate-400">#{index + 1}</span>
                                <h4 className="text-xs font-black text-slate-800">{q.text}</h4>
                                {q.category && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                    {q.category}
                                  </span>
                                )}
                                {q.enabled === false && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                    {isEn ? 'Disabled' : 'معطل'}
                                  </span>
                                )}
                              </div>
                              {q.placeholder && (
                                <p className="text-[11px] text-slate-500 font-medium">
                                  {isEn ? `Detail note placeholder: "${q.placeholder}"` : `توضيح الإجابة التفصيلية: "${q.placeholder}"`}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {/* Toggle Button */}
                              <button
                                type="button"
                                onClick={() => handleToggleQuestionInSettings(q.id)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                                  q.enabled !== false
                                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                }`}
                              >
                                {q.enabled !== false ? (isEn ? 'Enabled' : 'مفعل') : (isEn ? 'Enable' : 'تفعيل')}
                              </button>

                              {/* Edit Button */}
                              <button
                                type="button"
                                onClick={() => handleStartEditQuestion(q)}
                                className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                                title={isEn ? 'Edit Question' : 'تعديل السؤال'}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={() => handleDeleteQuestionInSettings(q.id, q.text)}
                                className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                                title={isEn ? 'Delete Question' : 'حذف السؤال'}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. STAFF MANAGEMENT TAB */}
        {settingsSubTab === 'staff' && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6 animate-fade-in">
            <div>
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <Users className="h-5 w-5 text-indigo-600" />
                {isEn ? 'Staff Management & Access Permissions' : 'قسم شؤون الموظفين (تخصيص دخول السكرتارية والمساعدين)'}
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {isEn 
                  ? <>Create accounts for receptionists and assistants. Staff log in via Reception Portal using clinic email (<span className="font-mono font-bold text-indigo-600">{clinic.email}</span>) and the password assigned here.</>
                  : <>قم بإنشاء حسابات مخصصة لكل سكرتير أو مساعد في العيادة. يسجل الموظف دخوله باختيار (بوابة السكرتارية والمساعدين) باستخدام إيميل العيادة (<span className="font-mono font-bold text-indigo-600">{clinic.email}</span>) والباسورد المحددة له هنا.</>}
              </p>
            </div>

            {/* Form to add or edit a staff member */}
            <form onSubmit={handleSaveStaffMember} className="bg-indigo-50/30 p-5 rounded-2xl border border-indigo-100/70 space-y-4">
              <div className="flex items-center justify-between border-b border-indigo-100/50 pb-2">
                <h3 className="text-xs font-black text-indigo-900 flex items-center gap-1.5">
                  {editingStaffId ? <Edit2 className="h-4 w-4 text-amber-600" /> : <UserPlus className="h-4 w-4 text-indigo-600" />}
                  {editingStaffId 
                    ? (isEn ? 'Edit Staff Member Details' : 'تعديل بيانات الموظف / السكرتير') 
                    : (isEn ? 'Add New Staff Member & Set Credentials' : 'إضافة موظف / سكرتير جديد وتخصيص بيانات دخوله')}
                </h3>
                {editingStaffId && (
                  <button
                    type="button"
                    onClick={handleCancelEditStaff}
                    className="text-[11px] font-bold text-slate-500 hover:text-rose-600 flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200 cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                    {isEn ? 'Cancel Edit' : 'إلغاء التعديل'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">{isEn ? 'Staff Name *' : 'اسم الموظف / السكرتير *'}</label>
                  <input
                    type="text"
                    required
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    placeholder={isEn ? 'e.g. Sarah Ahmed' : 'مثال: سارة أحمد'}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">{isEn ? 'Job Title / Role *' : 'المسمى الوظيفي أو الدور *'}</label>
                  <select
                    value={newStaffRole}
                    onChange={(e) => setNewStaffRole(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 bg-white cursor-pointer"
                  >
                    <option value="سكرتير / استقبال">{isEn ? 'Receptionist / Secretary' : 'سكرتير / مسؤول استقبال'}</option>
                    <option value="مساعد طبيب">{isEn ? 'Dental Assistant' : 'مساعد طبيب أسنان'}</option>
                    <option value="ممرض / ممرضة">{isEn ? 'Clinic Nurse' : 'ممرض / ممرضة عيادة'}</option>
                    <option value="مدير إداري">{isEn ? 'Administrative Manager' : 'مدير إداري أو مالي'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">{isEn ? 'Login Password *' : 'الباسورد / كلمة المرور للدخول *'}</label>
                  <input
                    type="text"
                    required
                    value={newStaffPassword}
                    onChange={(e) => setNewStaffPassword(e.target.value)}
                    placeholder={isEn ? 'Set password (e.g. sara2026)' : 'حدد كلمة مرور للموظف (مثال: sara2026)'}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono font-bold text-indigo-700 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    {isEn ? 'Phone Number (Optional)' : 'رقم الهاتف (اختياري)'}
                    <span className="text-[10px] text-slate-400 font-normal mr-1">{isEn ? '(11 digits)' : '(11 رقم)'}</span>
                  </label>
                  <input
                    type="tel"
                    maxLength={11}
                    inputMode="numeric"
                    value={newStaffPhone}
                    onChange={(e) => setNewStaffPhone(formatEgyptianPhoneInput(e.target.value))}
                    placeholder="01012345678"
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono bg-white font-bold"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Tab Visibility / Permissions selection */}
              <div className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-3xs space-y-3">
                <div>
                  <h4 className="text-xs font-black text-indigo-950 flex items-center gap-1.5">
                    <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" />
                    {isEn ? 'Allowed Sections & Navigation Tabs' : 'تحديد التبويبات والأقسام المسموح بظهورها للموظف'}
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold mt-1">
                    {isEn ? 'Select tabs this staff member can access. Unchecked sections will be completely hidden.' : 'حدد الأقسام والتبويبات التي تريد من هذا الموظف رؤيتها واستخدامها عند تسجيل دخوله. سيتم إخفاء أي قسم غير محدد بالكامل لحماية الخصوصية ومنع الوصول غير المصرح به.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                  {[
                    { id: 'patients', label: isEn ? 'Patients' : 'سجل المرضى', icon: Users, color: 'text-cyan-500 bg-cyan-50' },
                    { id: 'calendar', label: isEn ? 'Calendar' : 'المواعيد والتقويم', icon: Calendar, color: 'text-emerald-500 bg-emerald-50' },
                    { id: 'prescriptions', label: isEn ? 'Prescriptions' : 'الروشتات الطبية', icon: FileText, color: 'text-purple-500 bg-purple-50' },
                    { id: 'laboratory', label: isEn ? 'Dental Lab' : 'المعامل والطلبات', icon: Beaker, color: 'text-indigo-500 bg-indigo-50' },
                    { id: 'financials', label: isEn ? 'Financials' : 'الحسابات والمدفوعات', icon: Receipt, color: 'text-amber-500 bg-amber-50' }
                  ].filter(tab => isFeatureAllowedForClinic(tab.id))
                  .map((tab) => {
                    const isChecked = selectedStaffTabs.includes(tab.id);
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          if (tab.id === 'financials') {
                            const subIds = ['financials_daily_closing', 'financials_closing_log', 'financials_reports', 'financials_patients_installments', 'financials_expenses'];
                            if (isChecked) {
                              setSelectedStaffTabs(prev => prev.filter(t => t !== tab.id && !subIds.includes(t)));
                            } else {
                              const allowedSubs = subIds.filter(id => isFeatureAllowedForClinic(id));
                              setSelectedStaffTabs(prev => [...prev, tab.id, ...allowedSubs.filter(id => !prev.includes(id))]);
                            }
                          } else {
                            if (isChecked) {
                              setSelectedStaffTabs(prev => prev.filter(t => t !== tab.id));
                            } else {
                              setSelectedStaffTabs(prev => [...prev, tab.id]);
                            }
                          }
                        }}
                        className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between h-[85px] relative group cursor-pointer ${
                          isChecked
                            ? 'bg-indigo-50/40 border-indigo-500/80 shadow-3xs ring-2 ring-indigo-500/10'
                            : 'bg-white border-slate-200 hover:bg-slate-50/70 hover:border-slate-300'
                        }`}
                      >
                        {/* Custom Checkbox Indicator */}
                        <div className="flex items-center justify-between w-full">
                          <span className={`p-1.5 rounded-lg ${tab.color}`}>
                            <TabIcon className="h-4 w-4" />
                          </span>
                          <span className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                            isChecked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
                          }`}>
                            {isChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                          </span>
                        </div>
                        <span className="text-[11px] font-extrabold text-slate-800 leading-none mt-1.5">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Sub-financials toggle options for Staff if financials is checked */}
                {selectedStaffTabs.includes('financials') && (
                  <div className="mt-3 p-4 bg-amber-50/40 rounded-2xl border border-dashed border-amber-200 text-right space-y-3 animate-fade-in" dir={isEn ? 'ltr' : 'rtl'}>
                    <h5 className="text-[11px] font-black text-amber-800 flex items-center justify-end gap-1.5">
                      <span>{isEn ? 'Select Financial Sub-Sections Allowed:' : 'تحديد الأقسام الفرعية للحسابات المسموح للسكرتارية بالوصول إليها:'}</span>
                    </h5>
                    <p className="text-[9px] text-slate-500 font-bold leading-relaxed">
                      {isEn ? 'Choose sub-sections in Financials allowed for this staff member.' : 'اختر أي أقسام فرعية داخل الحسابات مسموح لهذا الموظف رؤيتها وتعديلها. سيتم إخفاء الأقسام غير المحددة تماماً.'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { id: 'financials_daily_closing', label: isEn ? 'Daily Closing' : 'إقفال اليومية والوردية', desc: isEn ? 'Open/close shifts & drawer count' : 'فتح وإغلاق الورديات ومطابقة النقدية بالدرج' },
                        { id: 'financials_closing_log', label: isEn ? 'Closing Log Archive' : 'سجل الإقفال التاريخي', desc: isEn ? 'History of previous shifts' : 'الأرشيف الكامل للورديات والشيفتات السابقة' },
                        { id: 'financials_reports', label: isEn ? 'Reports & Revenue' : 'التقارير وتحليلات الإيرادات', desc: isEn ? 'Income charts & statistics' : 'مخططات نمو الدخل وإحصائيات المقبوضات' },
                        { id: 'financials_patients_installments', label: isEn ? 'Patient Installments' : 'المرضى والأقساط المستحقة', desc: isEn ? 'Track patient dues & installments' : 'متابعة وتأكيد سداد متبقيات المرضى والأقساط' },
                        { id: 'financials_expenses', label: isEn ? 'Expenses & Purchases' : 'المصروفات والبنود المقتطعة', desc: isEn ? 'Daily operating expenses' : 'مشتريات العيادة ومصاريف التشغيل اليومية' }
                      ].filter(subFeat => isFeatureAllowedForClinic(subFeat.id))
                      .map((subFeat) => {
                        const isSubChecked = selectedStaffTabs.includes(subFeat.id);

                        return (
                          <button
                            key={subFeat.id}
                            type="button"
                            onClick={() => {
                              setSelectedStaffTabs(prev =>
                                prev.includes(subFeat.id) ? prev.filter(x => x !== subFeat.id) : [...prev, subFeat.id]
                              );
                            }}
                            className={`p-2.5 rounded-xl border text-right transition-all flex items-center gap-2.5 relative cursor-pointer ${
                              isSubChecked
                                ? 'bg-white border-amber-500 shadow-3xs ring-2 ring-amber-500/10'
                                : 'bg-slate-50/50 border-slate-200 hover:bg-white'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-black text-slate-800">{subFeat.label}</div>
                              <div className="text-[9px] text-slate-400 font-semibold truncate leading-tight mt-0.5">{subFeat.desc}</div>
                            </div>
                            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                              isSubChecked ? 'bg-amber-600 border-amber-600 text-white' : 'border-slate-300 bg-white'
                            }`}>
                              {isSubChecked && <Check className="h-2 w-2 stroke-[3]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className={`flex-1 ${editingStaffId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white font-bold py-2.5 rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer`}
                >
                  {editingStaffId ? <Edit className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                  {editingStaffId ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? 'Save & Add Staff Member' : 'حفظ واعتماد الموظف الجديد')}
                </button>
                {editingStaffId && (
                  <button
                    type="button"
                    onClick={handleCancelEditStaff}
                    className="px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
                  >
                    {isEn ? 'Cancel' : 'إلغاء'}
                  </button>
                )}
              </div>
            </form>

            {/* Staff List */}
            <div className="space-y-3">
              <h3 className="text-xs font-extrabold text-slate-700 flex items-center justify-between">
                <span>{isEn ? `Registered Staff Members (${clinic.staffMembers?.length || 0})` : `قائمة موظفي العيادة المسجلين (${clinic.staffMembers?.length || 0})`}</span>
                <span className="text-[10px] text-slate-400 font-normal">{isEn ? 'Login: Clinic Email + Password' : 'تسجيل الدخول: إيميل العيادة + الباسورد المحدد'}</span>
              </h3>

              {!clinic.staffMembers || clinic.staffMembers.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-500">{isEn ? 'No staff members added yet' : 'لا يوجد موظفون مضافون حتى الآن'}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{isEn ? 'Add receptionists or assistants using the form above.' : 'أضف السكرتارية أو المساعدين من النموذج بالأعلى لتخصيص دخولهم'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200/80 font-black">
                      <tr>
                        <th className="py-3 px-4">{isEn ? 'Name' : 'الاسم'}</th>
                        <th className="py-3 px-4">{isEn ? 'Role' : 'الدور'}</th>
                        <th className="py-3 px-4">{isEn ? 'Allowed Tabs' : 'التبويبات المسموحة'}</th>
                        <th className="py-3 px-4">{isEn ? 'Password' : 'الباسورد المحدد'}</th>
                        <th className="py-3 px-4">{isEn ? 'Phone' : 'الهاتف'}</th>
                        <th className="py-3 px-4 text-center">{isEn ? 'Actions' : 'إجراءات'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                      {clinic.staffMembers.map((member) => (
                        <tr key={member.id} className={`hover:bg-slate-50/70 transition ${editingStaffId === member.id ? 'bg-amber-50/60' : ''}`}>
                          <td className="py-3 px-4 font-bold text-slate-900">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0"></span>
                              <span>{member.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                              {member.role}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1 max-w-[220px]">
                              {(() => {
                                const allowedFeatures = clinic.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];
                                const filteredTabs = (member.allowedTabs || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials']).filter(t => allowedFeatures.includes(t));
                                
                                if (filteredTabs.length === allowedFeatures.length) {
                                  return <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold">{isEn ? 'All (Full Access)' : 'الكل (كامل الصلاحيات)'}</span>;
                                } else if (filteredTabs.length === 0) {
                                  return <span className="text-[10px] bg-rose-50 text-rose-600 px-2 py-0.5 rounded font-bold">{isEn ? 'None' : 'لا يوجد'}</span>;
                                } else {
                                  return filteredTabs.map(tabId => {
                                    const name = tabId === 'patients' ? (isEn ? 'Patients' : 'سجل المرضى') :
                                                 tabId === 'calendar' ? (isEn ? 'Calendar' : 'مواعيد') :
                                                 tabId === 'prescriptions' ? (isEn ? 'Prescriptions' : 'روشتات') :
                                                 tabId === 'laboratory' ? (isEn ? 'Lab' : 'معامل') :
                                                 tabId === 'financials' ? (isEn ? 'Financials' : 'حسابات') : tabId;
                                    return (
                                      <span key={tabId} className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-extrabold">{name}</span>
                                    );
                                  });
                                }
                              })()}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="bg-slate-100 px-2.5 py-0.5 rounded text-indigo-950 font-bold">
                                {showStaffPasswords[member.id] ? member.password : '••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowStaffPasswords(prev => ({ ...prev, [member.id]: !prev[member.id] }))}
                                className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                                title={isEn ? 'Show/Hide Password' : 'إظهار / إخفاء كلمة المرور'}
                              >
                                {showStaffPasswords[member.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-500 font-mono text-[11px]" dir="ltr">{member.phone || '-'}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEditStaff(member)}
                                className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                                title={isEn ? 'Edit Staff Details' : 'تعديل بيانات الموظف'}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveStaffMember(member.id, member.name)}
                                className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                title={isEn ? 'Delete Staff' : 'حذف وإلغاء الصلاحية'}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Legacy General Staff PIN Accordion / Collapsible */}
            <div className="pt-4 border-t border-slate-100">
              <details className="group">
                <summary className="text-[11px] font-bold text-slate-400 cursor-pointer hover:text-slate-600 transition flex items-center gap-1">
                  <KeyRound className="h-3.5 w-3.5" />
                  {isEn ? 'Legacy Staff Backup PIN (4 digits)' : 'الرمز السري الاحتياطي القديم (PIN الموحد 4 أرقام)'}
                </summary>
                <form onSubmit={handleUpdateStaffPin} className="mt-3 flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200/60 max-w-sm">
                  <span className="text-[11px] text-slate-600 font-bold">{isEn ? 'Backup PIN:' : 'الرمز الاحتياطي:'}</span>
                  <input
                    type="text"
                    required
                    maxLength={4}
                    value={staffPinInput}
                    onChange={(e) => setStaffPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="1234"
                    className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-xs font-mono text-center font-bold"
                  />
                  <button
                    type="submit"
                    className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-3 py-1 rounded-lg text-[11px] transition cursor-pointer"
                  >
                    {isEn ? 'Update Legacy PIN' : 'تحديث الرمز القديم'}
                  </button>
                </form>
              </details>
            </div>
          </div>
        )}

        {/* 3. BACKUP TAB */}
        {settingsSubTab === 'backup' && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6 animate-fade-in">
            <div>
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <Database className="h-5 w-5 text-indigo-600" />
                {isEn ? 'Comprehensive Backup & Disaster Recovery' : 'النسخ الاحتياطي الشامل واستعادة البيانات (Backup & Disaster Recovery)'}
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {isEn 
                  ? 'Download a secure backup file containing all patient records, appointments, sessions, prescriptions, and financials. You can restore it anytime on any device.'
                  : 'قم بتحميل نسخة احتياطية آمنة (ملف JSON أو SQL أو CSV) تحتوي على كافة ملفات المرضى، المواعيد، الجلسات العلاجية، الروشتات، والماليات. يمكنك الاحتفاظ بهذا الملف واستعادته بضغطة زر في أي وقت أو على أي جهاز دون فقدان أي سجل.'}
              </p>
            </div>

            {backupRestoreStatus && (
              <div className="bg-indigo-50 border-r-4 border-indigo-500 p-3.5 rounded-2xl flex items-center gap-3 animate-fade-in">
                {(isBackingUp || isRestoring) ? (
                  <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <CheckCircle className="h-4 w-4 text-indigo-600 shrink-0" />
                )}
                <p className="text-xs font-bold text-indigo-950">{backupRestoreStatus}</p>
              </div>
            )}

            {/* Automated Daily Backup Section */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white p-5 rounded-2xl shadow-sm space-y-4 border border-slate-700">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700 pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-slate-700/80 rounded-xl border border-slate-600 text-slate-200 shrink-0">
                    <Clock className="h-5 w-5 text-slate-200" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white flex items-center gap-2">
                      {isEn ? 'Enable Daily Automatic Backup (12:00 Midnight)' : 'تفعيل النسخ الاحتياطي التلقائي اليومي (الساعة 12:00 منتصف الليل)'}
                    </h3>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      {isEn ? 'Automatic daily download of clinic data directly to device. Downloads automatically when online.' : 'تنزيل تلقائي لبيانات هذه العيادة فقط مباشرة على الجهاز يومياً. وفي حالة انقطاع الإنترنت، ينزل الملف فور العودة.'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  dir="ltr"
                  onClick={() => handleSaveAutoBackupSettings(!autoBackupEnabled, autoBackupFormat)}
                  className={`flex items-center h-7 w-12 shrink-0 cursor-pointer rounded-full p-1 transition-all duration-200 ease-in-out focus:outline-none self-start sm:self-center ${
                    autoBackupEnabled ? 'bg-emerald-500 justify-end' : 'bg-slate-600 justify-start'
                  }`}
                >
                  <span
                    className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0"
                  />
                </button>
              </div>

              <div className="space-y-3 pt-1">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <span className="font-bold text-slate-200">{isEn ? 'Select Daily Auto-Backup Format:' : 'اختر صيغة التنزيل اليومي التلقائي للعيادة:'}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleSaveAutoBackupSettings(autoBackupEnabled, 'zip')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer border ${
                        autoBackupFormat === 'zip'
                          ? 'bg-indigo-600 text-white border-indigo-400 shadow-2xs'
                          : 'bg-slate-900/60 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {isEn ? 'ZIP Archive (.zip) ⚡' : 'أرشيف مضغوط (.zip) ⚡'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveAutoBackupSettings(autoBackupEnabled, 'json')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer border ${
                        autoBackupFormat === 'json'
                          ? 'bg-slate-600 text-white border-slate-400 shadow-2xs'
                          : 'bg-slate-900/60 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {isEn ? 'JSON File (.json)' : 'ملف JSON (.json)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveAutoBackupSettings(autoBackupEnabled, 'db')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer border ${
                        autoBackupFormat === 'db'
                          ? 'bg-slate-600 text-white border-slate-400 shadow-2xs'
                          : 'bg-slate-900/60 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {isEn ? 'Database (.db)' : 'ملف قاعدة بيانات (.db)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveAutoBackupSettings(autoBackupEnabled, 'sql')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer border ${
                        autoBackupFormat === 'sql'
                          ? 'bg-slate-600 text-white border-slate-400 shadow-2xs'
                          : 'bg-slate-900/60 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {isEn ? 'SQL File (.sql)' : 'ملف استعلامات (.sql)'}
                    </button>
                  </div>
                </div>

                {autoBackupEnabled ? (
                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-700 flex items-center justify-between text-[11px] text-slate-200">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span>{isEn ? `Daily auto-backup schedule: Active at 12:00 Midnight (.${autoBackupFormat})` : `جدولة النسخ التلقائي: نشطة يومياً الساعة 12:00 منتصف الليل بصيغة (.${autoBackupFormat})`}</span>
                    </div>
                    <span className="font-mono text-slate-300 font-bold">{isEn ? 'Last run:' : 'آخر تنفيذ:'} {lastAutoBackupDate}</span>
                  </div>
                ) : (
                  <div className="p-2.5 bg-slate-950/40 rounded-xl border border-slate-800/60 text-[11px] text-slate-400">
                    {isEn ? `Daily auto-backup is disabled. Toggle above to enable (.${autoBackupFormat}).` : `النسخ الاحتياطي اليومي متوقف حالياً. يمكنك تفعيله بالسحب على المفتاح بالأعلى وستنزل النسخة بصيغة (.${autoBackupFormat}).`}
                  </div>
                )}
              </div>
            </div>

            {/* Format Selector */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 space-y-3 text-right">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                  {isEn ? 'ZIP format reduces size by 85%, ideal for large data' : 'خيار ZIP يقلل الحجم 85% ومثالي للبيانات الكبيرة'}
                </span>
                <label className="block text-xs font-black text-slate-700">{isEn ? 'Select Backup Format:' : 'اختر نوع النسخة الاحتياطية المطلوبة للعيادة:'}</label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => setExportFormat('zip')}
                  className={`p-3.5 rounded-xl border text-right transition flex items-center gap-3 cursor-pointer relative overflow-hidden ${
                    exportFormat === 'zip'
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs font-bold'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <FileArchive className={`h-5 w-5 shrink-0 ${exportFormat === 'zip' ? 'text-white' : 'text-indigo-600'}`} />
                  <div>
                    <div className="text-xs font-black flex items-center gap-1.5">
                      {isEn ? 'ZIP Archive (.zip)' : 'أرشيف مضغوط (.zip)'}
                      <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${exportFormat === 'zip' ? 'bg-indigo-500 text-white' : 'bg-emerald-100 text-emerald-700'}`}>{isEn ? 'Recommended' : 'موصى به'}</span>
                    </div>
                    <div className="text-[10px] opacity-80 mt-0.5">{isEn ? 'Ultra-fast compressed ZIP file saving 85% space' : 'ملف مضغوط فائق السرعة يوفر 85% من حجم البيانات الكبيرة'}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('json')}
                  className={`p-3.5 rounded-xl border text-right transition flex items-center gap-3 cursor-pointer ${
                    exportFormat === 'json'
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs font-bold'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <FileText className={`h-5 w-5 shrink-0 ${exportFormat === 'json' ? 'text-white' : 'text-indigo-600'}`} />
                  <div>
                    <div className="text-xs font-black">{isEn ? 'JSON File (.json)' : 'ملف JSON (.json)'}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">{isEn ? 'Readable object data file for easy transfer' : 'ملف بيانات كائني سهل القراءة والتحليل ونقل البيانات'}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('db')}
                  className={`p-3.5 rounded-xl border text-right transition flex items-center gap-3 cursor-pointer ${
                    exportFormat === 'db'
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs font-bold'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Database className={`h-5 w-5 shrink-0 ${exportFormat === 'db' ? 'text-white' : 'text-indigo-600'}`} />
                  <div>
                    <div className="text-xs font-black">{isEn ? 'Database File (.db)' : 'ملف قاعدة البيانات (.db)'}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">{isEn ? 'Comprehensive database file for full restore' : 'ملف شامل بكافة بيانات العيادة للاستعادة والتخزين'}</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('sql')}
                  className={`p-3.5 rounded-xl border text-right transition flex items-center gap-3 cursor-pointer ${
                    exportFormat === 'sql'
                      ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs font-bold'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <HardDrive className={`h-5 w-5 shrink-0 ${exportFormat === 'sql' ? 'text-white' : 'text-indigo-600'}`} />
                  <div>
                    <div className="text-xs font-black">{isEn ? 'SQL File (.sql)' : 'ملف استعلامات (.sql)'}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">{isEn ? 'ANSI SQL queries ready for database imports' : 'استعلامات ANSI SQL جاهزة للاستخدام في قواعد البيانات'}</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Actions buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Export Button */}
              <button
                type="button"
                onClick={() => handleExportBackup()}
                disabled={isBackingUp || isRestoring}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold p-4 rounded-2xl transition shadow-xs flex items-center justify-center gap-3 cursor-pointer border border-indigo-500/30"
              >
                <Download className="h-5 w-5 text-indigo-100 shrink-0" />
                <div className="text-right">
                  <div className="text-xs sm:text-sm font-black text-right">
                    {exportFormat === 'zip' && (isEn ? 'Download ZIP Archive (.zip)' : 'تنزيل نسخة مضغوطة (أرشيف .zip)')}
                    {exportFormat === 'json' && (isEn ? 'Download Clinic Backup (.json)' : 'تنزيل نسخة العيادة (ملف .json)')}
                    {exportFormat === 'db' && (isEn ? 'Download Clinic Database (.db)' : 'تنزيل نسخة العيادة (ملف .db)')}
                    {exportFormat === 'sql' && (isEn ? 'Download Clinic SQL (.sql)' : 'تنزيل استعلامات العيادة (ملف .sql)')}
                  </div>
                  <div className="text-[10px] text-indigo-200/80 font-normal mt-0.5 text-right">
                    {exportFormat === 'zip' && (isEn ? 'Export lightweight ZIP archive ideal for large datasets' : 'تصدير أرشيف ZIP مضغوط فائق الخفة ومثالي للأحجام الكبيرة')}
                    {exportFormat === 'json' && (isEn ? 'Export clinic data in a flexible JSON format' : 'تصدير بيانات العيادة في ملف JSON مرن وخاص بها')}
                    {exportFormat === 'db' && (isEn ? 'Export all clinic data in a secure .db file' : 'تصدير كافة بيانات العيادة في ملف .db آمن وخاص بها')}
                    {exportFormat === 'sql' && (isEn ? 'Export clinic data as SQL queries for database seeding' : 'تصدير بيانات العيادة كـ استعلامات SQL لبناء الجداول وحقن البيانات')}
                  </div>
                </div>
              </button>

              {/* Import / Restore Button */}
              <label className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold p-4 rounded-2xl transition shadow-xs flex items-center justify-center gap-3 cursor-pointer border border-emerald-500/30">
                <Upload className="h-5 w-5 text-emerald-100 shrink-0" />
                <div className="text-right">
                  <div className="text-xs sm:text-sm font-black text-right">{isEn ? 'Upload & Restore Backup' : 'رفع واستعادة نسخة احتياطية (Restore)'}</div>
                  <div className="text-[10px] text-emerald-200/80 font-normal mt-0.5 text-right">{isEn ? 'Restore clinic records from .zip, .json, .db or .sql file' : 'استرجاع سجلات العيادة من ملف .zip أو .json أو .db أو .sql'}</div>
                </div>
                <input
                  type="file"
                  accept=".zip,.json,.db,.sql,.txt"
                  disabled={isBackingUp || isRestoring}
                  onChange={handleImportBackup}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {/* 4. SUBSCRIPTION TAB */}
        {settingsSubTab === 'subscription' && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6 animate-fade-in">
            <div>
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <Receipt className="h-5 w-5 text-emerald-600" />
                {isEn ? 'Clinic Subscription Details' : 'تفاصيل اشتراك العيادة'}
              </h2>
              <p className="text-xs text-slate-500 mt-1 font-semibold">
                {isEn ? 'Track your platform subscription expiration date and payment status.' : 'تتبع تاريخ نهاية اشتراك العيادة بالمنصة وحالة الدفع الحالية.'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 p-5 bg-slate-50 rounded-2xl border border-slate-200/60 space-y-4">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-bold">{isEn ? 'Programmed Expiration Date:' : 'تاريخ انتهاء الاشتراك المبرمج:'}</span>
                  <span className="font-mono font-bold text-slate-800 bg-white px-3 py-1 rounded-lg border border-slate-200">
                    {formatDateTime(clinic.subscriptionExpiresAt)}
                  </span>
                </div>
                
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-bold">{isEn ? 'Subscription Status:' : 'الحالة القانونية للاشتراك:'}</span>
                  {isClinicExpired(clinic) ? (
                    <span className="bg-rose-50 text-rose-700 px-3 py-1 rounded-full font-bold border border-rose-200">{isEn ? 'Expired' : 'منتهي الصلاحية'}</span>
                  ) : (
                    <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-bold border border-emerald-200">{isEn ? 'Active & Valid' : 'نشط وصالح بالوقت الفعلي'}</span>
                  )}
                </div>
              </div>

              <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-5 rounded-2xl flex flex-col justify-between shadow-xs border border-slate-800">
                <div>
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase">{isEn ? 'Encrypted Data Protection' : 'حماية البيانات المشفرة'}</h4>
                  <p className="text-[10px] text-slate-300 mt-1 leading-relaxed text-right">
                    {isEn ? 'Clinic data and patient files are securely saved and protected with cloud encryption technology.' : 'بيانات العيادة وملفات المرضى محفوظة بشكل مستقل كلياً ومحمية بتقنيات التعمية السحابية على خوادم Turso المشفرة.'}
                  </p>
                </div>
                <div className="text-[9px] text-slate-400 mt-4 pt-2 border-t border-slate-800">
                  {isEn ? '* Subscription upgrade requires contacting platform technical support.' : '* ترقية الاشتراك تتطلب التواصل مع الدعم الفني للمنصة.'}
                </div>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 leading-relaxed pt-4 border-t border-slate-100 text-center">
              {isEn ? '* All activation & subscription processes are synced with Google Cloud clock to prevent local time tampering.' : '* جميع عمليات التنشيط والاشتراك مرتبطة بساعة جوجل السحابية لحمايتها من أي تلاعب في توقيت الأجهزة المحلية.'}
            </div>
          </div>
        )}

        {/* 5. PAYMENT METHODS MANAGEMENT TAB */}
        {settingsSubTab === 'payment_methods' && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6 animate-fade-in" dir={isEn ? 'ltr' : 'rtl'}>
            <div>
              <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-emerald-600" />
                {isEn ? 'Payment Methods Configuration' : 'تخصيص وإعداد طرق الدفع بالعيادة'}
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {isEn
                  ? 'Manage payment channels available for recording patient revenues and shift expenses. Changes reflect automatically across financial transactions.'
                  : 'تحكم في قنوات الدفع المتوفرة لتسجيل إيرادات المرضى ومصروفات الوردية المفتوحة. يمكنك إضافة أو حذف طرق الدفع وسوف تنعكس تلقائياً في كافة المعاملات المالية وإقفال اليوميات.'}
              </p>
            </div>

            {/* Reassignment / Migration Warn Dialog (Inlined beautifully) */}
            {reassignWarningMethod && (
              <div className="bg-rose-50 border-2 border-rose-200 p-5 rounded-2xl space-y-4 animate-fade-in">
                <div className="flex items-start gap-3">
                  <span className="p-2 bg-rose-100 rounded-xl text-rose-700 shrink-0">
                    <AlertCircle className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <h4 className="text-xs font-black text-rose-900">{isEn ? 'Required Action for Financial Record Integrity' : 'إجراء إجباري لسلامة الدفاتر المالية'}</h4>
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      {isEn ? (
                        <>Cannot delete payment method <span className="font-bold underline">({reassignWarningMethod})</span> because it has existing transactions. Select a target payment method to migrate past transactions to:</>
                      ) : (
                        <>لا يمكن حذف طريقة الدفع <span className="font-bold underline">({reassignWarningMethod})</span> مباشرة لأنها مُسجلة في معاملات سابقة بالعيادة. لإتمام الحذف دون التسبب في خلل محاسبي، يرجى اختيار طريقة دفع بديلة لترحيل كافة المدفوعات والمصروفات السابقة إليها:</>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-end bg-white p-4 rounded-xl border border-rose-100/50">
                  <div className="flex-1 space-y-1.5">
                    <label className="block text-[11px] font-black text-slate-700">{isEn ? 'Migrate past transactions to:' : 'ترحيل المعاملات السابقة إلى:'}</label>
                    <select
                      value={reassignTargetMethod}
                      onChange={(e) => setReassignTargetMethod(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 text-xs font-bold text-slate-800 bg-white"
                    >
                      {(clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة'])
                        .filter(m => m !== reassignWarningMethod)
                        .map((m, idx) => (
                          <option key={idx} value={m}>{m}</option>
                        ))}
                    </select>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleConfirmReassignAndDelete}
                      disabled={isCheckingPaymentUsage}
                      className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-extrabold px-4 py-2 rounded-xl text-xs transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      {isCheckingPaymentUsage ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      {isEn ? 'Migrate & Delete Now' : 'ترحيل البيانات والحذف الآن'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReassignWarningMethod(null);
                        setReassignTargetMethod('');
                      }}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-2 rounded-xl text-xs transition"
                    >
                      {isEn ? 'Cancel' : 'إلغاء الأمر'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Add Payment Method Form */}
            {!reassignWarningMethod && (
              <form onSubmit={handleAddPaymentMethod} className="bg-emerald-50/40 p-5 rounded-2xl border border-emerald-100/70 flex flex-col sm:flex-row gap-4 items-end animate-fade-in">
                <div className="flex-1 space-y-1.5">
                  <label className="block text-xs font-extrabold text-emerald-950">{isEn ? 'Add New Payment Method' : 'إضافة طريقة دفع جديدة لجميع المعاملات'}</label>
                  <input
                    type="text"
                    required
                    value={newPaymentMethodName}
                    onChange={(e) => setNewPaymentMethodName(e.target.value)}
                    placeholder={isEn ? 'e.g. Vodafone Cash, Bank Transfer, Tabby...' : 'مثال: فودافون كاش، بنك مصر، تابي، إلخ...'}
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-xs font-bold text-slate-800"
                  />
                </div>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-5 py-2.5 rounded-xl text-xs transition shadow-xs flex items-center gap-1.5 cursor-pointer h-10"
                >
                  <Plus className="h-4 w-4" />
                  {isEn ? 'Add Payment Method' : 'إضافة طريقة الدفع'}
                </button>
              </form>
            )}

            {/* Payment Methods List */}
            <div className="space-y-3">
              <h3 className="text-xs font-black text-slate-700 flex items-center justify-between border-b border-slate-100 pb-2">
                <span>{isEn ? `Active Payment Methods (${(clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة']).length})` : `طرق الدفع النشطة حالياً بالعيادة (${ (clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة']).length })`}</span>
                {isCheckingPaymentUsage && (
                  <span className="text-[10px] text-slate-400 font-normal flex items-center gap-1">
                    <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    {isEn ? 'Checking background usage...' : 'جاري فحص حالة الاستخدام بالخلفية...'}
                  </span>
                )}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(clinic.paymentMethods || ['كاش', 'فيزا', 'إنستاباي', 'محفظة']).map((method, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-50 hover:bg-slate-100/80 p-4 rounded-2xl border border-slate-150 flex items-center justify-between gap-3 transition-all animate-fade-in"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-xl bg-white border border-slate-200/60 flex items-center justify-center font-bold text-sm text-slate-600 shadow-3xs">
                        💳
                      </span>
                      <div>
                        <div className="text-xs font-black text-slate-800">{method}</div>
                        <div className="text-[9.5px] text-slate-400 font-semibold mt-0.5">{isEn ? 'Approved Clinic Payment Method' : 'طريقة دفع معتمدة بالعيادة'}</div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeletePaymentMethodCheck(method)}
                      disabled={isCheckingPaymentUsage || !!reassignWarningMethod}
                      className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0 cursor-pointer disabled:opacity-40"
                      title={isEn ? 'Delete Payment Method' : 'حذف طريقة الدفع'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Note */}
            <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-150 text-right space-y-1">
              <p className="text-[10px] text-slate-500 font-bold flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-indigo-500" />
                {isEn ? 'Financial Security Notice:' : 'تنبيه أمان وحماية البيانات المالية:'}
              </p>
              <p className="text-[9.5px] text-slate-400 leading-relaxed font-semibold">
                {isEn
                  ? 'Default payment channels (Cash, Visa, Instapay, Wallet) are provided by default. Deleting a payment method automatically updates historical data to maintain financial integrity.'
                  : 'طرق الدفع الأربعة الأساسية (كاش، فيزا، إنستاباي، محفظة) يتم توريدها افتراضياً في حالة عدم تحديد قنوات مخصصة. عند حذفك لأي طريقة دفع، يتم مطابقة جميع البيانات وتعديلها محلياً وسحابياً لضمان تطابق الأرباح والدرج بالكامل مع تصفية الورديات.'}
              </p>
            </div>
          </div>
        )}

        {/* Technical Support Tab Content */}
        {settingsSubTab === 'tech_support' && (
          <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-8 animate-fade-in" dir={isEn ? 'ltr' : 'rtl'}>
            
            {/* Main Title & Clinic Info Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0 shadow-3xs">
                  <Headphones className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900">{isEn ? 'Technical Support & Direct Contact' : 'قسم الدعم الفني والتواصل المباشر'}</h2>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    {isEn ? 'Contact our technical support team instantly via WhatsApp with clinic details.' : 'تواصل فورياً مع فريق الدعم الفني عبر الواتساب مع تضمين كامل بيانات العيادة بضغطة زر.'}
                  </p>
                </div>
              </div>

              {/* Clinic Metadata Quick Card */}
              <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-xs font-black text-slate-900">{clinic.nameAr || clinic.name}</div>
                  <div className="text-[10px] font-bold text-slate-500">{isEn ? 'Doctor:' : 'الطبيب:'} {clinic.doctorName || clinic.doctorNameEn || (isEn ? 'Not specified' : 'غير محدد')}</div>
                  <div className="text-[10px] font-mono text-emerald-700 font-bold dir-ltr mt-0.5">ID: {clinic.id}</div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyClinicId}
                  className="bg-white hover:bg-slate-100 border border-slate-200 p-2 rounded-xl transition text-slate-600 cursor-pointer flex items-center gap-1 text-[10px] font-bold shrink-0"
                  title={isEn ? 'Copy Clinic ID' : 'نسخ كود العيادة'}
                >
                  {copiedClinicId ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedClinicId ? (isEn ? 'Copied' : 'تم النسخ') : (isEn ? 'Copy ID' : 'نسخ ID')}</span>
                </button>
              </div>
            </div>

            {/* Trial Phone Number Configuration Card */}
            <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 border border-emerald-200/90 rounded-2xl p-5 space-y-3 shadow-3xs">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Gift className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">{isEn ? 'WhatsApp Phone for Free 7-Day Trial Requests' : 'رقم الواتساب لطلب النسخة التجريبية (7 أيام مجاناً)'}</h3>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    {isEn ? 'The phone number visitors contact when requesting a 7-day trial on the login page.' : 'الرقم الذي يتواصل معه الزائر عند الضغط على زر "اطلب نسختك المجانية لمدة 7 أيام مجاناً" بصفحة تسجيل الدخول.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
                <div className="relative flex-1 w-full">
                  <input
                    type="tel"
                    maxLength={11}
                    inputMode="numeric"
                    value={trialPhoneInput}
                    onChange={(e) => setTrialPhoneInput(formatEgyptianPhoneInput(e.target.value))}
                    placeholder="01012345678"
                    className="w-full pl-4 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                    dir="ltr"
                  />
                  <Phone className="absolute right-3.5 top-3 h-4 w-4 text-emerald-600" />
                </div>

                <button
                  type="button"
                  onClick={handleSaveTrialPhone}
                  disabled={savingTrialPhone}
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                  {savingTrialPhone ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span>{isEn ? 'Save Number' : 'حفظ الرقم'}</span>
                </button>
              </div>
            </div>

            {/* Support Phone Numbers List */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <PhoneCall className="h-5 w-5 text-emerald-600 shrink-0" />
                <h3 className="text-sm font-black text-slate-900">{isEn ? 'Contact Numbers & Quick Guidance (WhatsApp)' : 'أرقام التواصل والتوجيه السريع (WhatsApp)'}</h3>
              </div>

              {loadingSupportSettings ? (
                <div className="text-center py-10 text-slate-400 text-xs font-bold animate-pulse">
                  {isEn ? 'Loading approved technical support numbers...' : 'جاري تحميل أرقام الدعم الفني المعتمدة...'}
                </div>
              ) : supportSettings.phoneNumbers.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 rounded-2xl text-slate-500 text-xs font-bold border border-slate-200">
                  {isEn ? 'No support phone numbers registered currently.' : 'لا توجد أرقام دعم فني مسجلة بالسيستم حالياً.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {supportSettings.phoneNumbers.map((num, idx) => (
                    <div
                      key={num.id || idx}
                      className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200/90 rounded-2xl p-5 space-y-4 transition-all shadow-3xs flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                            {num.title}
                          </span>
                          
                          {num.availableHours && (
                            <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200/80 px-2 py-0.5 rounded-md shrink-0">
                              {num.availableHours}
                            </span>
                          )}
                        </div>

                        <div className="text-base font-black text-slate-800 font-mono tracking-wider dir-ltr text-right">
                          {num.phone}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-200/70">
                        {/* WhatsApp Direct Button */}
                        <button
                          type="button"
                          onClick={() => handleOpenWhatsApp(num.phone)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <MessageSquare className="h-4 w-4" />
                          <span>{isEn ? 'Contact via WhatsApp' : 'تواصل عبر الواتساب مباشر'}</span>
                        </button>

                        {/* Direct Call Button */}
                        <a
                          href={`tel:${num.phone}`}
                          className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold p-2.5 rounded-xl text-xs transition flex items-center justify-center shrink-0"
                          title={isEn ? 'Call Support' : 'إجراء اتصال هاتفي'}
                        >
                          <Phone className="h-4 w-4 text-slate-600" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Social Media & Official Channels */}
            {supportSettings.socialLinks.length > 0 && (
              <div className="space-y-4 pt-6 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-indigo-600 shrink-0" />
                  <h3 className="text-sm font-black text-slate-900">{isEn ? 'Social Media & Official Channels' : 'وسائل التواصل الاجتماعي والمنصات المعتمدة'}</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {supportSettings.socialLinks.map((soc, idx) => (
                    <a
                      key={soc.id || idx}
                      href={soc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-slate-50 hover:bg-indigo-50/50 hover:border-indigo-200 border border-slate-200/90 p-4 rounded-2xl flex items-center justify-between gap-3 transition-all group cursor-pointer shadow-3xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-white border border-slate-200/80 rounded-xl flex items-center justify-center shrink-0 shadow-3xs group-hover:scale-105 transition-transform">
                          {renderSocialIcon(soc.platform)}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-black text-slate-800 truncate group-hover:text-indigo-900">{soc.title}</div>
                          <div className="text-[10px] text-slate-400 font-medium truncate dir-ltr text-right mt-0.5">{soc.url}</div>
                        </div>
                      </div>

                      <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Working Hours Notice Banner */}
            {supportSettings.workingHoursNotice && (
              <div className="bg-emerald-50/60 border border-emerald-200/80 p-4 rounded-2xl text-emerald-950 text-xs font-bold leading-relaxed flex items-start gap-2">
                <Info className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-black text-emerald-900 block mb-0.5">{isEn ? 'Customer Service Hours Notice:' : 'تنويه مواعيد خدمة العملاء:'}</span>
                  <span className="text-slate-700 font-medium">{supportSettings.workingHoursNotice}</span>
                </div>
              </div>
            )}

          </div>
        )}

        {/* Loyalty Program Settings Panel */}
        {settingsSubTab === 'loyalty_program' && (
          <div className="space-y-5" dir={isEn ? 'ltr' : 'rtl'}>
            {/* Loyalty View Mode Header Switcher */}
            <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 bg-slate-100/80 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setShowRedemptionsLog(false)}
                  className={`px-4 py-2 rounded-lg text-xs font-black transition flex items-center gap-2 cursor-pointer ${
                    !showRedemptionsLog
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Gift className="h-4 w-4" />
                  <span>{isEn ? 'Loyalty Program Rules' : 'قواعد وإعدادات نظام الولاء'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowRedemptionsLog(true);
                    if (redemptionLogs.length === 0) {
                      fetchLoyaltyRedemptions();
                    }
                  }}
                  className={`px-4 py-2 rounded-lg text-xs font-black transition flex items-center gap-2 cursor-pointer ${
                    showRedemptionsLog
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Receipt className="h-4 w-4" />
                  <span>{isEn ? 'Points Redemption Log' : 'سجل الخصومات واستبدال النقاط'}</span>
                  {redemptionLogs.length > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-black ${
                      showRedemptionsLog ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-900'
                    }`}>
                      {redemptionLogs.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Loyalty Enable/Disable Switch */}
              <label className="relative inline-flex items-center cursor-pointer select-none px-2 self-end sm:self-auto gap-2.5">
                <input
                  type="checkbox"
                  checked={loyaltyEnabledInput}
                  onChange={(e) => setLoyaltyEnabledInput(e.target.checked)}
                  className="sr-only"
                />
                <div
                  dir="ltr"
                  onClick={() => setLoyaltyEnabledInput(!loyaltyEnabledInput)}
                  className={`flex items-center h-7 w-12 shrink-0 cursor-pointer rounded-full p-1 transition-all duration-200 ease-in-out ${
                    loyaltyEnabledInput ? 'bg-amber-500 justify-end' : 'bg-slate-300 justify-start'
                  }`}
                >
                  <span
                    className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0"
                  />
                </div>
                <span className="text-xs font-black text-slate-800">
                  {loyaltyEnabledInput ? (isEn ? 'Loyalty Program Enabled' : 'تفعيل نظام الولاء') : (isEn ? 'Loyalty Program Disabled' : 'تعطيل نظام الولاء')}
                </span>
              </label>
            </div>

            {/* View 1: Rules & Settings Form */}
            {!showRedemptionsLog ? (
              <form onSubmit={handleSaveLoyaltySettings} className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs space-y-6 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-amber-500 text-white rounded-2xl shadow-xs">
                      <Gift className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900">{isEn ? 'Patient Loyalty Program & Rewards' : 'نظام ولاء المرضى ومكافآت النقاط'}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{isEn ? 'Configure rules for earning and redeeming patient loyalty points on payments.' : 'قم بضبط قواعد كسب واستبدال نقاط الولاء التلقائية للمرضى عند سداد المدفوعات.'}</p>
                    </div>
                  </div>
                </div>

                {/* Rules Grid */}
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 transition-opacity ${loyaltyEnabledInput ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                  
                  {/* Earn Rule Box */}
                  <div className="bg-amber-50/50 p-5 rounded-2xl border border-amber-200/80 space-y-4">
                    <div className="flex items-center gap-2 text-amber-900 font-black text-xs">
                      <Sparkles className="h-4 w-4 text-amber-600" />
                      <h4>{isEn ? 'Points Earning Rules:' : 'قوانين تجميع واكتساب النقاط:'}</h4>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-extrabold text-slate-700 mb-1">{isEn ? 'For every payment amount of (EGP):' : 'لكل مبلغ مدفوع بقيمة (جنيه مصري):'}</label>
                        <input
                          type="number"
                          min="1"
                          value={loyaltyEarnEgpThresholdInput}
                          onChange={(e) => setLoyaltyEarnEgpThresholdInput(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold font-mono bg-white focus:ring-2 focus:ring-amber-500"
                          placeholder="100"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-extrabold text-slate-700 mb-1">{isEn ? 'Patient earns points:' : 'يكتسب المريض في حسابه عدد نقاط:'}</label>
                        <input
                          type="number"
                          min="0"
                          value={loyaltyEarnPointsInput}
                          onChange={(e) => setLoyaltyEarnPointsInput(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold font-mono bg-white focus:ring-2 focus:ring-amber-500"
                          placeholder="20"
                        />
                      </div>

                      <p className="text-[11px] text-amber-900/80 font-semibold bg-amber-100/60 p-2.5 rounded-xl">
                        {isEn ? (
                          <>💡 <strong>Example:</strong> For every payment of <strong className="font-mono">{loyaltyEarnEgpThresholdInput} EGP</strong>, the patient automatically earns <strong className="font-mono">{loyaltyEarnPointsInput} points</strong>.</>
                        ) : (
                          <>💡 <strong>مثال توضيحي:</strong> كل سداد بقيمة <strong className="font-mono">{loyaltyEarnEgpThresholdInput} ج.م</strong> سيكسب المريض مقابلها تلقائياً <strong className="font-mono">{loyaltyEarnPointsInput} نقطة</strong> في رصيده عند تحصيل القسط.</>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Redeem Rule Box */}
                  <div className="bg-emerald-50/50 p-5 rounded-2xl border border-emerald-200/80 space-y-4">
                    <div className="flex items-center gap-2 text-emerald-900 font-black text-xs">
                      <Gift className="h-4 w-4 text-emerald-600" />
                      <h4>{isEn ? 'Points Redemption & Discount Rules:' : 'قوانين استبدال النقاط بالخصم:'}</h4>
                    </div>

                    <div className="space-y-4">
                      {/* Rate Definition */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-3.5 rounded-xl border border-emerald-100">
                        <div>
                          <label className="block text-xs font-extrabold text-slate-700 mb-1">{isEn ? 'Points Rate (Number of Points):' : 'معدل النقاط (عدد النقاط):'}</label>
                          <input
                            type="number"
                            min="1"
                            value={loyaltyRedeemPointsThresholdInput}
                            onChange={(e) => setLoyaltyRedeemPointsThresholdInput(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold font-mono bg-white focus:ring-2 focus:ring-emerald-500"
                            placeholder="1000"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-extrabold text-slate-700 mb-1">{isEn ? 'Equals Discount of (EGP):' : 'تعادل خصم بقيمة (جنيه مصري):'}</label>
                          <input
                            type="number"
                            min="0"
                            value={loyaltyRedeemDiscountEgpInput}
                            onChange={(e) => setLoyaltyRedeemDiscountEgpInput(e.target.value === '' ? '' : Number(e.target.value))}
                            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold font-mono bg-white focus:ring-2 focus:ring-emerald-500"
                            placeholder="250"
                          />
                        </div>
                      </div>

                      {/* Minimum Threshold Input */}
                      <div className="bg-white p-3.5 rounded-xl border border-emerald-100 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-extrabold text-slate-800">
                            {isEn ? 'Minimum Redemption Threshold (Points):' : 'الحد الأدنى للاستبدال (عدد النقاط):'}
                          </label>
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                            {isEn ? '(Optional: Leave blank for no minimum)' : '(مكاني: اتركه فارغاً لاستبدال أي كمية)'}
                          </span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          value={loyaltyMinRedeemPointsInput}
                          onChange={(e) => setLoyaltyMinRedeemPointsInput(e.target.value === '' ? '' : Number(e.target.value))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold font-mono bg-white focus:ring-2 focus:ring-emerald-500"
                          placeholder={isEn ? 'e.g. 500 (or leave empty)' : 'مثال: 500 (أو اتركه فارغاً لأي كمية نقاط)'}
                        />
                      </div>

                      {/* Informative Explanation */}
                      <p className="text-[11px] text-emerald-900/90 font-semibold bg-emerald-100/60 p-3 rounded-xl space-y-1">
                        <span>🎁 <strong>{isEn ? 'Conversion Rate:' : 'معدل تحويل النقاط:'}</strong> {isEn ? `Every ${loyaltyRedeemPointsThresholdInput || 1000} points equals ${loyaltyRedeemDiscountEgpInput || 250} EGP discount.` : `كل ${loyaltyRedeemPointsThresholdInput || 1000} نقطة تعادل خصم ${loyaltyRedeemDiscountEgpInput || 250} ج.م.`}</span>
                        <br />
                        {loyaltyMinRedeemPointsInput !== '' && Number(loyaltyMinRedeemPointsInput) > 0 ? (
                          <span>🔒 <strong>{isEn ? 'Minimum Threshold:' : 'الحد الأدنى للاستبدال:'}</strong> {isEn ? `Requires patient to reach at least ${loyaltyMinRedeemPointsInput} points.` : `يلزِم وصول المريض لـ ${loyaltyMinRedeemPointsInput} نقطة على الأقل.`}</span>
                        ) : (
                          <span>⚡ <strong>{isEn ? 'Open Redemption:' : 'الاستبدال المفتوح:'}</strong> {isEn ? 'Patients can redeem any points balance with no minimum requirement!' : 'يمكن للمريض استبدال أي كمية نقاط متوفرة لديه بدون أي حد أدنى!'}</span>
                        )}
                      </p>
                    </div>
                  </div>

                </div>

                {/* Save Action */}
                <div className="flex justify-end pt-4 border-t border-slate-100">
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-extrabold text-xs rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer"
                  >
                    <Save className="h-4 w-4" />
                    <span>{isEn ? 'Save Loyalty Program Settings' : 'حفظ إعدادات برنامج الولاء'}</span>
                  </button>
                </div>
              </form>
            ) : (
              /* View 2: Loyalty Redemptions & Discounts Log Section (IN PLACE) */
              <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs space-y-5 animate-fadeIn">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-amber-500 text-white rounded-2xl shadow-xs">
                      <Receipt className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                        <span>{isEn ? 'Loyalty Points Redemption & Discount Log' : 'سجل الخصومات واستبدال نقاط الولاء'}</span>
                        <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-full text-xs font-mono font-black">
                          {filteredRedemptionLogs.length} {isEn ? 'records' : 'عملية'}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {isEn ? 'Detailed log of all discounts granted to patients when redeeming loyalty points.' : 'كشف تفصيلي بجميع الخصومات الممنوحة للمرضى عند تسوية نقاط الولاء (مفصولة بالكامل عن الخزينة المالية والحسابات النقدية).'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={fetchLoyaltyRedemptions}
                    disabled={isLoadingRedemptions}
                    className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-xl text-xs font-black transition flex items-center gap-2 border border-amber-200 self-start sm:self-auto cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingRedemptions ? 'animate-spin text-amber-600' : ''}`} />
                    <span>{isEn ? 'Refresh Log' : 'تحديث السجل'}</span>
                  </button>
                </div>

                {/* KPI Stat Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200/80 flex items-center gap-3">
                    <div className="p-3 bg-amber-500 text-white rounded-xl shadow-xs">
                      <Gift className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-extrabold text-amber-900">{isEn ? 'Total Discounts Granted' : 'إجمالي الخصومات الممنوحة'}</p>
                      <p className="text-lg font-black font-mono text-amber-950 mt-0.5">
                        {totalDiscountGranted.toLocaleString()} <span className="text-xs font-sans">{isEn ? 'EGP' : 'ج.م'}</span>
                      </p>
                    </div>
                  </div>

                  <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200/80 flex items-center gap-3">
                    <div className="p-3 bg-emerald-600 text-white rounded-xl shadow-xs">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-extrabold text-emerald-900">{isEn ? 'Redemption Count' : 'عدد عمليات الخصم'}</p>
                      <p className="text-lg font-black font-mono text-emerald-950 mt-0.5">
                        {filteredRedemptionLogs.length} <span className="text-xs font-sans">{isEn ? 'operations' : 'عملية'}</span>
                      </p>
                    </div>
                  </div>

                  <div className="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200/80 flex items-center gap-3">
                    <div className="p-3 bg-indigo-600 text-white rounded-xl shadow-xs">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-extrabold text-indigo-900">{isEn ? 'Beneficiary Patients' : 'المرضى المستفيدون'}</p>
                      <p className="text-lg font-black font-mono text-indigo-950 mt-0.5">
                        {uniquePatientsCount} <span className="text-xs font-sans">{isEn ? 'patients' : 'مريض'}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Period Filter Tabs & Search Bar */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                  {/* Period Filter Buttons */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                    <span className="text-xs font-bold text-slate-500 flex items-center gap-1 ml-1">
                      <Filter className="h-3.5 w-3.5 text-amber-600" />
                      {isEn ? 'Period:' : 'الفترة:'}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setRedemptionPeriodFilter('all'); setRedemptionVisibleCount(5); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer whitespace-nowrap ${
                        redemptionPeriodFilter === 'all'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-200/60 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {isEn ? 'All' : 'الكل'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRedemptionPeriodFilter('day'); setRedemptionVisibleCount(5); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer whitespace-nowrap ${
                        redemptionPeriodFilter === 'day'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-200/60 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {isEn ? 'Daily (Today)' : 'يومي (اليوم)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRedemptionPeriodFilter('week'); setRedemptionVisibleCount(5); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer whitespace-nowrap ${
                        redemptionPeriodFilter === 'week'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-200/60 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {isEn ? 'Weekly (Last 7 Days)' : 'أسبوعي (آخر ٧ أيام)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRedemptionPeriodFilter('month'); setRedemptionVisibleCount(5); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer whitespace-nowrap ${
                        redemptionPeriodFilter === 'month'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-200/60 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {isEn ? 'Monthly (This Month)' : 'شهري (هذا الشهر)'}
                    </button>
                  </div>

                  {/* Search Bar */}
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      value={redemptionSearchTerm}
                      onChange={(e) => { setRedemptionSearchTerm(e.target.value); setRedemptionVisibleCount(5); }}
                      placeholder={isEn ? 'Search patient name, phone, or discount...' : 'ابحث باسم المريض، الهاتف، أو الخصم...'}
                      className="w-full pr-9 pl-3 py-1.5 border border-slate-200 bg-white rounded-lg text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Table or Empty State */}
                {isLoadingRedemptions ? (
                  <div className="py-12 text-center space-y-2">
                    <RefreshCw className="h-6 w-6 text-amber-500 animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-bold">{isEn ? 'Loading loyalty redemption log...' : 'جاري تحميل سجل استبدال النقاط والخصومات...'}</p>
                  </div>
                ) : filteredRedemptionLogs.length === 0 ? (
                  <div className="py-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-6 space-y-2">
                    <div className="p-3 bg-amber-100 text-amber-700 rounded-full w-fit mx-auto">
                      <Gift className="h-6 w-6" />
                    </div>
                    <p className="text-xs font-bold text-slate-700">{isEn ? 'No point redemption records match the filter' : 'لا توجد عمليات استبدال نقاط تطابق البحث أو الفترة المحددة'}</p>
                    <p className="text-[11px] text-slate-500 max-w-md mx-auto">
                      {isEn
                        ? 'When a patient pays using loyalty points, the granted discount value is automatically logged here.'
                        : 'عند سداد المريض لأي قسط أو جلسة باستخدام رصيد نقاط الولاء، يتم تسجيل قيمة الخصم الممنوح تلقائياً في هذا السجل.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-xl border border-slate-200 shadow-2xs">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                          <tr>
                            <th className="p-3 bg-slate-100">{isEn ? 'Patient' : 'المريض'}</th>
                            <th className="p-3 bg-slate-100">{isEn ? 'Redemption Date' : 'تاريخ الخصم'}</th>
                            <th className="p-3 bg-slate-100">{isEn ? 'Service / Clinic' : 'الجلسة / العيادة'}</th>
                            <th className="p-3 bg-slate-100">{isEn ? 'Discount Value' : 'قيمة الخصم'}</th>
                            <th className="p-3 bg-slate-100">{isEn ? 'Notes & Record' : 'ملاحظات وسجل العملية'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-800 bg-white">
                          {displayedRedemptionLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-amber-50/40 transition">
                              <td className="p-3 font-black text-slate-900">
                                <div className="flex flex-col">
                                  <span>{log.patientName}</span>
                                  {log.patientPhone && log.patientPhone !== '-' && (
                                    <span className="text-[10px] text-slate-500 font-mono">{log.patientPhone}</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3 font-mono font-bold text-slate-600">
                                {log.date}
                              </td>
                              <td className="p-3 text-slate-700">
                                <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-bold">
                                  {log.serviceName}
                                </span>
                              </td>
                              <td className="p-3 font-mono font-bold text-emerald-700">
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs">
                                  🎁 -{log.amount.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-500 text-[11px]">
                                {log.notes}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Show More Pagination Button */}
                    {filteredRedemptionLogs.length > redemptionVisibleCount && (
                      <div className="flex flex-col items-center justify-center pt-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setRedemptionVisibleCount(prev => prev + 5)}
                          className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl text-xs font-extrabold shadow-sm hover:shadow-md transition flex items-center gap-2 cursor-pointer"
                        >
                          <ChevronDown className="h-4 w-4" />
                          <span>{isEn ? 'Show More (+5)' : 'إظهار المزيد (+٥)'}</span>
                        </button>
                        <span className="text-[11px] text-slate-500 font-bold">
                          {isEn ? `Showing ${displayedRedemptionLogs.length} of ${filteredRedemptionLogs.length} records` : `تم عرض ${displayedRedemptionLogs.length} من أصل ${filteredRedemptionLogs.length} عملية`}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}


      </div>

    </div>
  );
}
