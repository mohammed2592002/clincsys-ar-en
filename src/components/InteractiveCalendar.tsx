import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppointmentsRef, getPatientsRef, getPatientRecordsRef, OperationType, handleDbError, cleanDbData, getDocsSmart as getDocs, getDocSmart as getDoc, collection, addDoc, updateDoc, setDoc, deleteDoc, doc, query, where, orderBy, limit, getAppointmentsCounts } from '../dbClient';
import { Patient, Clinic, Appointment, DEFAULT_QUESTIONNAIRE_QUESTIONS, PatientQuestionnaire } from '../types';
import { Calendar as CalendarIcon, Clock, Plus, User, FileText, CheckCircle, XCircle, AlertCircle, RefreshCw, Send, ChevronRight, ChevronLeft, ChevronDown, Coins, Sparkles, CalendarPlus, Stethoscope, Phone, Search, Building2, MapPin, Globe, Heart, Pencil, Save, X, Eye, EyeOff, Ticket } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDialogs } from './DialogContext';
import PatientFinancialsModal, { getAppointmentPayments, normalizePaymentMethod } from './PatientFinancialsModal';
import PatientSearchSelect from './PatientSearchSelect';
import { SearchableSelect } from './SearchableSelect';
import { EGYPT_GOVERNORATES, translateGovernorate, translateCenter, formatLocationDisplayName } from '../data/egyptLocations';
import { resolveProcedureBreakdown, cleanNotes } from '../utils';
import { getEgyptTodayStr, checkSubscriptionBlocked, normalizeDateStr } from '../utils/timeUtils';
import { ToothBadge } from './ToothBadge';
import { safeStorage } from '../utils/storage';
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from '../utils/phoneUtils';
import { isAppointmentTimeConflict } from '../utils/appointmentUtils';


export function formatTimeTo12Hour(timeStr: string, isEn: boolean = false): string {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let hour = parseInt(parts[0], 10);
  const min = parts[1];
  if (isNaN(hour)) return timeStr;
  
  const ampm = hour >= 12 ? (isEn ? 'PM' : 'م') : (isEn ? 'AM' : 'ص');
  hour = hour % 12;
  hour = hour ? hour : 12; // 0 becomes 12
  
  return `${hour}:${min} ${ampm}`;
}

export function parse24To12(time24: string) {
  if (!time24) return { hour12: 10, minute: '00', period: 'ص' };
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  if (isNaN(h)) h = 10;
  const m = mStr || '00';
  const period = h >= 12 ? 'م' : 'ص';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute: m, period };
}

export function to24Hour(hour12: number, minute: string, period: string): string {
  let h = hour12;
  if ((period === 'م' || period === 'PM') && h < 12) h += 12;
  if ((period === 'ص' || period === 'AM') && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${minute}`;
}

export const formatPaymentMethodName = (method: string, isEn: boolean = false): string => {
  if (!isEn || !method) return method;
  const m = method.toLowerCase().trim();
  if (m.includes('كاش') || m.includes('cash')) return 'Cash';
  if (m.includes('فيزا') || m.includes('visa') || m.includes('card')) return 'Card / Visa';
  if (m.includes('إنستاباي') || m.includes('انستاباي') || m.includes('instapay')) return 'InstaPay';
  if (m.includes('فودافون') || m.includes('محفظة') || m.includes('wallet')) return 'Vodafone Cash / Wallet';
  if (m.includes('بنك') || m.includes('تحويل') || m.includes('bank')) return 'Bank Transfer';
  if (m.includes('شيك') || m.includes('cheque')) return 'Cheque';
  if (m.includes('ولاء') || m.includes('loyalty')) return 'Loyalty Points';
  return method;
};

export const formatProcedureName = (name: string, isEn: boolean = false): string => {
  if (!isEn || !name) return name;
  const trimmed = name.trim();
  if (trimmed === 'كشف جديد') return 'New Consultation';
  if (trimmed === 'استكمال جلسات') return 'Follow-up Session';
  if (trimmed === 'خلع عادي') return 'Simple Extraction';
  if (trimmed === 'خلع جراحي') return 'Surgical Extraction';
  if (trimmed === 'تنظيف جير وتلميع') return 'Scaling & Polishing';
  if (trimmed === 'حشو تجميلي ليزر') return 'Composite Laser Filling';
  if (trimmed === 'حشو عصب وجذور' || trimmed === 'علاج جذور وعصب') return 'Root Canal Treatment';
  if (trimmed === 'تركيبات وزركون') return 'Crown & Zirconia';
  if (trimmed === 'تبييض أسنان') return 'Teeth Whitening';
  if (trimmed === 'أشعة أسنان') return 'Dental X-Ray';
  if (trimmed === 'تقويم أسنان') return 'Orthodontics';
  if (trimmed === 'زراعة أسنان') return 'Dental Implant';
  if (trimmed === 'طربوش / تاج') return 'Crown / Cap';
  if (trimmed === 'حشو بلاتين') return 'Amalgam Filling';
  if (trimmed === 'حشو زجاجي') return 'Glass Ionomer Filling';
  return name;
};

interface InteractiveCalendarProps {
  clinic: Clinic;
  isStaff?: boolean;
  onOpenMedicalFile?: (patientId: string) => void;
  onOpenPatientFinancials?: (patientId: string) => void;
  sharedAppointments?: Appointment[];
  onRefreshAppointments?: (silent?: boolean, date?: string, force?: boolean) => Promise<void>;
  activeShift?: any;
}

export default function InteractiveCalendar({ 
  clinic, 
  isStaff, 
  onOpenMedicalFile, 
  onOpenPatientFinancials,
  sharedAppointments,
  onRefreshAppointments,
  activeShift
}: InteractiveCalendarProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentCounts, setAppointmentCounts] = useState<Record<string, number>>({});
  const [patients, setPatients] = useState<Patient[]>([]);

  // Optimized O(1) patient lookup map to prevent O(N^2) render loop finds
  const patientsMap = useMemo(() => {
    const map = new Map<string, Patient>();
    patients.forEach((p) => map.set(p.id, p));
    return map;
  }, [patients]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Financial Modal state
  const [financialModalPatient, setFinancialModalPatient] = useState<{ id?: string; name: string; phone?: string } | null>(null);

  // Calendar view states
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return getEgyptTodayStr();
  });

  const todayStr = useMemo(() => getEgyptTodayStr(), []);

  const getYesterdayStr = () => {
    const parts = (selectedDate || todayStr).split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 1);
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const getTomorrowStr = () => {
    const parts = (selectedDate || todayStr).split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + 1);
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const handleSelectDate = (dateStr: string) => {
    if (!dateStr) return;
    setSelectedDate(dateStr);
    const parts = dateStr.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0])) {
      setCurrentDate(new Date(parts[0], parts[1] - 1, parts[2]));
    }
  };

  // Filter and search states for selected day appointments
  const [appStatusFilter, setAppStatusFilter] = useState<'all' | 'waiting' | 'completed' | 'scheduled' | 'cancelled'>('all');
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [expandedProcedureAppIds, setExpandedProcedureAppIds] = useState<Record<string, boolean>>({});

  const toggleProcedures = (appId: string) => {
    setExpandedProcedureAppIds(prev => ({
      ...prev,
      [appId]: !prev[appId]
    }));
  };

  // Close procedure tables when clicking anywhere outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const rawTarget = e.target as Node | null;
      const targetElement = rawTarget instanceof Element
        ? rawTarget
        : rawTarget?.parentElement || null;

      if (targetElement) {
        if (!targetElement.closest('.procedure-table-container')) {
          setExpandedProcedureAppIds({});
        }
      } else {
        setExpandedProcedureAppIds({});
      }
    };
    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  }, []);

  // Appointment Form states
  const [isAdding, setIsAdding] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('10:00');
  const [treatmentType, setTreatmentType] = useState('كشف جديد');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [initialPrice, setInitialPrice] = useState<string>('');
  const [deletingAppointmentId, setDeletingAppointmentId] = useState<string | null>(null);

  // Booking system mode ('time' | 'turn' | 'hybrid')
  const clinicBookingMode = clinic.bookingSystemMode || (typeof window !== 'undefined' ? (safeStorage.getItem(`clinic_booking_mode_${clinic.id}`) as any) : null) || 'hybrid';
  const [selectedBookingType, setSelectedBookingType] = useState<'time' | 'turn'>(
    clinicBookingMode === 'turn' ? 'turn' : 'time'
  );
  const [turnNumberInput, setTurnNumberInput] = useState<number | string>(1);

  useEffect(() => {
    if (clinicBookingMode === 'turn') {
      setSelectedBookingType('turn');
    } else if (clinicBookingMode === 'time') {
      setSelectedBookingType('time');
    }
  }, [clinicBookingMode]);

  const getRecommendedTurnNumber = (dateStr: string) => {
    const sameDayApps = appointments.filter(a => a.date === dateStr && a.status !== 'cancelled');
    const turns = sameDayApps.map(a => a.turnNumber).filter((t): t is number => typeof t === 'number' && !isNaN(t) && t > 0);
    if (turns.length > 0) {
      return Math.max(...turns) + 1;
    }
    return sameDayApps.length + 1;
  };

  useEffect(() => {
    if (isAdding) {
      setTurnNumberInput(getRecommendedTurnNumber(selectedDate));
    }
  }, [isAdding, selectedDate, appointments.length]);

  // Quick Booking (New Patient)
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [newPatientWhatsappNumber, setNewPatientWhatsappNumber] = useState('');
  const [newPatientGender, setNewPatientGender] = useState<'ذكر' | 'أنثى'>('ذكر');
  const [newPatientAge, setNewPatientAge] = useState('');
  const [newPatientOccupation, setNewPatientOccupation] = useState('');
  const [newPatientGovernorate, setNewPatientGovernorate] = useState('');
  const [newPatientCityOrDistrict, setNewPatientCityOrDistrict] = useState('');
  const [newPatientAddress, setNewPatientAddress] = useState('');
  const [newPatientMedicalHistory, setNewPatientMedicalHistory] = useState('');

  // Edit Patient Modal State for Appointment Cards
  const [editingPatientModalData, setEditingPatientModalData] = useState<{
    id?: string;
    originalName: string;
    name: string;
    phone: string;
    whatsappNumber: string;
    gender: 'ذكر' | 'أنثى';
    age: string;
    occupation: string;
    governorate: string;
    cityOrDistrict: string;
    address: string;
    medicalHistory: string;
    generalNotes: string;
    questionnaireAnswers: Record<string, { answer: 'نعم' | 'لا'; details: string }>;
    appointmentId?: string;
  } | null>(null);

  const [isSavingPatientEdit, setIsSavingPatientEdit] = useState(false);

  const handleOpenEditPatientModal = async (app: Appointment) => {
    let foundPatient: Patient | undefined = (app.patientId && patientsMap.get(app.patientId)) ||
      patients.find(p => (app.patientId && p.id === app.patientId) || (app.patientPhone && p.phone === app.patientPhone) || p.name === app.patientName);

    // If patient not in memory or missing questionnaire details, fetch full patient doc from Firestore
    if ((!foundPatient || !foundPatient.questionnaire) && (app.patientId || app.patientPhone)) {
      try {
        if (app.patientId) {
          const patientDocRef = doc(getPatientsRef(clinic.id), app.patientId);
          const patientSnap = await getDoc(patientDocRef);
          if (patientSnap.exists()) {
            const pData = patientSnap.data();
            foundPatient = {
              id: patientSnap.id,
              name: pData.name || app.patientName || '',
              phone: pData.phone || app.patientPhone || '',
              whatsappNumber: pData.whatsappNumber || pData.phone || app.patientPhone || '',
              gender: pData.gender || 'ذكر',
              age: pData.age || '',
              address: pData.address || '',
              governorate: pData.governorate || '',
              cityOrDistrict: pData.cityOrDistrict || '',
              occupation: pData.occupation || '',
              questionnaire: pData.questionnaire,
              medicalHistory: pData.medicalHistory || '',
              createdAt: pData.createdAt || '',
              updatedAt: pData.updatedAt || ''
            };
          }
        }
        if (!foundPatient && app.patientPhone) {
          const qPhone = query(getPatientsRef(clinic.id), where('phone', '==', app.patientPhone.trim()), limit(1));
          const phoneSnap = await getDocs(qPhone);
          if (!phoneSnap.empty) {
            const docSnap = phoneSnap.docs[0];
            const pData = docSnap.data();
            foundPatient = {
              id: docSnap.id,
              name: pData.name || app.patientName || '',
              phone: pData.phone || app.patientPhone || '',
              whatsappNumber: pData.whatsappNumber || pData.phone || app.patientPhone || '',
              gender: pData.gender || 'ذكر',
              age: pData.age || '',
              address: pData.address || '',
              governorate: pData.governorate || '',
              cityOrDistrict: pData.cityOrDistrict || '',
              occupation: pData.occupation || '',
              questionnaire: pData.questionnaire,
              medicalHistory: pData.medicalHistory || '',
              createdAt: pData.createdAt || '',
              updatedAt: pData.updatedAt || ''
            };
          }
        }
      } catch (err) {
        console.warn('Error fetching patient doc for edit modal:', err);
      }
    }

    const q = foundPatient?.questionnaire || {};
    const custom = q.customAnswers || {};
    const loadedAnswers: Record<string, { answer: 'نعم' | 'لا'; details: string }> = {};

    activeQuestions.forEach(question => {
      if (custom[question.id]) {
        loadedAnswers[question.id] = {
          answer: custom[question.id].answer === 'نعم' ? 'نعم' : 'لا',
          details: custom[question.id].details || ''
        };
      } else if (question.id === 'q_thyroid' && q.thyroidIssue) {
        const isYes = q.thyroidIssue !== 'لا' && q.thyroidIssue !== 'لا يوجد';
        loadedAnswers[question.id] = {
          answer: isYes ? 'نعم' : 'لا',
          details: isYes ? (q.thyroidIssue.startsWith('نعم - ') ? q.thyroidIssue.replace('نعم - ', '') : (q.thyroidIssue === 'نعم' ? '' : q.thyroidIssue)) : ''
        };
      } else if (question.id === 'q_diabetes' && q.hasDiabetes) {
        const isYes = q.hasDiabetes !== 'لا';
        loadedAnswers[question.id] = {
          answer: isYes ? 'نعم' : 'لا',
          details: isYes ? (q.hasDiabetes.startsWith('نعم - ') ? q.hasDiabetes.replace('نعم - ', '') : (q.hasDiabetes === 'نعم' ? '' : q.hasDiabetes)) : ''
        };
      } else if (question.id === 'q_heart' && q.hasHeartDisease) {
        const isYes = q.hasHeartDisease !== 'لا';
        loadedAnswers[question.id] = {
          answer: isYes ? 'نعم' : 'لا',
          details: isYes ? (q.hasHeartDisease.startsWith('نعم - ') ? q.hasHeartDisease.replace('نعم - ', '') : (q.hasHeartDisease === 'نعم' ? '' : q.hasHeartDisease)) : ''
        };
      } else if (question.id === 'q_chronic' && q.chronicDiseases) {
        const isYes = Boolean(q.chronicDiseases.trim());
        loadedAnswers[question.id] = {
          answer: isYes ? 'نعم' : 'لا',
          details: isYes ? q.chronicDiseases : ''
        };
      } else if (question.id === 'q_allergies' && q.allergies) {
        const isYes = Boolean(q.allergies.trim());
        loadedAnswers[question.id] = {
          answer: isYes ? 'نعم' : 'لا',
          details: isYes ? q.allergies : ''
        };
      } else {
        loadedAnswers[question.id] = { answer: 'لا', details: '' };
      }
    });

    setEditingPatientModalData({
      id: foundPatient?.id || app.patientId || undefined,
      originalName: app.patientName || '',
      name: foundPatient?.name || app.patientName || '',
      phone: foundPatient?.phone || app.patientPhone || '',
      whatsappNumber: foundPatient?.whatsappNumber || foundPatient?.phone || app.patientPhone || '',
      gender: (foundPatient?.gender as 'ذكر' | 'أنثى') || 'ذكر',
      age: foundPatient?.age || '',
      occupation: foundPatient?.occupation || '',
      governorate: foundPatient?.governorate || '',
      cityOrDistrict: foundPatient?.cityOrDistrict || '',
      address: foundPatient?.address || '',
      medicalHistory: foundPatient?.medicalHistory || '',
      generalNotes: q.generalNotes || '',
      questionnaireAnswers: loadedAnswers,
      appointmentId: app.id
    });
  };

  const handleSavePatientEdit = async () => {
    if (!editingPatientModalData) return;
    if (!editingPatientModalData.name.trim()) {
      dialogs.alert('يرجى إدخال اسم المريض', { severity: 'warning' });
      return;
    }
    const phoneClean = formatEgyptianPhoneInput(editingPatientModalData.phone);
    const phoneErr = getEgyptianPhoneError(phoneClean, true, 'رقم المحمول للمريض');
    if (phoneErr) {
      dialogs.alert(phoneErr, { severity: 'warning' });
      return;
    }

    if (editingPatientModalData.whatsappNumber?.trim()) {
      const waClean = formatEgyptianPhoneInput(editingPatientModalData.whatsappNumber);
      const waErr = getEgyptianPhoneError(waClean, false, 'رقم الواتساب');
      if (waErr) {
        dialogs.alert(waErr, { severity: 'warning' });
        return;
      }
    }

    setIsSavingPatientEdit(true);
    try {
      const trimmedName = editingPatientModalData.name.trim();
      const trimmedPhone = editingPatientModalData.phone.trim();
      const trimmedWhatsapp = editingPatientModalData.whatsappNumber.trim() || trimmedPhone;
      const trimmedAge = editingPatientModalData.age.trim();
      const trimmedGov = editingPatientModalData.governorate.trim();
      const trimmedCity = editingPatientModalData.cityOrDistrict.trim();
      const trimmedAddr = editingPatientModalData.address.trim();
      const trimmedOcc = editingPatientModalData.occupation.trim();
      const trimmedMed = editingPatientModalData.medicalHistory.trim();

      // Questionnaire synthesis
      const modalQAnswers = editingPatientModalData.questionnaireAnswers || {};
      const customAnswersObj: Record<string, { answer: 'نعم' | 'لا'; details: string }> = {};
      const autoMedicalParts: string[] = [];

      activeQuestions.forEach((qItem) => {
        const ans = modalQAnswers[qItem.id] || { answer: 'لا', details: '' };
        customAnswersObj[qItem.id] = ans;

        if (ans.answer === 'نعم') {
          const detailTxt = ans.details.trim();
          const qCleanTitle = qItem.text.replace(/^\d+[\.\-]\s*/, '').trim();
          autoMedicalParts.push(`${qCleanTitle}: نعم${detailTxt ? ` - التفاصيل: (${detailTxt})` : ''}`);
        }
      });

      const thyroidAns = modalQAnswers['q_thyroid'] || { answer: 'لا', details: '' };
      const finalThyroid = thyroidAns.answer === 'نعم' ? (thyroidAns.details.trim() ? `نعم - ${thyroidAns.details.trim()}` : 'نعم') : 'لا يوجد';

      const diabetesAns = modalQAnswers['q_diabetes'] || { answer: 'لا', details: '' };
      const finalDiabetes = diabetesAns.answer === 'نعم' ? (diabetesAns.details.trim() ? `نعم - ${diabetesAns.details.trim()}` : 'نعم') : 'لا';

      const heartAns = modalQAnswers['q_heart'] || { answer: 'لا', details: '' };
      const finalHeart = heartAns.answer === 'نعم' ? (heartAns.details.trim() ? `نعم - ${heartAns.details.trim()}` : 'نعم') : 'لا';

      const chronicAns = modalQAnswers['q_chronic'] || { answer: 'لا', details: '' };
      const finalChronic = chronicAns.answer === 'نعم' ? (chronicAns.details.trim() || 'نعم') : '';

      const allergiesAns = modalQAnswers['q_allergies'] || { answer: 'لا', details: '' };
      const finalAllergies = allergiesAns.answer === 'نعم' ? (allergiesAns.details.trim() || 'نعم') : '';

      const computedMedicalHistory = trimmedMed || autoMedicalParts.join(' | ') || 'سليم - لا يوجد أمراض مزمنة مسجلة';

      const questionnaireObj: PatientQuestionnaire = {
        thyroidIssue: finalThyroid,
        hasDiabetes: finalDiabetes,
        hasHeartDisease: finalHeart,
        chronicDiseases: finalChronic,
        allergies: finalAllergies,
        customAnswers: customAnswersObj,
        generalNotes: (editingPatientModalData.generalNotes || '').trim(),
        filledAt: new Date().toISOString()
      };

      let targetPatientId = editingPatientModalData.id;

      if (!targetPatientId) {
        const existing = patients.find(p => p.name === trimmedName || (trimmedPhone && p.phone === trimmedPhone));
        if (existing) {
          targetPatientId = existing.id;
        }
      }

      const patientPayload = {
        clinicId: clinic.id,
        name: trimmedName,
        phone: trimmedPhone,
        whatsappNumber: trimmedWhatsapp,
        gender: editingPatientModalData.gender,
        age: trimmedAge,
        governorate: trimmedGov,
        cityOrDistrict: trimmedCity,
        address: trimmedAddr,
        occupation: trimmedOcc,
        medicalHistory: computedMedicalHistory,
        questionnaire: questionnaireObj,
        updatedAt: new Date().toISOString()
      };

      if (targetPatientId) {
        const pRef = doc(getPatientsRef(clinic.id), targetPatientId);
        await updateDoc(pRef, patientPayload);
      } else {
        const newDoc = await addDoc(getPatientsRef(clinic.id), {
          ...patientPayload,
          createdAt: new Date().toISOString()
        });
        targetPatientId = newDoc.id;
      }

      // Update all appointments belonging to this patient or matching original name
      const oldName = editingPatientModalData.originalName || trimmedName;
      const appRef = getAppointmentsRef(clinic.id);
      const appSnap = await getDocs(appRef);

      const updatePromises: Promise<any>[] = [];
      appSnap.forEach((d) => {
        const data = d.data();
        if ((targetPatientId && data.patientId === targetPatientId) || data.patientName === oldName) {
          updatePromises.push(
            updateDoc(doc(appRef, d.id), {
              patientId: targetPatientId,
              patientName: trimmedName,
              patientPhone: trimmedPhone
            })
          );
        }
      });

      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }

      // Broadcast sync event
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patients' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'appointments' } }));

      // Refresh data
      await fetchPatients(true);
      await fetchAppointments(true);

      setEditingPatientModalData(null);
      dialogs.alert('تم تحديث بيانات المريض بنجاح', { severity: 'success' });
    } catch (err: any) {
      console.error("Error updating patient data:", err);
      dialogs.alert('حدث خطأ أثناء حفظ التعديلات: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setIsSavingPatientEdit(false);
    }
  };

  // Reception Pre-exam Questionnaire for New Patient Quick Registration
  const activeQuestions = useMemo(() => {
    const list = (clinic.questionnaireQuestions && clinic.questionnaireQuestions.length > 0)
      ? clinic.questionnaireQuestions
      : DEFAULT_QUESTIONNAIRE_QUESTIONS;
    return list.filter(q => q.enabled !== false);
  }, [clinic.questionnaireQuestions]);

  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, { answer: 'نعم' | 'لا'; details: string }>>({});
  const [generalNotes, setGeneralNotes] = useState('');

  const setQuestionAnswer = (qId: string, answer: 'نعم' | 'لا', details?: string) => {
    setQuestionnaireAnswers(prev => ({
      ...prev,
      [qId]: {
        answer,
        details: details !== undefined ? details : (prev[qId]?.details || '')
      }
    }));
  };

  const governorateOptions = useMemo(() => {
    return EGYPT_GOVERNORATES.map(g => isEn ? g.nameEn : g.name);
  }, [isEn]);

  const selectedGovObj = useMemo(() => {
    return EGYPT_GOVERNORATES.find(g => 
      g.name === newPatientGovernorate || 
      g.nameEn.toLowerCase() === newPatientGovernorate.toLowerCase()
    );
  }, [newPatientGovernorate]);

  const centerOptions = useMemo(() => {
    if (!selectedGovObj) {
      const allCenters = EGYPT_GOVERNORATES.flatMap(g => isEn ? g.centersEn : g.centers);
      return Array.from(new Set(allCenters));
    }
    return isEn ? selectedGovObj.centersEn : selectedGovObj.centers;
  }, [selectedGovObj, isEn]);

  const handleGovernorateChange = (newGov: string) => {
    setNewPatientGovernorate(newGov);
    const govObj = EGYPT_GOVERNORATES.find(g => 
      g.name === newGov || 
      g.nameEn.toLowerCase() === newGov.toLowerCase()
    );
    if (govObj && govObj.centers.length > 0) {
      setNewPatientCityOrDistrict(isEn ? govObj.centersEn[0] : govObj.centers[0]);
    } else {
      setNewPatientCityOrDistrict('');
    }
  };

  // Multiple concurrent procedures in booked appointment
  const [appProcedures, setAppProcedures] = useState<Array<{ id: string; name: string; price: number }>>([]);

  // Sync procedures with form state (keep empty so we fallback to single procedure by default)
  useEffect(() => {
    if (isAdding) {
      setAppProcedures([]);
      if (treatmentType === 'كشف جديد') {
        setInitialPrice(clinic.consultationPrice !== undefined && clinic.consultationPrice > 0 ? String(clinic.consultationPrice) : '');
      }
    }
  }, [isAdding, treatmentType, clinic.consultationPrice]);

  const lastFetchPatientsTimeRef = useRef(0);
  const lastFetchAppointmentCountsTimeRef = useRef(0);
  const lastFetchAppointmentsTimeRef = useRef(0);

  const fetchPatients = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchPatientsTimeRef.current < 2500) {
      console.log('[InteractiveCalendar] fetchPatients throttled (skipped redundant DB read)');
      return;
    }
    try {
      const q = query(getPatientsRef(clinic.id), orderBy('createdAt', 'desc'), limit(100));
      const snap = await getDocs(q);
      const list: Patient[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name || '',
          phone: data.phone || '',
          whatsappNumber: data.whatsappNumber || data.phone || '',
          gender: data.gender || 'ذكر',
          age: data.age || '',
          address: data.address || '',
          governorate: data.governorate || '',
          cityOrDistrict: data.cityOrDistrict || '',
          occupation: data.occupation || '',
          questionnaire: data.questionnaire || undefined,
          medicalHistory: data.medicalHistory || '',
          createdAt: data.createdAt || '',
          updatedAt: data.updatedAt || ''
        });
      });
      setPatients(list);
      lastFetchPatientsTimeRef.current = Date.now();
    } catch (e) {
      console.error('Error fetching patients for calendar:', e);
    }
  };

  const fetchAppointmentCounts = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchAppointmentCountsTimeRef.current < 2500) {
      console.log('[InteractiveCalendar] fetchAppointmentCounts throttled (skipped redundant DB read)');
      return;
    }
    try {
      const counts = await getAppointmentsCounts(clinic.id);
      setAppointmentCounts(counts);
      lastFetchAppointmentCountsTimeRef.current = Date.now();
    } catch (err) {
      console.error('Error fetching appointment counts:', err);
    }
  };

  const fetchAppointments = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastFetchAppointmentsTimeRef.current < 2500) {
      console.log('[InteractiveCalendar] fetchAppointments throttled (skipped redundant DB read)');
      return;
    }
    fetchAppointmentCounts(force);
    if (onRefreshAppointments) {
      setLoading(true);
      setError(null);
      try {
        await onRefreshAppointments(false, selectedDate, true);
        lastFetchAppointmentsTimeRef.current = Date.now();
      } catch (err: any) {
        console.error(err);
        setError('حدث خطأ أثناء تحميل المواعيد: ' + (err.message || err.toString()));
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ref = getAppointmentsRef(clinic.id);
      const snap = await getDocs(ref);
      const list: Appointment[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          patientId: data.patientId || '',
          patientName: data.patientName || '',
          patientPhone: data.patientPhone || '',
          date: data.date || '',
          time: data.time || '',
          treatmentType: data.treatmentType || '',
          price: Number(data.price) || 0,
          notes: cleanNotes(data.notes || ''),
          status: data.status || 'scheduled',
          paidAmount: data.paidAmount !== undefined ? Number(data.paidAmount) : undefined,
          remainingAmount: data.remainingAmount !== undefined ? Number(data.remainingAmount) : undefined,
          invoiceStatus: data.invoiceStatus || (data.remainingAmount === 0 ? 'paid' : (data.paidAmount ? 'installment' : 'draft')),
          financialNote: data.financialNote || '',
          paymentMethod: data.paymentMethod || undefined,
          toothNumber: data.toothNumber !== undefined ? Number(data.toothNumber) : undefined,
          procedures: data.procedures || [],
          payments: data.payments || []
        });
      });
      // Sort appointments by date and time
      list.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.time.localeCompare(b.time);
      });
      setAppointments(list);
      lastFetchAppointmentsTimeRef.current = Date.now();
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء تحميل المواعيد: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients(true);
    fetchAppointmentCounts(true);
    if (!sharedAppointments) {
      fetchAppointments(true);
    }

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};
      
      const relevantTables = ['appointments', 'patients', 'records'];
      if (relevantTables.includes(table) && !isAdding) {
        console.log(`[InteractiveCalendar] Instant calendar sync triggered for table: ${table}`);
        fetchPatients(false);
        fetchAppointmentCounts(false);
        if (onRefreshAppointments) {
          onRefreshAppointments(true, selectedDate, true);
        }
        if (!sharedAppointments) {
          fetchAppointments(false);
        }
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => window.removeEventListener('clinic-sync', handleSync);
  }, [clinic.id, isAdding]);

  useEffect(() => {
    if (sharedAppointments) {
      const list = [...sharedAppointments];
      list.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.time.localeCompare(b.time);
      });
      setAppointments(list);
    }
  }, [sharedAppointments]);

  useEffect(() => {
    if (selectedDate && onRefreshAppointments) {
      onRefreshAppointments(true, selectedDate, true);
      fetchAppointmentCounts(false);
    }
  }, [selectedDate]);

  const handleAddAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;

    if (!activeShift) {
      dialogs.alert('برجاء فتح وردية أولاً!', { severity: 'warning' });
      return;
    }

    let targetPatientId = '';
    let targetPatientName = '';
    let targetPatientPhone = '';

    setLoading(true);
    setError(null);

    try {
      if (isNewPatient) {
        if (!newPatientName.trim()) {
          dialogs.alert('يرجى إدخال اسم المريض بالكامل!', { severity: 'warning' });
          setLoading(false);
          return;
        }

        const phoneClean = formatEgyptianPhoneInput(newPatientPhone);
        const phoneErr = getEgyptianPhoneError(phoneClean, true, 'رقم المحمول');
        if (phoneErr) {
          dialogs.alert(phoneErr, { severity: 'warning' });
          setLoading(false);
          return;
        }

        const whatsappClean = newPatientWhatsappNumber.trim() ? formatEgyptianPhoneInput(newPatientWhatsappNumber) : phoneClean;
        if (newPatientWhatsappNumber.trim()) {
          const waErr = getEgyptianPhoneError(whatsappClean, false, 'رقم الواتساب');
          if (waErr) {
            dialogs.alert(waErr, { severity: 'warning' });
            setLoading(false);
            return;
          }
        }
      } else {
        if (!selectedPatientId) {
          dialogs.alert('الرجاء اختيار المريض أولاً', { severity: 'warning' });
          setLoading(false);
          return;
        }
      }

      const isTurnBooking = clinicBookingMode === 'turn' || (clinicBookingMode === 'hybrid' && selectedBookingType === 'turn');
      const targetTurn = isTurnBooking ? (Number(turnNumberInput) || getRecommendedTurnNumber(selectedDate)) : undefined;

      const normSelDate = normalizeDateStr(selectedDate);
      const sameDayActiveApps = appointments.filter(a =>
        normalizeDateStr(a.date) === normSelDate &&
        a.status?.toLowerCase() !== 'cancelled' &&
        a.status?.toLowerCase() !== 'canceled'
      );

      // Find if this patient already has an active appointment on the target date
      let existingAppForPatient = (!isNewPatient && selectedPatientId)
        ? sameDayActiveApps.find(a => a.patientId === selectedPatientId)
        : undefined;

      // Check for double booking conflict with OTHER appointments
      const hasConflict = sameDayActiveApps.some((app, index) => {
        // If updating/merging an existing appointment for the same patient, ignore conflict with itself
        if (existingAppForPatient && app.id === existingAppForPatient.id) {
          return false;
        }

        if (isTurnBooking) {
          // In turn-based booking, check conflict on turn number
          const appTurn = (app.turnNumber !== undefined && app.turnNumber !== null && !isNaN(Number(app.turnNumber)))
            ? Number(app.turnNumber)
            : (index + 1);
          return targetTurn !== undefined && appTurn === targetTurn;
        } else {
          // In time-based booking, check conflict on time slot / hour
          return isAppointmentTimeConflict(app.time, appointmentTime);
        }
      });

      if (hasConflict) {
        dialogs.alert(
          isTurnBooking
            ? (isEn ? 'Sorry, this turn number is already booked on this date!' : 'عفواً، يوجد موعد محجوز بهذا الرقم في هذا اليوم!')
            : (isEn ? `Sorry, an appointment is already booked at ${formatTimeTo12Hour(appointmentTime, true)}! Please select a different time.` : `عفواً، يوجد موعد محجوز بالفعل في الساعة (${formatTimeTo12Hour(appointmentTime, false)})! يرجى تغيير الوقت لتفادي التضارب.`),
          { severity: 'error' }
        );
        setLoading(false);
        return;
      }

      if (isNewPatient) {
        // Add New Patient placeholder
        const patientsRef = getPatientsRef(clinic.id);
        
        // Check if patient with exact same name already exists
        const qDup = query(patientsRef, where("name", "==", newPatientName.trim()));
        const dupSnap = await getDocs(qDup);
        if (!dupSnap.empty) {
          dialogs.alert('عذراً، هذا الاسم مسجل بالفعل لمريض آخر في العيادة. يرجى اختيار المريض من القائمة بدلاً من تسجيله كجديد، أو إدخال اسم فريد لتجنب التكرار.', { severity: 'warning' });
          setLoading(false);
          return;
        }

        const newPatientDocRef = doc(patientsRef);
        targetPatientId = newPatientDocRef.id;
        targetPatientName = newPatientName.trim();
        targetPatientPhone = newPatientPhone.trim();

        // Synthesize medical history & questionnaire values
        const customAnswersObj: Record<string, { answer: 'نعم' | 'لا'; details: string }> = {};
        const autoMedicalParts: string[] = [];

        activeQuestions.forEach((q) => {
          const ans = questionnaireAnswers[q.id] || { answer: 'لا', details: '' };
          customAnswersObj[q.id] = ans;

          if (ans.answer === 'نعم') {
            const detailTxt = ans.details.trim();
            const qCleanTitle = q.text.replace(/^\d+[\.\-]\s*/, '').trim();
            autoMedicalParts.push(`${qCleanTitle}: نعم${detailTxt ? ` - التفاصيل: (${detailTxt})` : ''}`);
          }
        });

        const computedMedicalHistory = newPatientMedicalHistory.trim() || autoMedicalParts.join(' | ') || 'سليم - لا يوجد أمراض مزمنة مسجلة';

        const questionnaireObj: PatientQuestionnaire = {
          customAnswers: customAnswersObj,
          generalNotes: generalNotes.trim(),
          filledAt: new Date().toISOString()
        };

        // Create the patient document directly in patients collection with full registration data
        await setDoc(newPatientDocRef, cleanDbData({
          name: targetPatientName,
          phone: targetPatientPhone,
          whatsappNumber: newPatientWhatsappNumber.trim() || targetPatientPhone,
          gender: newPatientGender,
          age: newPatientAge.trim(),
          occupation: newPatientOccupation.trim(),
          governorate: newPatientGovernorate.trim(),
          cityOrDistrict: newPatientCityOrDistrict.trim(),
          address: newPatientAddress.trim(),
          medicalHistory: computedMedicalHistory,
          questionnaire: questionnaireObj,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }));

        await fetchPatients(true);
      } else {
        const patient = patients.find((p) => p.id === selectedPatientId);
        if (!patient) {
          setLoading(false);
          return;
        }
        targetPatientId = patient.id;
        targetPatientName = patient.name;
        targetPatientPhone = patient.phone;
      }

      // Check if the patient already has an active or completed appointment on that day (not cancelled)
      if (!existingAppForPatient && !isNewPatient && targetPatientId) {
        // Fallback check if targetPatientId was resolved above
        const found = sameDayActiveApps.find((app) => app.patientId === targetPatientId);
        if (found) {
          // Assign to existingAppForPatient variable
          (existingAppForPatient as any) = found;
        }
      }

      if (existingAppForPatient) {
        const ref = getAppointmentsRef(clinic.id);
        const numPrice = Number(initialPrice) || 0;

        const prevPrice = Number(existingAppForPatient.price) || 0;
        const prevTreatment = existingAppForPatient.treatmentType ? existingAppForPatient.treatmentType.trim() : '';

        // Combine treatment names avoiding duplicates
        let combinedTreatment = prevTreatment;
        if (combinedTreatment) {
          if (!combinedTreatment.includes(treatmentType.trim())) {
            combinedTreatment = `${combinedTreatment} + ${treatmentType.trim()}`;
          }
        } else {
          combinedTreatment = treatmentType.trim();
        }

        // Combine prices and keep previous payment
        const combinedPrice = prevPrice + numPrice;
        const currentPaid = Number(existingAppForPatient.paidAmount) || 0;
        const newRemaining = Math.max(0, combinedPrice - currentPaid);

        let invStatus: 'draft' | 'pending_payment' | 'paid' | 'installment' = 'draft';
        if (combinedPrice > 0) {
          if (newRemaining <= 0 && currentPaid >= combinedPrice) invStatus = 'paid';
          else if (currentPaid > 0) invStatus = 'installment';
          else invStatus = 'pending_payment';
        }

        // Combine procedures
        let combinedProcedures = [];
        if (existingAppForPatient.procedures) {
          combinedProcedures = [...existingAppForPatient.procedures];
        } else if (existingAppForPatient.treatmentType) {
          combinedProcedures = [{
            name: existingAppForPatient.treatmentType,
            price: Number(existingAppForPatient.price) || 0,
            tooth: existingAppForPatient.toothNumber || null
          }];
        }

        const newProcs = appProcedures && appProcedures.length > 0
          ? appProcedures.map(p => ({ name: p.name, price: p.price, tooth: null }))
          : [{ name: treatmentType, price: numPrice, tooth: null }];

        newProcs.forEach(p => {
          const isDup = combinedProcedures.some(cp => cp.name === p.name && cp.price === p.price && cp.tooth === (p.tooth || null));
          if (!isDup) {
            combinedProcedures.push(p);
          }
        });

        const combinedNotes = `${existingAppForPatient.notes ? existingAppForPatient.notes + '\n' : ''}${appointmentNotes}`;

        const appDocRef = doc(ref, existingAppForPatient.id);
        await setDoc(appDocRef, cleanDbData({
          ...existingAppForPatient,
          status: 'scheduled', // change status of the completed appointment back to scheduled/active for doctor queue
          time: appointmentTime,
          date: selectedDate,
          treatmentType: combinedTreatment,
          price: combinedPrice,
          paidAmount: currentPaid,
          remainingAmount: newRemaining,
          invoiceStatus: invStatus,
          notes: combinedNotes,
          procedures: combinedProcedures
        }), { merge: true });

        setIsAdding(false);
        setAppointmentNotes('');
        setInitialPrice('');
        setSelectedPatientId('');
        setAppointmentTime('10:00');
        setTreatmentType('كشف جديد');
        setAppProcedures([]);
        setIsNewPatient(false);
        setNewPatientName('');
        setNewPatientPhone('');
        setNewPatientAge('');
        setNewPatientMedicalHistory('');

        await fetchAppointments(true);
        dialogs.alert('تم دمج وتحديث الموعد القائم للمريض بنجاح وإعادة تفعيله للعيادة!', { severity: 'success' });
        return;
      }

      const ref = getAppointmentsRef(clinic.id);
      const numPrice = Number(initialPrice) || 0;
      const initialProcs = appProcedures && appProcedures.length > 0
        ? appProcedures.map(p => ({ name: p.name, price: p.price, tooth: null }))
        : [{ name: treatmentType, price: numPrice, tooth: null }];

      await addDoc(ref, cleanDbData({
        patientId: targetPatientId,
        patientName: targetPatientName,
        patientPhone: targetPatientPhone,
        patientWhatsapp: isNewPatient ? (newPatientWhatsappNumber.trim() || targetPatientPhone) : undefined,
        patientGender: isNewPatient ? newPatientGender : undefined,
        patientAge: isNewPatient ? newPatientAge.trim() : undefined,
        patientOccupation: isNewPatient ? newPatientOccupation.trim() : undefined,
        patientGovernorate: isNewPatient ? newPatientGovernorate.trim() : undefined,
        patientCityOrDistrict: isNewPatient ? newPatientCityOrDistrict.trim() : undefined,
        patientAddress: isNewPatient ? newPatientAddress.trim() : undefined,
        patientMedicalHistory: isNewPatient ? newPatientMedicalHistory.trim() : undefined,
        isPendingNewPatient: false,
        date: selectedDate,
        time: appointmentTime,
        bookingType: isTurnBooking ? 'turn' : 'time',
        turnNumber: isTurnBooking ? (Number(turnNumberInput) || getRecommendedTurnNumber(selectedDate)) : undefined,
        treatmentType,
        price: numPrice,
        paidAmount: 0,
        remainingAmount: numPrice,
        invoiceStatus: numPrice > 0 ? 'pending_payment' : 'draft',
        notes: appointmentNotes,
        status: 'scheduled',
        procedures: initialProcs
      }));

      setIsAdding(false);
      setAppointmentNotes('');
      setInitialPrice('');
      setSelectedPatientId('');
      setAppointmentTime('10:00');
      setTreatmentType('كشف جديد');
      setAppProcedures([]);
      setIsNewPatient(false);
      setNewPatientName('');
      setNewPatientPhone('');
      setNewPatientWhatsappNumber('');
      setNewPatientGender('ذكر');
      setNewPatientAge('');
      setNewPatientOccupation('');
      setNewPatientGovernorate('');
      setNewPatientCityOrDistrict('');
      setNewPatientAddress('');
      setNewPatientMedicalHistory('');
      setQuestionnaireAnswers({});
      setGeneralNotes('');

      await fetchAppointments(true);
      dialogs.alert('تم حجز الموعد بنجاح!', { severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء حجز الموعد: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (appointmentId: string, status: 'scheduled' | 'waiting' | 'completed' | 'cancelled') => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setLoading(true);
    try {
      const existingApp = appointments.find(a => a.id === appointmentId);
      const ref = getAppointmentsRef(clinic.id);
      const docRef = doc(ref, appointmentId);
      await setDoc(docRef, cleanDbData({
        ...(existingApp || {}),
        status,
        updatedAt: new Date().toISOString(),
        shiftId: (activeShift && activeShift.id) ? activeShift.id : (existingApp?.shiftId || undefined)
      }), { merge: true });

      // Automatically create patient document in patients collection and patient medical record when appointment is completed
      if (status === 'completed' && existingApp && existingApp.patientId) {
        // 1. Ensure patient document exists in patients collection (so patient appears in المرضى والأقساط)
        try {
          const patientDocRef = doc(getPatientsRef(clinic.id), existingApp.patientId);
          const patientSnap = await getDoc(patientDocRef);
          if (!patientSnap.exists()) {
            const pName = (existingApp.patientName || '').trim();
            if (pName) {
              await setDoc(patientDocRef, cleanDbData({
                name: pName,
                phone: (existingApp.patientPhone || '').trim(),
                age: (existingApp.patientAge || '').trim(),
                medicalHistory: (existingApp.patientMedicalHistory || '').trim(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }), { merge: true });
              await fetchPatients(true);
            }
          }
        } catch (pErr) {
          console.error("Error creating patient document on completion:", pErr);
        }

        // 2. Ensure medical record is created
        const recordsRef = getPatientRecordsRef(clinic.id, existingApp.patientId);
        const recordSnap = await getDocs(query(recordsRef, where('appointmentId', '==', appointmentId)));
        if (recordSnap.empty) {
          await addDoc(recordsRef, cleanDbData({
            date: new Date().toISOString(),
            treatment: existingApp.treatmentType || 'جلسة علاجية من التقويم المباشر',
            cost: Number(existingApp.price) || 0,
            notes: existingApp.notes || '',
            appointmentId: appointmentId,
            invoiceStatus: existingApp.invoiceStatus || 'draft',
            toothNumber: existingApp.toothNumber || null,
            financialNote: existingApp.financialNote || ''
          }));
        }
      }

      await fetchAppointments(true);
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء تعديل حالة الموعد: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert('عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    setLoading(true);
    try {
      const ref = getAppointmentsRef(clinic.id);
      const docRef = doc(ref, appointmentId);
      await deleteDoc(docRef);
      await fetchAppointments(true);
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء حذف الموعد: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  // WhatsApp Reminder Generator
  const sendWhatsAppReminder = (app: Appointment) => {
    // Format phone (remove leading 0 or prepend country code if missing)
    let phoneNum = app.patientPhone.trim();
    if (phoneNum.startsWith('0')) {
      // Assuming Egypt/Saudi prefix if starts with 0. Let's make it friendly
      // The user can type country code. If starts with 0, we'll try to use local form or replace.
      // Usually +966 or +20 can be handled. Let's just pass the phone to wa.me
      phoneNum = phoneNum.substring(1); // remove leading zero
      // Let's assume Egypt (+20) by default for dental, or let wa.me handle the browser's country
      phoneNum = '20' + phoneNum; // Default to Egypt code or Saudi if length is 9
    }
    
    const formattedDate = new Date(app.date).toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const message = `مرحباً أ. ${app.patientName}، تذكير بموعدكم في عيادة "${clinic.name}" لطب الأسنان:\n📅 اليوم: ${formattedDate}\n⏰ الساعة: ${formatTimeTo12Hour(app.time)}\n🦷 الإجراء المتوقع: ${app.treatmentType}\nنتمنى لكم دوام الصحة والعافية. يرجى تأكيد الحضور بالرد على هذه الرسالة.`;
    const waUrl = `https://wa.me/${phoneNum}?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank');
  };

  // Helper arrays for Calendar rendering
  const monthsArabic = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  const monthsEnglish = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthsList = isEn ? monthsEnglish : monthsArabic;
  const daysArabic = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const daysEnglish = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daysList = isEn ? daysEnglish : daysArabic;

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  const prevMonthDays = getDaysInMonth(year, month - 1);

  const calendarDays = [];

  // Previous month padding days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const m = month === 0 ? 11 : month - 1;
    const y = month === 0 ? year - 1 : year;
    calendarDays.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    calendarDays.push({ day: d, month, year, isCurrentMonth: true });
  }

  // Next month padding days to complete 6 weeks (42 days)
  const remaining = 42 - calendarDays.length;
  for (let d = 1; d <= remaining; d++) {
    const m = month === 11 ? 0 : month + 1;
    const y = month === 11 ? year + 1 : year;
    calendarDays.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setMonth(currentDate.getMonth() - 1);
    } else {
      newDate.setMonth(currentDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  // Filter appointments for the selected date
  const selectedDayAppointments = appointments.filter((app) => normalizeDateStr(app.date) === normalizeDateStr(selectedDate));

  // Helper to parse time string like "09:30 AM", "02:00 PM" or "14:00" into minutes from midnight for sorting
  const parseTimeToMinutes = (timeStr: string): number => {
    if (!timeStr) return 9999;
    const match12 = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (match12) {
      let hours = parseInt(match12[1], 10);
      const minutes = parseInt(match12[2], 10);
      const ampm = match12[3].toUpperCase();
      if (ampm === 'PM' && hours !== 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }
      return hours * 60 + minutes;
    }
    
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      if (!isNaN(hours) && !isNaN(minutes)) {
        return hours * 60 + minutes;
      }
    }
    return 9999;
  };

  // Sort today's active (non-cancelled) appointments to assign queue/turn numbers
  const activeAppointments = [...selectedDayAppointments]
    .filter(a => a.status?.toLowerCase() !== 'cancelled')
    .sort((a, b) => {
      if (clinicBookingMode === 'turn') {
        const aTurn = a.turnNumber !== undefined && a.turnNumber !== null && !isNaN(Number(a.turnNumber)) ? Number(a.turnNumber) : 9999;
        const bTurn = b.turnNumber !== undefined && b.turnNumber !== null && !isNaN(Number(b.turnNumber)) ? Number(b.turnNumber) : 9999;
        if (aTurn !== bTurn) return aTurn - bTurn;
      }
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });

  const filteredDayAppointments = selectedDayAppointments.filter((app) => {
    if (appStatusFilter !== 'all' && app.status !== appStatusFilter) return false;
    if (appSearchQuery.trim()) {
      const q = appSearchQuery.trim().toLowerCase();
      const patient = patientsMap.get(app.patientId);
      const patientName = (app.patientName || patient?.name || '').toLowerCase();
      const patientPhone = (app.patientPhone || patient?.phone || '').toLowerCase();
      if (!patientName.includes(q) && !patientPhone.includes(q)) {
        return false;
      }
    }
    return true;
  });

  // Sort filtered appointments based on active clinic booking mode
  const sortedFilteredDayAppointments = useMemo(() => {
    return [...filteredDayAppointments].sort((a, b) => {
      if (clinicBookingMode === 'turn') {
        const aTurn = a.turnNumber !== undefined && a.turnNumber !== null && !isNaN(Number(a.turnNumber)) ? Number(a.turnNumber) : 9999;
        const bTurn = b.turnNumber !== undefined && b.turnNumber !== null && !isNaN(Number(b.turnNumber)) ? Number(b.turnNumber) : 9999;
        if (aTurn !== bTurn) return aTurn - bTurn;
      }
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });
  }, [filteredDayAppointments, clinicBookingMode]);

  // Dynamic Payment Methods list and normalization helper
  const activeMethodsList = useMemo(() => {
    const defaultMethods = ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
    const custom = clinic.paymentMethods && clinic.paymentMethods.length > 0
      ? clinic.paymentMethods
      : [];
    const combined = [...defaultMethods];
    custom.forEach(cm => {
      const normCm = normalizePaymentMethod(cm);
      if (!combined.some(m => normalizePaymentMethod(m) === normCm)) {
        combined.push(cm);
      }
    });
    return combined.filter(m => normalizePaymentMethod(m) !== 'نقاط الولاء');
  }, [clinic.paymentMethods]);

  const dailyPaymentMethods = useMemo(() => {
    const revenueMap: Record<string, number> = {};
    activeMethodsList.forEach(m => {
      revenueMap[m] = 0;
    });

    const normSelDate = normalizeDateStr(selectedDate);

    appointments.forEach(app => {
      const paymentsList = getAppointmentPayments(app);

      if (paymentsList && paymentsList.length > 0) {
        paymentsList.forEach(pay => {
          const payDate = normalizeDateStr(pay.date || (pay.createdAt ? pay.createdAt.split('T')[0] : '') || app.date);
          if (payDate === normSelDate) {
            const normApp = normalizePaymentMethod(pay.paymentMethod || 'كاش');
            let matched = activeMethodsList.find(m => normalizePaymentMethod(m) === normApp);
            if (!matched && normApp !== 'نقاط الولاء') {
              matched = activeMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || activeMethodsList[0] || 'كاش';
            }
            if (matched) {
              revenueMap[matched] = (revenueMap[matched] || 0) + Number(pay.amount || 0);
            }
          }
        });
      } else if (Number(app.paidAmount || 0) > 0 && normalizeDateStr(app.date) === normSelDate) {
        const normApp = normalizePaymentMethod(app.paymentMethod || 'كاش');
        let matched = activeMethodsList.find(m => normalizePaymentMethod(m) === normApp);
        if (!matched && normApp !== 'نقاط الولاء') {
          matched = activeMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || activeMethodsList[0] || 'كاش';
        }
        if (matched) {
          revenueMap[matched] = (revenueMap[matched] || 0) + Number(app.paidAmount || 0);
        }
      }
    });

    return revenueMap;
  }, [activeMethodsList, appointments, selectedDate]);

  // Daily revenue metrics
  const dailyTotalPaid = useMemo(() => {
    return Object.values(dailyPaymentMethods).reduce((sum: number, val: number) => sum + Number(val || 0), 0);
  }, [dailyPaymentMethods]);

  const dailyTotalRemaining = selectedDayAppointments
    .filter(app => app.status === 'completed')
    .reduce((sum, app) => sum + (app.remainingAmount !== undefined ? app.remainingAmount : 0), 0);

  const dailyTotalOverall = dailyTotalPaid + dailyTotalRemaining;

  // Check if a calendar day has any scheduled appointments
  const hasAppointments = (d: number, m: number, y: number) => {
    const pad = (num: number) => String(num).padStart(2, '0');
    const isoDate = `${y}-${pad(m + 1)}-${pad(d)}`;
    const unpaddedDate = `${y}-${m + 1}-${d}`;
    return (appointmentCounts[isoDate] || 0) > 0 || (appointmentCounts[unpaddedDate] || 0) > 0;
  };

  const getAppointmentsCount = (d: number, m: number, y: number) => {
    const pad = (num: number) => String(num).padStart(2, '0');
    const isoDate = `${y}-${pad(m + 1)}-${pad(d)}`;
    const unpaddedDate = `${y}-${m + 1}-${d}`;
    return (appointmentCounts[isoDate] || 0) + (appointmentCounts[unpaddedDate] || 0);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <CalendarIcon className="h-6 w-6 text-indigo-600" />
              {t('calendar.title')}
            </h2>
            <span className={`text-xs px-2.5 py-1 rounded-xl font-extrabold flex items-center gap-1.5 border shadow-2xs ${
              clinicBookingMode === 'turn' 
                ? 'bg-amber-50 text-amber-900 border-amber-300' 
                : clinicBookingMode === 'time'
                ? 'bg-indigo-50 text-indigo-900 border-indigo-300'
                : 'bg-emerald-50 text-emerald-900 border-emerald-300'
            }`}>
              {clinicBookingMode === 'turn' ? (
                <><Ticket className="h-3.5 w-3.5 text-amber-600" /> {t('calendar.bookingModes.turn')}</>
              ) : clinicBookingMode === 'time' ? (
                <><Clock className="h-3.5 w-3.5 text-indigo-600" /> {t('calendar.bookingModes.time')}</>
              ) : (
                <><CalendarIcon className="h-3.5 w-3.5 text-emerald-600" /> {t('calendar.bookingModes.hybrid')}</>
              )}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (!activeShift && !isAdding) {
                dialogs.alert(t('calendar.shiftWarning'), { severity: 'warning' });
                return;
              }
              setIsAdding(!isAdding);
            }}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition shadow-md shadow-indigo-100 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {isAdding ? t('calendar.cancelBooking') : t('calendar.newAppointment')}
          </button>
          <button
            onClick={() => fetchAppointments(true)}
            className="p-2.5 text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition cursor-pointer"
            title={t('common.refresh')}
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-rose-50 border-r-4 border-rose-500 p-4 rounded-xl flex items-start gap-3 animate-fade-in">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-rose-800 text-sm font-sans">تنبيه:</h4>
            <p className="text-xs text-rose-700 mt-1 font-sans">{error}</p>
          </div>
        </div>
      )}

      {/* Adding Booking form */}
      {isAdding && (
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.99 }}
          transition={{ duration: 0.2 }}
          className="bg-white rounded-3xl border border-indigo-100 shadow-xl overflow-hidden mb-6"
          dir={isEn ? "ltr" : "rtl"}
        >
          {/* Header */}
          <div className="bg-gradient-to-l from-indigo-900 via-indigo-800 to-slate-900 text-white p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0 shadow-inner">
                <CalendarPlus className="h-6 w-6 text-indigo-300" />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight">{isEn ? 'Book New Consultation or Appointment' : 'حجز موعد كشف أو استشارة جديد'}</h3>
                <p className="text-xs text-indigo-200/80 mt-0.5 font-medium">{isEn ? 'Select patient, schedule visit date & time, and pick medical procedure easily' : 'قم باختيار المريض وتحديد موعد الزيارة ونوع الإجراء الطبي بسهولة'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition text-white/80 hover:text-white cursor-pointer"
              title={isEn ? "Close" : "إغلاق"}
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleAddAppointment} className="p-6 space-y-6">
            {!activeShift && (
              <div className={`bg-amber-50 border border-amber-200/80 rounded-2xl p-4 flex items-start gap-3 shadow-xs ${isEn ? 'text-left' : 'text-right'}`}>
                <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-black text-amber-900">{isEn ? 'Important Alert: No Active Shift Open' : 'تنبيه هام: لا توجد وردية مفتوحة حالياً'}</h4>
                  <p className="text-xs text-amber-800 font-medium leading-relaxed">
                    {isEn ? 'Please open a shift first from Accounts & Shifts to be able to register and save appointments.' : 'برجاء فتح وردية أولاً من قسم الحسابات والورديات لتتمكن من تسجيل وحفظ حجوزات المواعيد.'}
                  </p>
                </div>
              </div>
            )}
            {/* Step 1: Patient Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <User className="h-4 w-4 text-indigo-600" />
                  {isEn ? '1. Patient Selection' : 'أولاً: تحديد بيانات المريض'}
                </span>
                <span className="text-[11px] text-slate-400 font-bold">{isEn ? 'Required *' : 'مطلوب *'}</span>
              </div>

              {/* Patient Type Select Tabs */}
              <div className="grid grid-cols-2 gap-3 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/60">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewPatient(false);
                    setNewPatientName('');
                    setNewPatientPhone('');
                    setNewPatientAge('');
                    setNewPatientMedicalHistory('');
                  }}
                  className={`py-3 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                    !isNewPatient
                      ? 'bg-white text-indigo-700 shadow-sm border border-indigo-100/80'
                      : 'text-slate-600 hover:text-slate-800 hover:bg-white/40'
                  }`}
                >
                  <User className={`h-4 w-4 ${!isNewPatient ? 'text-indigo-600' : 'text-slate-400'}`} />
                  {isEn ? '📁 Existing Clinic Patient' : '📁 اختيار مريض مسجل بالعيادة'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsNewPatient(true);
                    setSelectedPatientId('');
                  }}
                  className={`py-3 px-4 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                    isNewPatient
                      ? 'bg-white text-indigo-700 shadow-sm border border-indigo-100/80'
                      : 'text-slate-600 hover:text-slate-800 hover:bg-white/40'
                  }`}
                >
                  <Sparkles className={`h-4 w-4 ${isNewPatient ? 'text-amber-500' : 'text-slate-400'}`} />
                  {isEn ? '✨ Register New Patient' : '✨ تسجيل مريض جديد وحجز فوري'}
                </button>
              </div>
            </div>


              {/* Row 1: Patient Search / Quick Booking + Date + Time/Turn Side by Side */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-2">
                {!isNewPatient ? (
                  <>
                    {/* Existing Patient Search Select (col-span-6) */}
                    <div className="lg:col-span-6 flex flex-col justify-center">
                      <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 h-full flex flex-col justify-center animate-fade-in">
                        <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                          <User className="h-3.5 w-3.5 text-indigo-600" />
                          {isEn ? 'Search Patient File' : 'ابحث عن ملف المريض بالعيادة'} <span className="text-rose-500">*</span>
                        </label>
                        <PatientSearchSelect
                          patients={patients}
                          selectedPatientId={selectedPatientId}
                          onSelectPatient={setSelectedPatientId}
                          placeholder={isEn ? "Search by patient name or phone..." : "ابحث باسم المريض أو رقم الهاتف..."}
                          required={!isNewPatient}
                        />
                      </div>
                    </div>

                    {/* Date Box (col-span-3) */}
                    <div className="lg:col-span-3 bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center">
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <CalendarIcon className="h-3.5 w-3.5 text-indigo-600" />
                        {isEn ? 'Appointment Date' : 'تاريخ الموعد'}
                      </label>
                      <input
                        type="date"
                        required
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs text-center font-black text-slate-800 shadow-2xs cursor-pointer"
                      />
                    </div>

                    {/* Time OR Turn Box (col-span-3) */}
                    {selectedBookingType === 'turn' ? (
                      <div className="lg:col-span-3 bg-amber-50/80 p-3 rounded-2xl border border-amber-200/80 flex flex-col justify-center animate-fade-in">
                        <label className="block text-[11px] font-black text-amber-900 mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <Ticket className="h-3.5 w-3.5 text-amber-600" />
                            {isEn ? 'Queue / Turn #' : 'رقم الدور بالعيادة'} <span className="text-rose-500">*</span>
                          </span>
                          <span className="text-[9px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-bold">
                            {isEn ? 'Auto' : 'تلقائي'}
                          </span>
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setTurnNumberInput(prev => Math.max(1, Number(prev || 1) - 1))}
                            className="w-8 h-8 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 font-black text-sm flex items-center justify-center transition cursor-pointer shrink-0"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            required
                            value={turnNumberInput}
                            onChange={(e) => setTurnNumberInput(e.target.value)}
                            className="w-full px-2 py-1.5 bg-white border border-amber-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-xs text-center font-black text-amber-950 font-mono shadow-2xs"
                          />
                          <button
                            type="button"
                            onClick={() => setTurnNumberInput(prev => Number(prev || 0) + 1)}
                            className="w-8 h-8 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 font-black text-sm flex items-center justify-center transition cursor-pointer shrink-0"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="lg:col-span-3 bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center animate-fade-in">
                        <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-indigo-600" />
                          {isEn ? 'Appointment Time' : 'توقيت الموعد'}
                        </label>
                        <div className="flex gap-1 items-center" dir="ltr">
                          <select
                            value={parse24To12(appointmentTime).hour12}
                            onChange={(e) => {
                              const { minute, period } = parse24To12(appointmentTime);
                              setAppointmentTime(to24Hour(parseInt(e.target.value, 10), minute, period));
                            }}
                            className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs bg-white font-mono font-bold text-center cursor-pointer shadow-2xs"
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                              <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                            ))}
                          </select>

                          <span className="font-bold text-slate-400 font-mono">:</span>

                          <select
                            value={parse24To12(appointmentTime).minute}
                            onChange={(e) => {
                              const { hour12, period } = parse24To12(appointmentTime);
                              setAppointmentTime(to24Hour(hour12, e.target.value, period));
                            }}
                            className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs bg-white font-mono font-bold text-center cursor-pointer shadow-2xs"
                          >
                            {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>

                          <select
                            value={parse24To12(appointmentTime).period}
                            onChange={(e) => {
                              const { hour12, minute } = parse24To12(appointmentTime);
                              setAppointmentTime(to24Hour(hour12, minute, e.target.value));
                            }}
                            className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-[11px] bg-white font-black text-center cursor-pointer shadow-2xs text-indigo-700"
                          >
                            <option value="ص">{isEn ? 'AM' : 'ص'}</option>
                            <option value="م">{isEn ? 'PM' : 'م'}</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Date Box (col-span-6) for New Patient */}
                    <div className="lg:col-span-6 bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center">
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <CalendarIcon className="h-3.5 w-3.5 text-indigo-600" />
                        {isEn ? 'Appointment Date' : 'تاريخ الموعد'}
                      </label>
                      <input
                        type="date"
                        required
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs text-center font-black text-slate-800 shadow-2xs cursor-pointer"
                      />
                    </div>

                    {/* Time OR Turn Box (col-span-6) for New Patient */}
                    {selectedBookingType === 'turn' ? (
                      <div className="lg:col-span-6 bg-amber-50/80 p-3 rounded-2xl border border-amber-200/80 flex flex-col justify-center animate-fade-in">
                        <label className="block text-[11px] font-black text-amber-900 mb-1 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <Ticket className="h-3.5 w-3.5 text-amber-600" />
                            {isEn ? 'Queue / Turn #' : 'رقم الدور بالعيادة'} <span className="text-rose-500">*</span>
                          </span>
                          <span className="text-[9px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-bold">
                            {isEn ? 'Auto' : 'تلقائي'}
                          </span>
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setTurnNumberInput(prev => Math.max(1, Number(prev || 1) - 1))}
                            className="w-8 h-8 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 font-black text-sm flex items-center justify-center transition cursor-pointer shrink-0"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            required
                            value={turnNumberInput}
                            onChange={(e) => setTurnNumberInput(e.target.value)}
                            className="w-full px-2 py-1.5 bg-white border border-amber-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-xs text-center font-black text-amber-950 font-mono shadow-2xs"
                          />
                          <button
                            type="button"
                            onClick={() => setTurnNumberInput(prev => Number(prev || 0) + 1)}
                            className="w-8 h-8 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 font-black text-sm flex items-center justify-center transition cursor-pointer shrink-0"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="lg:col-span-6 bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center animate-fade-in">
                        <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-indigo-600" />
                          {isEn ? 'Appointment Time' : 'توقيت الموعد'}
                        </label>
                        <div className="flex gap-1 items-center" dir="ltr">
                          <select
                            value={parse24To12(appointmentTime).hour12}
                            onChange={(e) => {
                              const { minute, period } = parse24To12(appointmentTime);
                              setAppointmentTime(to24Hour(parseInt(e.target.value, 10), minute, period));
                            }}
                            className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs bg-white font-mono font-bold text-center cursor-pointer shadow-2xs"
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                              <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                            ))}
                          </select>

                          <span className="font-bold text-slate-400 font-mono">:</span>

                          <select
                            value={parse24To12(appointmentTime).minute}
                            onChange={(e) => {
                              const { hour12, period } = parse24To12(appointmentTime);
                              setAppointmentTime(to24Hour(hour12, e.target.value, period));
                            }}
                            className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs bg-white font-mono font-bold text-center cursor-pointer shadow-2xs"
                          >
                            {['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'].map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>

                          <select
                            value={parse24To12(appointmentTime).period}
                            onChange={(e) => {
                              const { hour12, minute } = parse24To12(appointmentTime);
                              setAppointmentTime(to24Hour(hour12, minute, e.target.value));
                            }}
                            className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-[11px] bg-white font-black text-center cursor-pointer shadow-2xs text-indigo-700"
                          >
                            <option value="ص">{isEn ? 'AM' : 'ص'}</option>
                            <option value="م">{isEn ? 'PM' : 'م'}</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Full Registration Form for New Patient */}
              {isNewPatient && (
                <div className="bg-indigo-50/40 p-4 rounded-2xl border border-indigo-100/90 space-y-3.5 animate-fade-in mt-2">
                  <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                    <h4 className="text-xs font-black text-indigo-900 flex items-center gap-1.5">
                      <User className="h-4 w-4 text-indigo-600" />
                      {isEn ? 'New Patient Registration Details' : 'بيانات تسجيل المريض الجديد كاملة'}
                    </h4>
                    <span className="text-[10px] bg-indigo-100/80 text-indigo-800 font-bold px-2.5 py-0.5 rounded-lg">
                      {isEn ? 'Instant File Creation' : 'تسجيل فوري للملف'}
                    </span>
                  </div>

                  {/* 1. Personal & Demographic Data */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <User className="h-3 w-3 text-indigo-600" />
                        {isEn ? 'Full Patient Name' : 'اسم المريض بالكامل'} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required={isNewPatient}
                        value={newPatientName}
                        onChange={(e) => setNewPatientName(e.target.value)}
                        placeholder={isEn ? "e.g. John Doe" : "مثال: محمد أحمد علي"}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <Phone className="h-3 w-3 text-indigo-600" />
                        {isEn ? 'Mobile Phone' : 'رقم المحمول'} <span className="text-rose-500">*</span>
                        <span className={`text-[9px] text-slate-400 font-normal ${isEn ? 'ml-1' : 'mr-1'}`}>
                          {isEn ? '(11 digits starting with 01)' : '(11 رقم يبدأ بـ 01)'}
                        </span>
                      </label>
                      <input
                        type="tel"
                        required={isNewPatient}
                        maxLength={11}
                        inputMode="numeric"
                        value={newPatientPhone}
                        onChange={(e) => {
                          const val = formatEgyptianPhoneInput(e.target.value);
                          setNewPatientPhone(val);
                          if (!newPatientWhatsappNumber) setNewPatientWhatsappNumber(val);
                        }}
                        placeholder="01012345678"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono text-center font-bold text-slate-800 shadow-2xs"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-black text-slate-700 flex items-center gap-1">
                          <Phone className="h-3 w-3 text-emerald-600" />
                          {isEn ? 'WhatsApp Phone' : 'رقم الواتساب'}
                          <span className={`text-[9px] text-slate-400 font-normal ${isEn ? 'ml-1' : 'mr-1'}`}>
                            {isEn ? '(11 digits)' : '(11 رقم)'}
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setNewPatientWhatsappNumber(newPatientPhone)}
                          className="text-[10px] text-emerald-600 hover:underline font-bold cursor-pointer"
                        >
                          {isEn ? 'Same as phone' : 'نفس الهاتف'}
                        </button>
                      </div>
                      <input
                        type="tel"
                        maxLength={11}
                        inputMode="numeric"
                        value={newPatientWhatsappNumber}
                        onChange={(e) => setNewPatientWhatsappNumber(formatEgyptianPhoneInput(e.target.value))}
                        placeholder={isEn ? "01012345678 (optional)" : "01012345678 (اختياري)"}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono text-center font-bold text-slate-800 shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <User className="h-3 w-3 text-indigo-600" />
                        {isEn ? 'Gender' : 'النوع / الجنس'}
                      </label>
                      <select
                        value={newPatientGender}
                        onChange={(e) => setNewPatientGender(e.target.value as 'ذكر' | 'أنثى')}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs cursor-pointer"
                      >
                        <option value="ذكر">{isEn ? 'Male' : 'ذكر (Male)'}</option>
                        <option value="أنثى">{isEn ? 'Female' : 'أنثى (Female)'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3 text-indigo-600" />
                        {isEn ? 'Age (Years)' : 'العمر / السن (بالسنوات)'}
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="120"
                        value={newPatientAge}
                        onChange={(e) => setNewPatientAge(e.target.value.replace(/\D/g, ''))}
                        placeholder={isEn ? "e.g. 28 (optional)" : "مثال: 28 (اختياري)"}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <User className="h-3 w-3 text-indigo-600" />
                        {isEn ? 'Occupation / Job' : 'الوظيفة / المهنة'}
                      </label>
                      <input
                        type="text"
                        value={newPatientOccupation}
                        onChange={(e) => setNewPatientOccupation(e.target.value)}
                        placeholder={isEn ? "e.g. Engineer, Teacher (optional)..." : "مثال: مهندس، معلم (اختياري)..."}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* 2. العنوان السكني والموقع */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white/80 p-3 rounded-xl border border-slate-200/80">
                    <div>
                      <SearchableSelect
                        label={isEn ? "Governorate" : "المحافظة"}
                        placeholder={isEn ? "Select governorate..." : "اختر المحافظة أو ابحث..."}
                        options={governorateOptions}
                        value={isEn ? translateGovernorate(newPatientGovernorate, true) : translateGovernorate(newPatientGovernorate, false)}
                        onChange={handleGovernorateChange}
                        icon={<MapPin className="h-3.5 w-3.5 text-rose-500" />}
                      />
                    </div>

                    <div>
                      <SearchableSelect
                        label={isEn ? "District / City" : "المركز / المدينة"}
                        placeholder={newPatientGovernorate ? `${isEn ? translateGovernorate(newPatientGovernorate, true) : translateGovernorate(newPatientGovernorate, false)}...` : (isEn ? "Select district/city..." : "اختر المركز...")}
                        options={centerOptions}
                        value={isEn ? translateCenter(newPatientCityOrDistrict, true) : translateCenter(newPatientCityOrDistrict, false)}
                        onChange={(val) => setNewPatientCityOrDistrict(val)}
                        icon={<Building2 className="h-3.5 w-3.5 text-blue-500" />}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-slate-700 mb-1">
                        {isEn ? "Detailed Address (optional)" : "تفاصيل العنوان السكني (يدوي)"}
                      </label>
                      <input
                        type="text"
                        value={newPatientAddress}
                        onChange={(e) => setNewPatientAddress(e.target.value)}
                        placeholder={isEn ? "e.g. Street name, building..." : "مثال: اسم الشارع، رقم العمارة (اختياري)..."}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800 shadow-2xs"
                      />
                    </div>
                  </div>

                  {/* 3. Receptionist Initial Medical Questionnaire */}
                  <div className="space-y-3 bg-white/90 p-3.5 rounded-xl border border-indigo-100 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-1.5 text-xs font-black text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg">
                        <Heart className="h-3.5 w-3.5 text-rose-600" />
                        <span>{isEn ? 'Initial Reception Medical Questionnaire' : 'استبيان موظف الاستقبال الطبي الأولي (قبل دخول المريض للطبيب)'}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-semibold">
                        {isEn ? 'Quick Screening & Alerts' : 'تنبيهات وأسئلة سريعة'}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {activeQuestions.map((q, idx) => {
                        const ans = questionnaireAnswers[q.id] || { answer: 'لا', details: '' };
                        const isYes = ans.answer === 'نعم';

                        return (
                          <div key={q.id} className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="sm:w-2/5">
                              <label className="block text-xs font-bold text-slate-800">
                                {idx + 1}. {q.text}
                              </label>
                              {q.category && (
                                <span className="inline-block mt-0.5 text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                                  {q.category}
                                </span>
                              )}
                            </div>
                            <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              {/* Yes/No Toggle */}
                              <div className="flex bg-slate-200/80 p-0.5 rounded-lg gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setQuestionAnswer(q.id, 'نعم')}
                                  className={`px-3 py-1 rounded-md text-[11px] font-black transition cursor-pointer ${
                                    isYes
                                      ? 'bg-rose-600 text-white shadow-2xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {isEn ? 'Yes' : 'نعم'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setQuestionAnswer(q.id, 'لا', '')}
                                  className={`px-3 py-1 rounded-md text-[11px] font-black transition cursor-pointer ${
                                    !isYes
                                      ? 'bg-emerald-600 text-white shadow-2xs'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {isEn ? 'No' : 'لا'}
                                </button>
                              </div>
                              {/* Details Input */}
                              <input
                                type="text"
                                disabled={!isYes}
                                value={ans.details}
                                onChange={(e) => setQuestionAnswer(q.id, 'نعم', e.target.value)}
                                placeholder={isYes ? (isEn ? "Provide explanation & details (optional)..." : (q.placeholder || "اكتب التوضيح والتفاصيل (اختياري)...")) : (isEn ? "Select (Yes) to enter details" : "حدد (نعم) لإدخال التفاصيل")}
                                className={`w-full px-2.5 py-1.5 border rounded-lg text-xs font-medium transition ${
                                  isYes
                                    ? 'bg-white border-rose-300 text-slate-800 focus:ring-2 focus:ring-rose-500/20'
                                    : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* Reception General Notes */}
                      <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/80">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          {isEn ? 'Reception Notes & Guidelines for Doctor / Nursing' : 'ملاحظات وتوجيهات الاستقبال الخاصة بالطبيب أو التمريض'}
                        </label>
                        <input
                          type="text"
                          value={generalNotes}
                          onChange={(e) => setGeneralNotes(e.target.value)}
                          placeholder={isEn ? "Any special instructions for the doctor or nurse..." : "أي ملاحظة خاصة بالطبيب المعالج أو طاقم التمريض..."}
                          className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium bg-white focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      {/* 4. التاريخ المرضي المبدئي / الملخص الطبي (اختياري) */}
                      <div>
                        <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                          <FileText className="h-3 w-3 text-indigo-600" />
                          {isEn ? 'Initial Medical History / Clinical Summary' : 'التاريخ المرضي المبدئي / الملخص الطبي'} <span className="text-slate-400 font-normal">({isEn ? 'optional' : 'اختياري'})</span>
                        </label>
                        <input
                          type="text"
                          required={false}
                          value={newPatientMedicalHistory}
                          onChange={(e) => setNewPatientMedicalHistory(e.target.value)}
                          placeholder={isEn ? "Summary appears automatically, or type custom text..." : "سيظهر ملخص إجابات الأسئلة أعلاه تلقائياً، أو يمكنك كتابة نص مخصص..."}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Row 2: Visit Type + Price (if new checkup) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
                {/* Visit Type */}
                <div className={`${treatmentType === 'كشف جديد' ? 'lg:col-span-6' : 'lg:col-span-12'} bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center transition-all duration-200`}>
                  <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                    <Stethoscope className="h-3.5 w-3.5 text-indigo-600" />
                    {isEn ? 'Visit / Procedure Type' : 'نوع الإجراء / الزيارة'}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 h-[36px]">
                    <button
                      type="button"
                      onClick={() => {
                        setTreatmentType('كشف جديد');
                        setInitialPrice(clinic.consultationPrice !== undefined && clinic.consultationPrice > 0 ? String(clinic.consultationPrice) : '');
                      }}
                      className={`rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 border cursor-pointer ${
                        treatmentType === 'كشف جديد'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {isEn ? 'New Consultation' : 'كشف جديد'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTreatmentType('استكمال جلسات');
                        setInitialPrice('');
                      }}
                      className={`rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 border cursor-pointer ${
                        treatmentType === 'استكمال جلسات'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {isEn ? 'Follow-up Session' : 'استكمال جلسات'}
                    </button>
                  </div>
                </div>

                {/* Price input (col-span-6) - shown only when 'كشف جديد' is selected */}
                {treatmentType === 'كشف جديد' && (
                  <div className="lg:col-span-6 bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5 text-indigo-600" />
                      {isEn ? 'New Consultation Fee (EGP)' : 'سعر الكشف الجديد (ج.م)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={initialPrice}
                      onChange={(e) => setInitialPrice(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder={isEn ? "Enter fee (e.g. 300)" : "اكتب السعر (مثال: 300)"}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 transition shadow-2xs h-[36px] text-center font-mono"
                    />
                  </div>
                )}
              </div>

            {/* Footer Action Bar */}
            <div className="bg-slate-50/90 -mx-6 -mb-6 p-4 px-6 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3 mt-4">
              <div className="text-xs font-bold text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>{isEn ? 'Selected Booking Date: ' : 'تاريخ الحجز المختار: '}<strong className="text-slate-800 font-mono">{selectedDate}</strong> ({formatTimeTo12Hour(appointmentTime, isEn)})</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-5 py-2.5 text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl text-xs font-black transition shadow-2xs cursor-pointer"
                >
                  {isEn ? 'Cancel' : 'إلغاء'}
                </button>
                <button
                  type="submit"
                  disabled={loading || (!isNewPatient && !selectedPatientId) || (isNewPatient && (!newPatientName || !newPatientPhone))}
                  className="px-6 py-2.5 text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xs font-black transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md shadow-indigo-200 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      {isEn ? 'Saving appointment...' : 'جاري حفظ الموعد...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      {isEn ? 'Confirm & Book Appointment Now' : 'تأكيد وحجز الموعد الآن'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      )}

      {/* Main Grid: Left side Calendar - Right side Day List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Calendar Card (1/3 of screen = col-span-4) */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm lg:col-span-4">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => navigateMonth('prev')}
              className="p-2 hover:bg-slate-50 rounded-xl border border-slate-100 transition cursor-pointer"
            >
              <ChevronRight className="h-5 w-5 text-slate-600 rtl:rotate-0 ltr:rotate-180" />
            </button>
            <h3 className="font-bold text-slate-800 text-lg">
              {monthsList[month]} {year}
            </h3>
            <button
              onClick={() => navigateMonth('next')}
              className="p-2 hover:bg-slate-50 rounded-xl border border-slate-100 transition cursor-pointer"
            >
              <ChevronLeft className="h-5 w-5 text-slate-600 rtl:rotate-0 ltr:rotate-180" />
            </button>
          </div>

          {/* Weekdays */}
          <div className="grid grid-cols-7 text-center mb-2">
            {daysList.map((day) => (
              <div key={day} className="text-xs font-bold text-slate-400 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Month Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((cell, idx) => {
              const pad = (num: number) => String(num).padStart(2, '0');
              const cellIso = `${cell.year}-${pad(cell.month + 1)}-${pad(cell.day)}`;
              const isSelected = selectedDate === cellIso;
              const hasApp = hasAppointments(cell.day, cell.month, cell.year);
              const count = getAppointmentsCount(cell.day, cell.month, cell.year);
              
              // Highlight today's date
              const today = new Date();
              const isToday = today.getDate() === cell.day && today.getMonth() === cell.month && today.getFullYear() === cell.year;

              return (
                <button
                  key={`${cell.year}-${cell.month}-${cell.day}-${idx}`}
                  onClick={() => handleSelectDate(cellIso)}
                  className={`min-h-[72px] p-2 flex flex-col justify-between rounded-xl border transition relative ${
                    cell.isCurrentMonth ? 'bg-white hover:bg-slate-50/70 border-slate-100' : 'bg-slate-50/40 text-slate-300 border-transparent'
                  } ${isSelected ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-50/20' : ''} ${
                    isToday ? 'bg-amber-50/30 border-amber-300' : ''
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${
                      isToday ? 'bg-amber-100 text-amber-800' : isSelected ? 'text-indigo-600' : 'text-slate-600'
                    }`}>
                      {cell.day}
                    </span>
                    {count > 0 && (
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1 rounded font-black">
                        {count}
                      </span>
                    )}
                  </div>
                  {hasApp && (
                    <div className="w-full flex flex-col gap-0.5 mt-1">
                      <div className="w-full h-1 bg-indigo-500 rounded-full"></div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Side: Two separated containers (Col span 8) */}
        <div className="lg:col-span-8 flex flex-col space-y-4">
          {/* Container 1: Date Header & Daily Financials Summary */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-slate-800 text-lg flex items-center gap-2 flex-wrap">
                  <Clock className="h-5 w-5 text-indigo-500" />
                  {t('calendar.appointmentsFor')}: <span className="text-indigo-600 font-mono">{selectedDate}</span>
                  {selectedDate === todayStr && (
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-lg font-black border border-emerald-200">{t('calendar.today')}</span>
                  )}
                  {selectedDate === getYesterdayStr() && (
                    <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-lg font-black border border-amber-200">{t('calendar.yesterday')}</span>
                  )}
                  {selectedDate === getTomorrowStr() && (
                    <span className="text-[11px] bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-lg font-black border border-indigo-200">{t('calendar.tomorrow')}</span>
                  )}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {clinicBookingMode === 'turn'
                    ? (isEn ? 'Daily table ordered by queue numbers and revenue stats' : 'جدول اليوم يعرض المواعيد المرتبة بـ أرقام الأدوار وإحصائيات التحصيل')
                    : clinicBookingMode === 'time'
                    ? (isEn ? 'Daily table ordered by appointment time and revenue stats' : 'جدول اليوم يعرض المواعيد المرتبة بـ الساعات والتوقيت وإحصائيات التحصيل')
                    : (isEn ? 'Daily table ordered by time & queue and revenue stats' : 'جدول اليوم يعرض المواعيد المرتبة بالساعة والدور وإحصائيات التحصيل')}
                </p>
              </div>

              {/* Quick Date Selector Bar */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const parts = todayStr.split('-').map(Number);
                    const d = new Date(parts[0], parts[1] - 1, parts[2]);
                    d.setDate(d.getDate() - 1);
                    const pad = (num: number) => String(num).padStart(2, '0');
                    handleSelectDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1 ${
                    selectedDate === (() => {
                      const parts = todayStr.split('-').map(Number);
                      const d = new Date(parts[0], parts[1] - 1, parts[2]);
                      d.setDate(d.getDate() - 1);
                      const pad = (num: number) => String(num).padStart(2, '0');
                      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                    })()
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {t('calendar.yesterday')}
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDate(todayStr)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1 ${
                    selectedDate === todayStr
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {t('calendar.today')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const parts = todayStr.split('-').map(Number);
                    const d = new Date(parts[0], parts[1] - 1, parts[2]);
                    d.setDate(d.getDate() + 1);
                    const pad = (num: number) => String(num).padStart(2, '0');
                    handleSelectDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1 ${
                    selectedDate === (() => {
                      const parts = todayStr.split('-').map(Number);
                      const d = new Date(parts[0], parts[1] - 1, parts[2]);
                      d.setDate(d.getDate() + 1);
                      const pad = (num: number) => String(num).padStart(2, '0');
                      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                    })()
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {t('calendar.tomorrow')}
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleSelectDate(e.target.value)}
                  className="px-2.5 py-1 rounded-xl text-xs font-black bg-slate-50 border border-slate-200 hover:bg-white text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs font-mono"
                  title={t('calendar.filterDate')}
                />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs bg-indigo-50 text-indigo-700 font-extrabold px-2.5 py-1 rounded-xl border border-indigo-200/80">
                  📅 {selectedDayAppointments.filter(app => app.status === 'scheduled').length} {isEn ? 'Scheduled' : 'غير مؤكد'}
                </span>
                <span className="text-xs bg-amber-50 text-amber-700 font-extrabold px-2.5 py-1 rounded-xl border border-amber-200/80">
                  ⏳ {selectedDayAppointments.filter(app => app.status === 'waiting').length} {isEn ? 'Waiting' : 'في الانتظار'}
                </span>
                <span className="text-xs bg-emerald-50 text-emerald-700 font-extrabold px-2.5 py-1 rounded-xl border border-emerald-200/80">
                  ✓ {selectedDayAppointments.filter(app => app.status === 'completed').length} {isEn ? 'Completed' : 'مكتمل'}
                </span>
              </div>
            </div>

            {/* Daily Revenue Summary Box */}
            <div className="bg-gradient-to-br from-indigo-50/50 via-emerald-50/30 to-slate-50/80 border border-slate-200/60 rounded-xl p-3.5 flex flex-col gap-2.5 shadow-2xs">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
                {isEn ? "Today's Revenue & Collections" : 'الإيرادات والتحصيل لليوم'}
              </span>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-bold">{isEn ? 'Total:' : 'الإجمالي:'}</span>
                  <span className="text-sm sm:text-base font-black text-indigo-600 font-mono">
                    {dailyTotalOverall.toLocaleString()} <span className="text-xs font-normal text-slate-400">{isEn ? 'EGP' : 'ج.م'}</span>
                  </span>
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-bold">{isEn ? 'Paid:' : 'المدفوع:'}</span>
                  <span className="text-sm sm:text-base font-black text-emerald-600 font-mono">
                    {dailyTotalPaid.toLocaleString()} <span className="text-xs font-normal text-slate-400">{isEn ? 'EGP' : 'ج.م'}</span>
                  </span>
                </div>

                <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-bold">{isEn ? 'Remaining / Pending:' : 'الآجل:'}</span>
                  <span className="text-sm sm:text-base font-black text-amber-600 font-mono">
                    {dailyTotalRemaining.toLocaleString()} <span className="text-xs font-normal text-slate-400">{isEn ? 'EGP' : 'ج.م'}</span>
                  </span>
                </div>
              </div>

              {/* Payment Methods Breakdown */}
              <div className="border-t border-slate-200/50 pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-500">{isEn ? "Today's Collection Methods (Paid):" : 'تفصيل طرق تحصيل اليوم (المدفوع):'}</span>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                  {activeMethodsList.map((method, idx) => {
                    const amt = dailyPaymentMethods[method] || 0;
                    return (
                      <div key={idx} className="flex items-center justify-between sm:justify-start gap-1.5 bg-slate-50/80 px-2.5 py-1 rounded-lg border border-slate-200/60 text-slate-600 shadow-3xs">
                        <span className="text-[10px] font-bold">
                          {method === 'كاش' ? '💵' : method === 'فيزا' ? '💳' : method === 'إنستاباي' ? '⚡' : method === 'محفظة' ? '📱' : '💼'} {formatPaymentMethodName(method, isEn)}:
                        </span>
                        <span className="text-xs font-black text-slate-700 font-mono">{(amt).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Container 2: Dedicated Appointments Cards Container with scroll */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col flex-1">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center justify-between xl:justify-start gap-3 flex-wrap">
                <h4 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500"></span>
                  {isEn ? 'Registered Appointment Cards' : 'بطاقات المواعيد المسجلة'}
                </h4>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                  {filteredDayAppointments.length} {isEn ? 'of' : 'من'} {selectedDayAppointments.length}
                </span>
              </div>

              {/* Filters & Search Controls */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
                {/* Search Input */}
                <div className="relative min-w-[200px] flex-1 sm:flex-initial">
                  <Search className={`h-3.5 w-3.5 text-slate-400 absolute ${isEn ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2`} />
                  <input
                    type="text"
                    placeholder={isEn ? "Search by name or phone..." : "بحث بالاسم أو الهاتف..."}
                    value={appSearchQuery}
                    onChange={(e) => setAppSearchQuery(e.target.value)}
                    className={`w-full ${isEn ? 'pl-8 pr-7' : 'pl-7 pr-8'} py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all`}
                  />
                  {appSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setAppSearchQuery('')}
                      className={`absolute ${isEn ? 'right-2.5' : 'left-2.5'} top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold`}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Status Filter Tabs */}
                <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl text-xs overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setAppStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-all ${
                      appStatusFilter === 'all' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {isEn ? 'All' : 'الكل'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppStatusFilter('waiting')}
                    className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      appStatusFilter === 'waiting' ? 'bg-white text-amber-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"></span>
                    {isEn ? 'Waiting' : 'تم الحضور (انتظار)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppStatusFilter('completed')}
                    className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      appStatusFilter === 'completed' ? 'bg-white text-emerald-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                    {isEn ? 'Completed' : 'مكتمل'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppStatusFilter('scheduled')}
                    className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                      appStatusFilter === 'scheduled' ? 'bg-white text-indigo-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                    {isEn ? 'Scheduled' : 'غير مؤكد'}
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto overflow-x-auto max-h-[520px] pr-1.5 pb-2">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start items-start">
              {loading && appointments.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-400">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                {isEn ? 'Loading...' : 'جاري التحميل...'}
              </div>
            ) : selectedDayAppointments.length === 0 ? (
              <div className="col-span-full p-12 text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                <CalendarIcon className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-500">{isEn ? 'No appointments booked for this day' : 'لا توجد مواعيد محجوزة في هذا اليوم'}</p>
                <p className="text-xs text-slate-400 mt-1">{isEn ? 'Click "Book New Appointment" to add a patient for this day.' : 'يمكنك الضغط على "حجز موعد جديد" لإضافة مريض لهذا اليوم.'}</p>
              </div>
            ) : filteredDayAppointments.length === 0 ? (
              <div className="col-span-full p-10 text-center text-slate-400 border border-slate-100 rounded-2xl bg-slate-50/50">
                <Search className="h-6 w-6 mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-500">{isEn ? 'No appointments match the current search or filter' : 'لا توجد مواعيد تطابق البحث أو الفلتر الحالي'}</p>
                <button
                  type="button"
                  onClick={() => { setAppStatusFilter('all'); setAppSearchQuery(''); }}
                  className="mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 underline"
                >
                  {isEn ? 'Reset search and filters' : 'إعادة ضبط البحث والفلتر'}
                </button>
              </div>
            ) : (
              sortedFilteredDayAppointments.map((app) => {
                const turnIndex = app.status?.toLowerCase() !== 'cancelled'
                  ? activeAppointments.findIndex(a => a.id === app.id)
                  : -1;
                const turnNumber = turnIndex !== -1 ? turnIndex + 1 : null;

                return (
                  <div
                    key={app.id}
                    className={`p-4 rounded-2xl border-2 transition-all duration-200 flex flex-col justify-between gap-3 relative overflow-hidden self-start h-fit min-w-[270px] ${
                      app.status === 'completed' 
                        ? 'bg-gradient-to-l from-emerald-50/40 via-white to-white border-emerald-400 shadow-sm' 
                        : app.status === 'waiting'
                        ? 'bg-gradient-to-l from-amber-50/40 via-white to-white border-amber-400 shadow-sm'
                        : app.status === 'cancelled' 
                        ? 'bg-slate-50/60 border-slate-300 text-slate-400 opacity-75' 
                        : 'bg-white border-blue-400 hover:border-blue-500 hover:shadow-md shadow-sm'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Top row: Name, Turn number, and Edit Patient button */}
                      <div className="flex justify-between items-center gap-2 border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            app.status === 'completed' ? 'bg-emerald-500' : app.status === 'waiting' ? 'bg-amber-500 animate-pulse' : app.status === 'cancelled' ? 'bg-slate-400' : 'bg-indigo-500'
                          }`}></span>
                          {turnNumber && (
                            <span className="bg-indigo-600 text-white font-bold text-[10px] px-1.5 py-0.5 rounded shrink-0">
                              {isEn ? `Turn #${turnNumber}` : `دور ${turnNumber}`}
                            </span>
                          )}
                          <h4 className={`text-base font-black truncate ${app.status === 'cancelled' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                            {app.patientName}
                          </h4>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditPatientModal(app);
                            }}
                            className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition shrink-0 cursor-pointer"
                            title={isEn ? "Edit Patient Data" : "تعديل بيانات المريض"}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                    {/* Second row: Financials, Medical File buttons, and Appointment Time */}
                    <div className="flex items-center justify-between gap-1.5 w-full flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFinancialModalPatient({
                              id: app.patientId,
                              name: app.patientName,
                              phone: app.patientPhone
                            });
                          }}
                          className="text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-xl transition border border-amber-200/80 flex items-center gap-1 text-xs font-bold shadow-2xs cursor-pointer whitespace-nowrap"
                          title={isEn ? "Patient Financials & Accounts" : "المالية والحسابات التابعة للمريض"}
                        >
                          <Coins className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>{isEn ? 'Financials' : 'الماليات'}</span>
                        </button>
                        {onOpenMedicalFile && app.patientId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenMedicalFile(app.patientId);
                            }}
                            className="text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-xl transition border border-emerald-200/80 flex items-center gap-1 text-xs font-bold shadow-2xs cursor-pointer whitespace-nowrap"
                            title={isEn ? "Patient Medical File" : "الملف الطبي للمريض"}
                          >
                            <FileText className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                            <span>{isEn ? 'File' : 'الملف'}</span>
                          </button>
                        )}
                      </div>
                      {clinicBookingMode === 'turn' || app.bookingType === 'turn' ? (
                        <span className="text-xs font-black bg-amber-50/90 border border-amber-200/80 px-2 py-1 rounded-xl text-amber-900 flex items-center gap-1 shrink-0 shadow-2xs font-mono whitespace-nowrap" title={isEn ? "Turn booking" : "حجز بالدور والرقم"}>
                          <Ticket className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          <span>{isEn ? `Turn #${app.turnNumber || turnNumber}` : `دور #${app.turnNumber || turnNumber}`}</span>
                        </span>
                      ) : (
                        <span className="text-xs font-black bg-indigo-50/90 border border-indigo-200/80 px-2 py-1 rounded-xl text-indigo-700 flex items-center gap-1 shrink-0 shadow-2xs font-mono whitespace-nowrap" title={isEn ? "Appointment time" : "توقيت الموعد"}>
                          <Clock className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                          <span>{formatTimeTo12Hour(app.time, isEn)}</span>
                          {app.turnNumber ? <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1 py-0.2 rounded mr-0.5">#{app.turnNumber}</span> : null}
                        </span>
                      )}
                    </div>

                    {/* Visit / Procedure Details: Summary or Full Table */}
                    <div className="procedure-table-container">
                    {expandedProcedureAppIds[app.id] ? (
                      <div className="bg-slate-50/90 rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xs animate-fade-in">
                        {/* Header bar */}
                        <div className="bg-slate-100/90 px-3.5 py-2 border-b border-slate-200/80 flex items-center justify-between">
                          <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                            <Stethoscope className="h-3.5 w-3.5 text-indigo-600" />
                            {isEn ? 'Procedures & Services' : 'جدول الإجراءات والخدمات'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {app.status === 'completed' && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded-md border border-emerald-200/60">
                                {isEn ? 'Completed ✓' : 'مكتمل ✓'}
                              </span>
                            )}
                            {app.status === 'waiting' && (
                              <span className="text-[10px] bg-amber-100 text-amber-800 font-black px-2 py-0.5 rounded-md border border-amber-200/60">
                                {isEn ? 'Waiting ⏳' : 'انتظار ⏳'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleProcedures(app.id);
                              }}
                              className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition flex items-center justify-center cursor-pointer"
                              title={isEn ? "Close table" : "إغلاق الجدول"}
                            >
                              <EyeOff className="h-3.5 w-3.5 text-slate-700" />
                            </button>
                          </div>
                        </div>

                        {/* Table rows */}
                        <div className="divide-y divide-slate-200/60 bg-white/70">
                          {resolveProcedureBreakdown(app).map((proc, idx) => (
                            <div key={idx} className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
                                <span className="font-bold text-slate-800 leading-snug">
                                  {formatProcedureName(proc.name, isEn)}
                                </span>
                                {proc.tooth && !proc.name.includes('كشف') && !proc.name.includes('استكمال') && !proc.name.includes(`#${proc.tooth}`) && !proc.name.includes(`ضرس ${proc.tooth}`) && (
                                  <ToothBadge tooth={proc.tooth} size="sm" />
                                )}
                              </div>
                              <span className="font-mono font-black text-slate-800 shrink-0 bg-white px-2 py-0.5 rounded-lg border border-slate-200/70 shadow-2xs">
                                {proc.price || proc.name === 'كشف جديد' ? `${(proc.price || 0).toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}` : (isEn ? 'Free / Included' : 'مجاني / شامل')}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Total Row */}
                        <div className="bg-indigo-50/70 px-3.5 py-2 border-t border-indigo-100/80 flex items-center justify-between text-xs">
                          <span className="font-black text-indigo-950 flex items-center gap-1">
                            {isEn ? '💰 Total Cost:' : '💰 إجمالي التكلفة:'}
                          </span>
                          <span className="font-mono font-black text-indigo-700 text-sm">
                            {((app.price !== undefined ? app.price : (app.cost || 0))).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                          </span>
                        </div>

                        {/* Notes if present */}
                        {app.notes && (
                          <div className="px-3.5 py-2 border-t border-slate-200/60 bg-amber-50/50 text-slate-700 text-xs leading-relaxed flex items-start gap-1.5">
                            <span className="text-amber-700 font-bold shrink-0">{isEn ? '📝 Notes: ' : '📝 ملاحظات: '}</span>
                            <span className="font-medium">{app.notes}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Compact Summary Bar when collapsed: Word 'Procedures' / 'الإجراءات', Total Box, then Eye icon */
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleProcedures(app.id);
                        }}
                        className="bg-slate-50/90 hover:bg-indigo-50/60 p-2.5 rounded-xl border border-slate-200/80 flex items-center justify-between text-xs cursor-pointer transition-all duration-150 group"
                        title={isEn ? "Click to view procedures details" : "انقر لعرض جدول الإجراءات التفصيلي"}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Stethoscope className="h-3.5 w-3.5 text-indigo-600 shrink-0 group-hover:scale-110 transition-transform" />
                          <span className="font-extrabold text-slate-800 text-xs">{isEn ? 'Procedures' : 'الإجراءات'}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center gap-1 font-mono font-black text-indigo-700 text-xs bg-white px-2.5 py-1 rounded-lg border border-slate-200/80 shadow-2xs">
                            <span className="text-[10px] text-slate-500 font-sans font-bold">{isEn ? 'Total:' : 'الإجمالي:'}</span>
                            <span>{((app.price !== undefined ? app.price : (app.cost || 0))).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                          </div>
                          <span className="text-xs font-bold text-indigo-600 group-hover:text-indigo-800 bg-indigo-50 group-hover:bg-indigo-100 p-1.5 rounded-lg border border-indigo-200/60 transition flex items-center justify-center" title={isEn ? "View procedures details" : "عرض تفاصيل الإجراءات"}>
                            <Eye className="h-4 w-4 text-indigo-600" />
                          </span>
                        </div>
                      </div>
                    )}
                    </div>
                  </div>

                  {/* Action buttons - All on 1 single row */}
                  <div className="border-t border-slate-100 pt-2.5 mt-1 flex items-center justify-between gap-1.5">
                    {/* Main Status / Confirm Attendance Action */}
                    {app.status === 'scheduled' && (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(app.id, 'waiting')}
                          className="flex-1 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white shadow-2xs cursor-pointer text-xs py-1.5 px-2 rounded-xl font-bold transition flex items-center justify-center gap-1 truncate"
                          title={isEn ? "Confirm attendance and move to waiting" : "تأكيد حضور المريض للعيادة وتحويل الموعد لانتظار"}
                        >
                          <span className="truncate">{isEn ? '⏳ Confirm Arrival' : '⏳ تأكيد الحضور'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(app.id, 'cancelled')}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-500 text-[10px] px-2 py-1.5 rounded-xl font-bold transition shrink-0 cursor-pointer"
                          title={isEn ? "Cancel appointment" : "إلغاء الموعد"}
                        >
                          {isEn ? 'Cancel' : 'إلغاء'}
                        </button>
                      </div>
                    )}

                    {app.status === 'waiting' && (
                      <div className="flex-1 min-w-0 bg-amber-50/90 border border-amber-300 text-amber-900 text-xs py-1 px-2 rounded-xl font-bold flex items-center justify-between gap-1 shadow-2xs">
                        <span className="flex items-center gap-1 truncate text-[11px]">
                          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0"></span>
                          <span className="truncate">{isEn ? 'Waiting' : 'في الانتظار'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(app.id, 'completed')}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] px-2 py-0.5 rounded-lg font-bold transition cursor-pointer shrink-0"
                          title={isEn ? "Confirm completion" : "تأكيد إتمام الموعد"}
                        >
                          {isEn ? 'Complete ✓' : 'إتمام ✓'}
                        </button>
                      </div>
                    )}

                    {app.status === 'completed' && (
                      <div className="flex-1 min-w-0 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] py-1.5 px-2 rounded-xl font-bold flex items-center justify-center gap-1 shrink-0">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">{isEn ? 'Completed ✓' : 'مكتمل ✓'}</span>
                      </div>
                    )}

                    {app.status === 'cancelled' && (
                      <div className="flex-1 min-w-0 bg-slate-100 border border-slate-200 text-slate-500 text-[11px] py-1.5 px-2 rounded-xl font-bold text-center truncate">
                        {isEn ? '✕ Cancelled' : '✕ ملغى'}
                      </div>
                    )}

                    {/* WhatsApp Reminder Button */}
                    <button
                      type="button"
                      onClick={() => sendWhatsAppReminder(app)}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs px-2.5 py-1.5 rounded-xl font-bold transition border border-emerald-200/80 flex items-center gap-1 shrink-0 cursor-pointer"
                      title={isEn ? "Send appointment reminder" : "إرسال رسالة تذكير بالموعد"}
                    >
                      <Send className="h-3 w-3 text-emerald-600" />
                      <span className="hidden xs:inline">{isEn ? 'Reminder' : 'تذكير'}</span> {isEn ? 'WhatsApp' : 'واتساب'}
                    </button>

                    {/* Delete Appointment Button */}
                    {!isStaff && (
                      <div className="shrink-0 flex items-center">
                        {deletingAppointmentId === app.id ? (
                          <div className="flex items-center gap-1 bg-rose-50 p-0.5 rounded-xl border border-rose-200 animate-fade-in">
                            <button
                              type="button"
                              onClick={() => {
                                handleDeleteAppointment(app.id);
                                setDeletingAppointmentId(null);
                              }}
                              className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] px-2 py-1 rounded-lg font-bold transition cursor-pointer"
                            >
                              {isEn ? 'Delete' : 'حذف'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingAppointmentId(null)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] px-1.5 py-1 rounded-lg font-bold transition cursor-pointer"
                            >
                              {isEn ? 'Cancel' : 'إلغاء'}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeletingAppointmentId(app.id)}
                            className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-xl transition cursor-pointer flex items-center justify-center"
                            title={isEn ? "Delete appointment permanently" : "حذف الموعد نهائياً"}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })
            )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {financialModalPatient && (
        <PatientFinancialsModal
          isOpen={!!financialModalPatient}
          onClose={() => {
            setFinancialModalPatient(null);
            fetchAppointments(true);
            if (onRefreshAppointments) {
              onRefreshAppointments(true, selectedDate, true);
            }
          }}
          clinicId={clinic.id}
          patientId={financialModalPatient.id}
          patientName={financialModalPatient.name}
          patientPhone={financialModalPatient.phone}
          onNavigateToFullFile={onOpenPatientFinancials || onOpenMedicalFile}
          paymentMethods={clinic.paymentMethods}
          activeShiftDate={activeShift?.date}
          activeShiftId={activeShift?.id}
          activeShift={activeShift}
        />
      )}

      {/* Edit Patient Modal */}
      {editingPatientModalData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in" dir={isEn ? "ltr" : "rtl"}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full overflow-hidden flex flex-col my-8">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-indigo-700 to-blue-800 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-xl">
                  <User className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-black text-base">{isEn ? 'Edit Patient Data & Reception Questionnaire' : 'تعديل بيانات المريض واستبيان الاستقبال'}</h3>
                  <p className="text-xs text-indigo-100 font-medium">
                    {isEn ? 'Edit personal details, address, and medical questionnaire' : 'تعديل البيانات الشخصية، العنوان، والأسئلة الطبية للمريض'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPatientModalData(null)}
                className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
                title={isEn ? "Close" : "إغلاق"}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 max-h-[78vh] overflow-y-auto">
              <div className="space-y-3.5 bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/80">
                <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                  <div className="flex items-center gap-2 text-xs font-black text-indigo-900">
                    <User className="h-4 w-4 text-indigo-600" />
                    <span>{isEn ? 'Edit Patient Data & Initial Reception Questionnaire' : 'تعديل بيانات المريض والاستبيان الطبي الأولي (قبل دخول المريض للطبيب)'}</span>
                  </div>
                </div>

                {/* 1. البيانات الشخصية والديموغرافية */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                      <User className="h-3 w-3 text-indigo-600" />
                      {isEn ? 'Full Patient Name' : 'اسم المريض بالكامل'} <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={editingPatientModalData.name}
                      onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, name: e.target.value })}
                      placeholder={isEn ? "e.g. John Doe" : "مثال: محمد أحمد علي"}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                      <Phone className="h-3 w-3 text-indigo-600" />
                      {isEn ? 'Mobile Phone' : 'رقم المحمول'} <span className="text-rose-500">*</span>
                      <span className={`text-[9px] text-slate-400 font-normal ${isEn ? 'ml-1' : 'mr-1'}`}>
                        {isEn ? '(11 digits starting with 01)' : '(11 رقم يبدأ بـ 01)'}
                      </span>
                    </label>
                    <input
                      type="tel"
                      required
                      maxLength={11}
                      inputMode="numeric"
                      value={editingPatientModalData.phone}
                      onChange={(e) => {
                        const val = formatEgyptianPhoneInput(e.target.value);
                        setEditingPatientModalData({
                          ...editingPatientModalData,
                          phone: val,
                          whatsappNumber: editingPatientModalData.whatsappNumber || val
                        });
                      }}
                      placeholder="01012345678"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono text-center font-bold text-slate-800 shadow-2xs"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-black text-slate-700 flex items-center gap-1">
                        <Phone className="h-3 w-3 text-emerald-600" />
                        {isEn ? 'WhatsApp Phone' : 'رقم الواتساب'}
                        <span className={`text-[9px] text-slate-400 font-normal ${isEn ? 'ml-1' : 'mr-1'}`}>
                          {isEn ? '(11 digits)' : '(11 رقم)'}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setEditingPatientModalData({ ...editingPatientModalData, whatsappNumber: editingPatientModalData.phone })}
                        className="text-[10px] text-emerald-600 hover:underline font-bold cursor-pointer"
                      >
                        {isEn ? 'Same as phone' : 'نفس الهاتف'}
                      </button>
                    </div>
                    <input
                      type="tel"
                      maxLength={11}
                      inputMode="numeric"
                      value={editingPatientModalData.whatsappNumber}
                      onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, whatsappNumber: formatEgyptianPhoneInput(e.target.value) })}
                      placeholder={isEn ? "01012345678 (optional)" : "01012345678 (اختياري)"}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-mono text-center font-bold text-slate-800 shadow-2xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                      <User className="h-3 w-3 text-indigo-600" />
                      {isEn ? 'Gender' : 'النوع / الجنس'}
                    </label>
                    <select
                      value={editingPatientModalData.gender}
                      onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, gender: e.target.value as 'ذكر' | 'أنثى' })}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs cursor-pointer"
                    >
                      <option value="ذكر">{isEn ? 'Male' : 'ذكر (Male)'}</option>
                      <option value="أنثى">{isEn ? 'Female' : 'أنثى (Female)'}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                      <CalendarIcon className="h-3 w-3 text-indigo-600" />
                      {isEn ? 'Age (Years)' : 'العمر / السن (بالسنوات)'}
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="120"
                      value={editingPatientModalData.age}
                      onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, age: e.target.value.replace(/\D/g, '') })}
                      placeholder={isEn ? "e.g. 28 (optional)" : "مثال: 28 (اختياري)"}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                      <User className="h-3 w-3 text-indigo-600" />
                      {isEn ? 'Occupation / Job' : 'الوظيفة / المهنة'}
                    </label>
                    <input
                      type="text"
                      value={editingPatientModalData.occupation}
                      onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, occupation: e.target.value })}
                      placeholder={isEn ? "e.g. Engineer, Teacher (optional)..." : "مثال: مهندس، معلم (اختياري)..."}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                    />
                  </div>
                </div>

                {/* 2. العنوان السكني والموقع */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-white/80 p-3 rounded-xl border border-slate-200/80">
                  <div>
                    <SearchableSelect
                      label={isEn ? "Governorate" : "المحافظة"}
                      placeholder={isEn ? "Select governorate..." : "اختر المحافظة أو ابحث..."}
                      options={governorateOptions}
                      value={isEn ? translateGovernorate(editingPatientModalData.governorate, true) : translateGovernorate(editingPatientModalData.governorate, false)}
                      onChange={(val) => {
                        const govObj = EGYPT_GOVERNORATES.find(g => g.name === val || g.nameEn.toLowerCase() === val.toLowerCase());
                        const defaultCity = govObj && govObj.centers.length > 0 
                          ? (isEn ? govObj.centersEn[0] : govObj.centers[0]) 
                          : '';
                        setEditingPatientModalData({
                          ...editingPatientModalData,
                          governorate: val,
                          cityOrDistrict: defaultCity
                        });
                      }}
                      icon={<MapPin className="h-3.5 w-3.5 text-rose-500" />}
                    />
                  </div>

                  <div>
                    <SearchableSelect
                      label={isEn ? "District / City" : "المركز / المدينة"}
                      placeholder={editingPatientModalData.governorate ? `${isEn ? translateGovernorate(editingPatientModalData.governorate, true) : translateGovernorate(editingPatientModalData.governorate, false)}...` : (isEn ? "Select district/city..." : "اختر المركز...")}
                      options={
                        (() => {
                          const gov = EGYPT_GOVERNORATES.find(g => g.name === editingPatientModalData.governorate || g.nameEn.toLowerCase() === editingPatientModalData.governorate?.toLowerCase());
                          if (gov) return isEn ? gov.centersEn : gov.centers;
                          return EGYPT_GOVERNORATES.flatMap(g => isEn ? g.centersEn : g.centers);
                        })()
                      }
                      value={isEn ? translateCenter(editingPatientModalData.cityOrDistrict, true) : translateCenter(editingPatientModalData.cityOrDistrict, false)}
                      onChange={(val) => setEditingPatientModalData({ ...editingPatientModalData, cityOrDistrict: val })}
                      icon={<Building2 className="h-3.5 w-3.5 text-blue-500" />}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-black text-slate-700 mb-1">
                      {isEn ? "Detailed Address (optional)" : "تفاصيل العنوان السكني (يدوي)"}
                    </label>
                    <input
                      type="text"
                      value={editingPatientModalData.address}
                      onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, address: e.target.value })}
                      placeholder={isEn ? "e.g. Street name, building (optional)..." : "مثال: اسم الشارع، رقم العمارة (اختياري)..."}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-medium text-slate-800 shadow-2xs"
                    />
                  </div>
                </div>

                {/* 3. استبيان موظف الاستقبال الطبي الأولي */}
                <div className="space-y-3 bg-white/90 p-3.5 rounded-xl border border-indigo-100 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg">
                      <Heart className="h-3.5 w-3.5 text-rose-600" />
                      <span>{isEn ? 'Initial Reception Medical Questionnaire' : 'استبيان موظف الاستقبال الطبي الأولي (قبل دخول المريض للطبيب)'}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-semibold">
                      {isEn ? 'Quick Screening & Alerts' : 'تنبيهات وأسئلة سريعة'}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {activeQuestions.map((q, idx) => {
                      const ans = editingPatientModalData.questionnaireAnswers?.[q.id] || { answer: 'لا', details: '' };
                      const isYes = ans.answer === 'نعم';

                      return (
                        <div key={q.id} className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="sm:w-2/5">
                            <label className="block text-xs font-bold text-slate-800">
                              {idx + 1}. {q.text}
                            </label>
                            {q.category && (
                              <span className="inline-block mt-0.5 text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                                {q.category}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            {/* Yes/No Toggle */}
                            <div className="flex bg-slate-200/80 p-0.5 rounded-lg gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = {
                                    ...editingPatientModalData.questionnaireAnswers,
                                    [q.id]: { answer: 'نعم' as const, details: ans.details || '' }
                                  };
                                  setEditingPatientModalData({ ...editingPatientModalData, questionnaireAnswers: updated });
                                }}
                                className={`px-3 py-1 rounded-md text-[11px] font-black transition cursor-pointer ${
                                  isYes
                                    ? 'bg-rose-600 text-white shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {isEn ? 'Yes' : 'نعم'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = {
                                    ...editingPatientModalData.questionnaireAnswers,
                                    [q.id]: { answer: 'لا' as const, details: '' }
                                  };
                                  setEditingPatientModalData({ ...editingPatientModalData, questionnaireAnswers: updated });
                                }}
                                className={`px-3 py-1 rounded-md text-[11px] font-black transition cursor-pointer ${
                                  !isYes
                                    ? 'bg-emerald-600 text-white shadow-2xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {isEn ? 'No' : 'لا'}
                              </button>
                            </div>
                            {/* Details Input */}
                            <input
                              type="text"
                              disabled={!isYes}
                              value={ans.details}
                              onChange={(e) => {
                                const updated = {
                                  ...editingPatientModalData.questionnaireAnswers,
                                  [q.id]: { answer: 'نعم' as const, details: e.target.value }
                                };
                                setEditingPatientModalData({ ...editingPatientModalData, questionnaireAnswers: updated });
                              }}
                              placeholder={isYes ? (isEn ? "Provide explanation & details (optional)..." : (q.placeholder || "اكتب التوضيح والتفاصيل (اختياري)...")) : (isEn ? "Select (Yes) to enter details" : "حدد (نعم) لإدخال التفاصيل")}
                              className={`w-full px-2.5 py-1.5 border rounded-lg text-xs font-medium transition ${
                                isYes
                                  ? 'bg-white border-rose-300 text-slate-800 focus:ring-2 focus:ring-rose-500/20'
                                  : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                              }`}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Reception General Notes */}
                    <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/80">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        {isEn ? 'Reception Notes & Guidelines for Doctor / Nursing' : 'ملاحظات وتوجيهات الاستقبال الخاصة بالطبيب أو التمريض'}
                      </label>
                      <input
                        type="text"
                        value={editingPatientModalData.generalNotes}
                        onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, generalNotes: e.target.value })}
                        placeholder={isEn ? "Any special instructions for the doctor or nurse..." : "أي ملاحظة خاصة بالطبيب المعالج أو طاقم التمريض..."}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium bg-white focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>

                    {/* 4. التاريخ المرضي المبدئي / الملخص الطبي (اختياري) */}
                    <div>
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <FileText className="h-3 w-3 text-indigo-600" />
                        {isEn ? 'Initial Medical History / Clinical Summary' : 'التاريخ المرضي المبدئي / الملخص الطبي'} <span className="text-slate-400 font-normal">({isEn ? 'optional' : 'اختياري'})</span>
                      </label>
                      <input
                        type="text"
                        required={false}
                        value={editingPatientModalData.medicalHistory}
                        onChange={(e) => setEditingPatientModalData({ ...editingPatientModalData, medicalHistory: e.target.value })}
                        placeholder={isEn ? "Summary appears automatically, or type custom text..." : "سيظهر ملخص إجابات الأسئلة أعلاه تلقائياً، أو يمكنك كتابة نص مخصص..."}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-slate-800 shadow-2xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingPatientModalData(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                {isEn ? 'Cancel' : 'إلغاء'}
              </button>
              <button
                type="button"
                disabled={isSavingPatientEdit}
                onClick={handleSavePatientEdit}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 disabled:opacity-50 shadow-md cursor-pointer"
              >
                <Save className="h-4 w-4" />
                {isSavingPatientEdit ? (isEn ? 'Saving...' : 'جاري الحفظ...') : (isEn ? 'Save Changes' : 'حفظ التعديلات')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
