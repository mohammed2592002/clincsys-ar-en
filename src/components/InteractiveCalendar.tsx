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
import { getPaymentCollectionDate } from '../utils/paymentDateUtils';
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

  // Keep the quick consultation fee in sync when the quick bar is used outside the full form
  useEffect(() => {
    if (!isAdding && treatmentType === 'كشف جديد' && !initialPrice && clinic.consultationPrice !== undefined && clinic.consultationPrice > 0) {
      setInitialPrice(String(clinic.consultationPrice));
    }
  }, [isAdding, treatmentType, initialPrice, clinic.consultationPrice]);

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
          payments: data.payments || [],
          bookingType: data.bookingType || undefined,
          turnNumber: data.turnNumber !== undefined ? Number(data.turnNumber) : undefined
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

    const effectiveIsNewPatient = isNewPatient;
    const effectiveNotes = appointmentNotes;
    const effectiveProcedures = appProcedures;

    try {
      if (effectiveIsNewPatient) {
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

      const effectiveBookingType = selectedBookingType;
      const isTurnBooking = clinicBookingMode === 'turn' || (clinicBookingMode === 'hybrid' && effectiveBookingType === 'turn');
      const targetTurn = isTurnBooking ? (Number(turnNumberInput) || getRecommendedTurnNumber(selectedDate)) : undefined;

      const normSelDate = normalizeDateStr(selectedDate);
      const sameDayActiveApps = appointments.filter(a =>
        normalizeDateStr(a.date) === normSelDate &&
        a.status?.toLowerCase() !== 'cancelled' &&
        a.status?.toLowerCase() !== 'canceled'
      );

      // Find if this patient already has an active appointment on the target date
      let existingAppForPatient = (!effectiveIsNewPatient && selectedPatientId)
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

      if (effectiveIsNewPatient) {
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
      if (!existingAppForPatient && !effectiveIsNewPatient && targetPatientId) {
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

        const newProcs = effectiveProcedures && effectiveProcedures.length > 0
          ? effectiveProcedures.map(p => ({ name: p.name, price: p.price, tooth: null }))
          : [{ name: treatmentType, price: numPrice, tooth: null }];

        newProcs.forEach(p => {
          const isDup = combinedProcedures.some(cp => cp.name === p.name && cp.price === p.price && cp.tooth === (p.tooth || null));
          if (!isDup) {
            combinedProcedures.push(p);
          }
        });

        const combinedNotes = `${existingAppForPatient.notes ? existingAppForPatient.notes + '\n' : ''}${effectiveNotes}`;

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
      const initialProcs = effectiveProcedures && effectiveProcedures.length > 0
        ? effectiveProcedures.map(p => ({ name: p.name, price: p.price, tooth: null }))
        : [{ name: treatmentType, price: numPrice, tooth: null }];

      await addDoc(ref, cleanDbData({
        patientId: targetPatientId,
        patientName: targetPatientName,
        patientPhone: targetPatientPhone,
        patientWhatsapp: effectiveIsNewPatient ? (newPatientWhatsappNumber.trim() || targetPatientPhone) : undefined,
        patientGender: effectiveIsNewPatient ? newPatientGender : undefined,
        patientAge: effectiveIsNewPatient ? newPatientAge.trim() : undefined,
        patientOccupation: effectiveIsNewPatient ? newPatientOccupation.trim() : undefined,
        patientGovernorate: effectiveIsNewPatient ? newPatientGovernorate.trim() : undefined,
        patientCityOrDistrict: effectiveIsNewPatient ? newPatientCityOrDistrict.trim() : undefined,
        patientAddress: effectiveIsNewPatient ? newPatientAddress.trim() : undefined,
        patientMedicalHistory: effectiveIsNewPatient ? newPatientMedicalHistory.trim() : undefined,
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
        notes: effectiveNotes,
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

  const selectedDateLabel = useMemo(() => {
    const parts = selectedDate.split('-').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return selectedDate;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dow = d.getDay();
    return isEn
      ? `${daysEnglish[dow]}, ${monthsEnglish[parts[1] - 1]} ${parts[2]}, ${parts[0]}`
      : `${daysArabic[dow]} ${parts[2]} ${monthsArabic[parts[1] - 1]} ${parts[0]}`;
  }, [selectedDate, isEn]);

  const bookingModeLabel = clinicBookingMode === 'turn'
    ? (isEn ? 'Queue system' : 'نظام الدور')
    : clinicBookingMode === 'time'
    ? (isEn ? 'Time system' : 'نظام الوقت')
    : (isEn ? 'Hybrid system (time & queue)' : 'نظام هجين (وقت ودور)');

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
          const payDate = getPaymentCollectionDate(pay, app.date);
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
    // When day and month are already 2-digit both keys are identical - count once, never double
    if (isoDate === unpaddedDate) return appointmentCounts[isoDate] || 0;
    return (appointmentCounts[isoDate] || 0) + (appointmentCounts[unpaddedDate] || 0);
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="bg-[#272E40] rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-lg border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
            <CalendarIcon className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">{t('calendar.title')}</h2>
            <p className="text-xs text-slate-300 mt-0.5 font-medium">
              {bookingModeLabel} • {selectedDateLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs bg-white/10 border border-white/10 text-white px-3 py-2 rounded-xl font-bold flex items-center gap-1.5">
            <span className="text-slate-300 font-medium">{selectedDate === todayStr ? (isEn ? 'Today:' : 'اليوم:') : selectedDate === getYesterdayStr() ? (isEn ? 'Yesterday:' : 'أمس:') : selectedDate === getTomorrowStr() ? (isEn ? 'Tomorrow:' : 'غداً:') : (isEn ? 'Selected:' : 'المعروض:')}</span>
            <span className="font-black">{selectedDayAppointments.length} {isEn ? 'appointments' : 'مواعيد'}</span>
          </span>
          <span className="text-xs bg-white/10 border border-white/10 text-white px-3 py-2 rounded-xl font-bold flex items-center gap-1.5">
            <span className="text-slate-300 font-medium">{isEn ? 'Waiting:' : 'في الانتظار:'}</span>
            <span className="font-black text-amber-300">{selectedDayAppointments.filter(a => a.status === 'waiting').length}</span>
          </span>
          <span className="text-xs bg-white/10 border border-white/10 text-white px-3 py-2 rounded-xl font-bold flex items-center gap-1.5">
            <span className="text-slate-300 font-medium">{isEn ? "Day's revenue:" : 'إيراد اليوم:'}</span>
            <span className="font-black text-emerald-300 font-mono">{dailyTotalPaid.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
          </span>
          <button
            onClick={() => {
              if (!activeShift && !isAdding) {
                dialogs.alert(t('calendar.shiftWarning'), { severity: 'warning' });
                return;
              }
              setIsAdding(!isAdding);
            }}
            className="flex items-center gap-1.5 bg-gradient-to-l from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition shadow-md shadow-emerald-900/40 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            {isAdding ? t('calendar.cancelBooking') : t('calendar.newAppointment')}
          </button>
          <button
            onClick={() => fetchAppointments(true)}
            className="p-2.5 text-slate-200 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl transition cursor-pointer"
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
          <div className="bg-[#272E40] text-white p-5 sm:p-6 border-b border-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
                  <CalendarPlus className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black tracking-tight">{isEn ? 'Book New Appointment' : 'حجز موعد جديد'}</h3>
                  <p className="text-xs text-slate-300 mt-0.5 font-medium">{isEn ? 'Consultation or follow-up booking in under a minute' : 'كشف أو استشارة في أقل من دقيقة'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition text-white/80 hover:text-white cursor-pointer shrink-0"
                title={isEn ? "Close" : "إغلاق"}
              >
                ✕
              </button>
            </div>
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1">
                {clinicBookingMode === 'turn' ? <Ticket className="h-3 w-3 text-emerald-400" /> : <Clock className="h-3 w-3 text-emerald-400" />}
                <span className="text-[11px] font-bold text-emerald-300">
                  {isEn
                    ? `Current booking mode: ${clinicBookingMode === 'turn' ? 'Queue' : clinicBookingMode === 'time' ? 'Time' : 'Hybrid'} - from clinic settings`
                    : `وضع الحجز الحالي: ${clinicBookingMode === 'turn' ? 'بالدور' : clinicBookingMode === 'time' ? 'بالوقت' : 'هجين (وقت ودور)'} — من إعدادات العيادة`}
                </span>
              </span>
            </div>
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
            <div className={isNewPatient ? 'grid grid-cols-1 lg:grid-cols-2 gap-6 items-start' : ''}>
            <div className="space-y-6 min-w-0">
            {/* Step 1: Patient Details */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-6 h-6 rounded-full bg-[#272E40] text-white text-[11px] font-black flex items-center justify-center">{isEn ? '1' : '١'}</span>
                <span className="text-xs font-black text-slate-700">{isEn ? 'Patient Details' : 'بيانات المريض'}</span>
                <span className="text-[11px] text-slate-400 font-bold ms-auto">{isEn ? 'Required *' : 'مطلوب *'}</span>
              </div>

              {/* Patient Type Cards */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewPatient(false);
                    setNewPatientName('');
                    setNewPatientPhone('');
                    setNewPatientAge('');
                    setNewPatientMedicalHistory('');
                  }}
                  className={`p-3.5 rounded-2xl border-2 transition text-center cursor-pointer space-y-1.5 ${
                    !isNewPatient
                      ? 'border-emerald-500 bg-emerald-50/60 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className={`w-9 h-9 mx-auto rounded-xl flex items-center justify-center ${!isNewPatient ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <User className="h-4 w-4" />
                  </div>
                  <div className="text-xs font-black text-slate-800">{isEn ? 'Existing Clinic Patient' : 'مريض مسجل بالعيادة'}</div>
                  <div className="text-[10px] text-slate-400 font-bold">{isEn ? 'Search patient files' : 'ابحث واختار من ملفات المرضى'}</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsNewPatient(true);
                    setSelectedPatientId('');
                  }}
                  className={`p-3.5 rounded-2xl border-2 transition text-center cursor-pointer space-y-1.5 ${
                    isNewPatient
                      ? 'border-emerald-500 bg-emerald-50/60 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className={`w-9 h-9 mx-auto rounded-xl flex items-center justify-center ${isNewPatient ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <Plus className="h-4 w-4" />
                  </div>
                  <div className="text-xs font-black text-slate-800">{isEn ? 'New Patient' : 'مريض جديد'}</div>
                  <div className="text-[10px] text-slate-400 font-bold">{isEn ? 'Quick registration & booking' : 'تسجيل سريع وحجز فوري'}</div>
                </button>
              </div>

              {!isNewPatient && (
                <div className="space-y-2 animate-fade-in">
                  <PatientSearchSelect
                    patients={patients}
                    selectedPatientId={selectedPatientId}
                    onSelectPatient={setSelectedPatientId}
                    placeholder={isEn ? "Search by patient name or phone..." : "ابحث باسم المريض أو رقم الهاتف..."}
                    required={!isNewPatient}
                  />
                  {selectedPatientId && (() => {
                    const sp = patients.find(p => p.id === selectedPatientId);
                    if (!sp) return null;
                    const spAge = (sp as any).age;
                    return (
                      <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl p-2.5 animate-fade-in">
                        <div className="w-9 h-9 rounded-xl bg-[#272E40] text-white flex items-center justify-center text-sm font-black shrink-0">{(sp.name || '؟').trim().charAt(0)}</div>
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800 truncate">{sp.name}</div>
                          <div className="text-[10px] text-slate-500 font-bold">
                            <span dir="ltr">{sp.phone}</span>
                            {spAge ? ` • ${spAge} ${isEn ? 'yrs' : 'سنة'}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Step 2: Date & Turn/Time */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="w-6 h-6 rounded-full bg-[#272E40] text-white text-[11px] font-black flex items-center justify-center">{isEn ? '2' : '٢'}</span>
                <span className="text-xs font-black text-slate-700">
                  {isEn
                    ? (clinicBookingMode === 'turn' ? 'Appointment & Queue Turn' : 'Appointment Date & Time')
                    : (clinicBookingMode === 'turn' ? 'الموعد والدور' : 'الموعد والتوقيت')}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Date Box */}
                <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center">
                  <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                    <CalendarIcon className="h-3.5 w-3.5 text-emerald-600" />
                    {isEn ? 'Appointment Date' : 'تاريخ الموعد'}
                  </label>
                  <input
                    type="date"
                    required
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs text-center font-black text-slate-800 shadow-2xs cursor-pointer"
                  />
                </div>

                {/* Auto Turn Card (queue mode) OR Turn stepper (hybrid) OR Time selects */}
                {clinicBookingMode === 'turn' ? (
                  <div className="bg-emerald-50/80 p-3 rounded-2xl border border-emerald-200/80 flex flex-col justify-center animate-fade-in">
                    <label className="block text-[11px] font-black text-emerald-900 mb-1 flex items-center gap-1">
                      <Ticket className="h-3.5 w-3.5 text-emerald-600" />
                      {isEn ? 'Turn (auto)' : 'الدور (تلقائي)'}
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 text-white flex items-center justify-center text-lg font-black shadow-md shadow-emerald-200 shrink-0">
                        {Number(turnNumberInput) || getRecommendedTurnNumber(selectedDate)}
                      </div>
                      <div>
                        <div className="text-xs font-black text-emerald-900">{isEn ? 'Turn is booked automatically' : 'الدور بيتحجز تلقائي'}</div>
                        <div className="text-[10px] text-emerald-700/80 font-bold mt-0.5">{isEn ? 'The patient takes the first free turn of the day' : 'المريض بياخد أول دور فاضي في قائمة اليوم'}</div>
                      </div>
                    </div>
                  </div>
                ) : selectedBookingType === 'turn' ? (
                  <div className="bg-amber-50/80 p-3 rounded-2xl border border-amber-200/80 flex flex-col justify-center animate-fade-in">
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
                  <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-200/80 flex flex-col justify-center animate-fade-in">
                    <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-emerald-600" />
                      {isEn ? 'Appointment Time' : 'توقيت الموعد'}
                    </label>
                    <div className="flex gap-1 items-center" dir="ltr">
                      <select
                        value={parse24To12(appointmentTime).hour12}
                        onChange={(e) => {
                          const { minute, period } = parse24To12(appointmentTime);
                          setAppointmentTime(to24Hour(parseInt(e.target.value, 10), minute, period));
                        }}
                        className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs bg-white font-mono font-bold text-center cursor-pointer shadow-2xs"
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
                        className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs bg-white font-mono font-bold text-center cursor-pointer shadow-2xs"
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
                        className="flex-1 px-1 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-[11px] bg-white font-black text-center cursor-pointer shadow-2xs text-emerald-700"
                      >
                        <option value="ص">{isEn ? 'AM' : 'ص'}</option>
                        <option value="م">{isEn ? 'PM' : 'م'}</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

              {/* Full Registration Form for New Patient */}
              {isNewPatient && (
                <div className="space-y-3 animate-fade-in mt-2">
                  {/* 1. Personal & Demographic Data */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
                      <label className="block text-[11px] font-black text-slate-700 mb-1 flex items-center gap-1">
                        <User className="h-3 w-3 text-emerald-600" />
                        {isEn ? 'Gender' : 'النوع / الجنس'}
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setNewPatientGender('ذكر')}
                          className={`py-2 rounded-xl text-xs font-bold transition border cursor-pointer ${
                            newPatientGender === 'ذكر'
                              ? 'bg-[#272E40] text-white border-[#272E40] shadow-sm'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {isEn ? 'Male' : 'ذكر'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewPatientGender('أنثى')}
                          className={`py-2 rounded-xl text-xs font-bold transition border cursor-pointer ${
                            newPatientGender === 'أنثى'
                              ? 'bg-[#272E40] text-white border-[#272E40] shadow-sm'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {isEn ? 'Female' : 'أنثى'}
                        </button>
                      </div>
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
                          className="text-[10px] text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded-full font-bold cursor-pointer transition"
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
                  </div>

                  {/* 2. العنوان السكني والموقع */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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

                    <div className="sm:col-span-2">
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

                </div>
              )}

              {/* Step 3: Visit Type & Price */}
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2 pt-1">
                <span className="w-6 h-6 rounded-full bg-[#272E40] text-white text-[11px] font-black flex items-center justify-center">{isEn ? '3' : '٣'}</span>
                <span className="text-xs font-black text-slate-700">{isEn ? 'Visit Type & Price' : 'نوع الزيارة والسعر'}</span>
              </div>
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
                          ? 'bg-[#272E40] text-white border-[#272E40] shadow-sm'
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
                          ? 'bg-[#272E40] text-white border-[#272E40] shadow-sm'
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

            </div>
            {isNewPatient && (
            <div className="space-y-3 animate-fade-in min-w-0">
                  {/* 3. Receptionist Initial Medical Questionnaire */}
                  <div className="space-y-3 bg-white/90 p-3.5 rounded-xl border border-indigo-100 shadow-2xs">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
                          <Heart className="h-3.5 w-3.5 text-rose-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-800">{isEn ? 'Quick Medical Questionnaire' : 'الاستبيان الطبي السريع'}</div>
                          <div className="text-[10px] text-slate-400 font-bold mt-0.5">{isEn ? 'Filled by reception during registration' : 'بيتعبى من الاستقبال أثناء التسجيل'}</div>
                        </div>
                      </div>
                      <span className="text-[10px] bg-[#272E40] text-white font-black px-2.5 py-1 rounded-lg shrink-0">
                        {isEn ? `${activeQuestions.length} questions` : `${activeQuestions.length} أسئلة`}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {activeQuestions.map((q, idx) => {
                        const ans = questionnaireAnswers[q.id] || { answer: 'لا', details: '' };
                        const isYes = ans.answer === 'نعم';

                        return (
                          <div key={q.id} className={`p-2.5 rounded-xl border space-y-2 ${isYes ? 'bg-rose-50/70 border-rose-200' : 'bg-slate-50/80 border-slate-200/80'}`}>
                            <div>
                              <label className="block text-xs font-bold text-slate-800">
                                {q.text}
                              </label>
                              {q.category && (
                                <span className="inline-block mt-0.5 text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                                  {q.category}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
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
                                className={`flex-1 min-w-0 px-2.5 py-1.5 border rounded-lg text-xs font-medium transition ${
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


                    </div>
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
            )}
            </div>

            {/* Footer: summary + actions */}
            <div className="bg-slate-50/90 -mx-6 -mb-6 p-4 px-6 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3 mt-4">
              <div className="text-[11px] font-bold text-slate-500">
                <span className="text-slate-400">{isEn ? 'Booking summary: ' : 'ملخص الحجز: '}</span>
                <strong className="text-slate-800">
                  {isNewPatient && newPatientName.trim() ? `${newPatientName.trim()} • ` : ''}
                  {selectedDate}
                  {' • '}
                  {clinicBookingMode === 'turn' || selectedBookingType === 'turn'
                    ? `${isEn ? 'Turn' : 'الدور'} ${Number(turnNumberInput) || getRecommendedTurnNumber(selectedDate)}`
                    : formatTimeTo12Hour(appointmentTime, isEn)}
                  {' • '}
                  {treatmentType === 'كشف جديد' ? (isEn ? 'New Consultation' : 'كشف جديد') : (isEn ? 'Follow-up Session' : 'استكمال جلسات')}
                  {treatmentType === 'كشف جديد' && initialPrice ? ` • ${initialPrice} ${isEn ? 'EGP' : 'ج.م'}` : ''}
                </strong>
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
                  className="px-6 py-2.5 text-white bg-gradient-to-l from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 rounded-xl text-xs font-black transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md shadow-emerald-200 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      {isEn ? 'Saving appointment...' : 'جاري حفظ الموعد...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      {isNewPatient ? (isEn ? 'Register & Book Appointment' : 'تسجيل وحجز الموعد') : (isEn ? 'Confirm Booking' : 'تأكيد الحجز')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </motion.div>
      )}

      {/* Main Grid: Day list (right in RTL) + Sidebar (calendar & revenue) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Day List Column */}
        <div className="lg:col-span-8 flex flex-col space-y-4 min-w-0 order-2 lg:order-1">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
            {/* List Header: title + quick date pills */}
            <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-extrabold text-slate-800 text-lg flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                  {selectedDate === todayStr
                    ? (isEn ? "Today's Appointments" : 'مواعيد اليوم')
                    : selectedDate === getYesterdayStr()
                    ? (isEn ? "Yesterday's Appointments" : 'مواعيد أمس')
                    : selectedDate === getTomorrowStr()
                    ? (isEn ? "Tomorrow's Appointments" : 'مواعيد غداً')
                    : (isEn ? 'Appointments: ' : 'مواعيد ') + selectedDateLabel}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {clinicBookingMode === 'turn'
                    ? (isEn ? 'Ordered by queue numbers' : 'مرتبة بأرقام الأدوار')
                    : clinicBookingMode === 'time'
                    ? (isEn ? 'Ordered by appointment time' : 'مرتبة بالساعة والتوقيت')
                    : (isEn ? 'Ordered by time & queue' : 'مرتبة بالدور والساعة')}
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
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                    selectedDate === getYesterdayStr()
                      ? 'bg-[#272E40] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {t('calendar.yesterday')}
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDate(todayStr)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                    selectedDate === todayStr
                      ? 'bg-[#272E40] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                    selectedDate === getTomorrowStr()
                      ? 'bg-[#272E40] text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {t('calendar.tomorrow')}
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleSelectDate(e.target.value)}
                  className="px-2.5 py-1 rounded-xl text-xs font-black bg-slate-50 border border-slate-200 hover:bg-white text-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-500/40 shadow-2xs font-mono"
                  title={t('calendar.filterDate')}
                />
              </div>
            </div>

            {/* Legend + Search row */}
            <div className="flex items-center justify-between flex-wrap gap-2 pt-3">
              <div className="flex items-center gap-3 text-[11px] font-bold flex-wrap">
                <span className="flex items-center gap-1 text-amber-600">
                  <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                  {isEn ? 'Unconfirmed' : 'غير مؤكد'} {selectedDayAppointments.filter(app => app.status === 'scheduled').length}
                </span>
                <span className="flex items-center gap-1 text-emerald-600">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  {isEn ? 'Waiting' : 'في الانتظار'} {selectedDayAppointments.filter(app => app.status === 'waiting').length}
                </span>
                <span className="flex items-center gap-1 text-slate-500">
                  <span className="h-2 w-2 rounded-full bg-slate-400"></span>
                  {isEn ? 'Completed' : 'مكتمل'} {selectedDayAppointments.filter(app => app.status === 'completed').length}
                </span>
              </div>

              {/* Search Input */}
              <div className="relative min-w-[180px]">
                <Search className={`h-3.5 w-3.5 text-slate-400 absolute ${isEn ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2`} />
                <input
                  type="text"
                  placeholder={isEn ? "Search by name or phone..." : "بحث بالاسم أو الهاتف..."}
                  value={appSearchQuery}
                  onChange={(e) => setAppSearchQuery(e.target.value)}
                  className={`w-full ${isEn ? 'pl-8 pr-7' : 'pl-7 pr-8'} py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:bg-white transition-all`}
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
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap pt-3">
              <button
                type="button"
                onClick={() => setAppStatusFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  appStatusFilter === 'all' ? 'bg-[#272E40] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {isEn ? 'All' : 'الكل'} {selectedDayAppointments.length}
              </button>
              <button
                type="button"
                onClick={() => setAppStatusFilter('scheduled')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  appStatusFilter === 'scheduled' ? 'bg-amber-500 text-white shadow-sm' : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/60'
                }`}
              >
                {isEn ? 'Unconfirmed' : 'غير مؤكد'} {selectedDayAppointments.filter(app => app.status === 'scheduled').length}
              </button>
              <button
                type="button"
                onClick={() => setAppStatusFilter('waiting')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  appStatusFilter === 'waiting' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/60'
                }`}
              >
                {isEn ? 'Arrived (Waiting)' : 'تم الحضور (الانتظار)'} {selectedDayAppointments.filter(app => app.status === 'waiting').length}
              </button>
              <button
                type="button"
                onClick={() => setAppStatusFilter('completed')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer ${
                  appStatusFilter === 'completed' ? 'bg-slate-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {isEn ? 'Completed' : 'مكتمل'} {selectedDayAppointments.filter(app => app.status === 'completed').length}
              </button>
            </div>

            {/* Appointment Cards */}
            <div className="pt-4 space-y-4">
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

                const patientRec = patientsMap.get(app.patientId);
                const appAge = ((app as any).patientAge || patientRec?.age || '').toString().trim();
                const appPhone = app.patientPhone || patientRec?.phone || '';
                const appPrice = (app.price !== undefined ? app.price : (app.cost || 0));
                const appPaid = Number(app.paidAmount || 0);
                const appRemaining = app.remainingAmount !== undefined ? Number(app.remainingAmount) : Math.max(0, appPrice - appPaid);
                const appPayments = getAppointmentPayments(app);
                const lastPaymentMethod = appPayments && appPayments.length > 0 ? appPayments[appPayments.length - 1].paymentMethod : app.paymentMethod;
                const procBreakdown = resolveProcedureBreakdown(app);
                const procNamesJoined = procBreakdown.map(p => formatProcedureName(p.name, isEn)).join(' + ');
                const isTurnCard = clinicBookingMode === 'turn' || app.bookingType === 'turn';
                const displayTurn = app.turnNumber ?? turnNumber;
                const isFullyPaid = appPrice > 0 && appPaid > 0 && appRemaining <= 0;

                return (
                  <div
                    key={app.id}
                    className={`rounded-2xl border p-4 transition-all duration-200 shadow-sm ${
                      app.status === 'completed'
                        ? 'bg-white border-slate-200/80 border-r-4 border-r-emerald-400'
                        : app.status === 'waiting'
                        ? 'bg-white border-emerald-300/70'
                        : app.status === 'cancelled'
                        ? 'bg-slate-50/60 border-slate-200 opacity-75'
                        : 'bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-md'
                    }`}
                  >
                    {/* Top row: turn badge + patient info | amount */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex flex-col items-center shrink-0 w-10">
                          <span className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shadow-sm ${
                            app.status === 'completed' ? 'bg-emerald-500 text-white' : app.status === 'waiting' ? 'bg-amber-500 text-white' : app.status === 'cancelled' ? 'bg-slate-300 text-white' : 'bg-[#272E40] text-white'
                          }`}>
                            {app.status === 'completed' ? (
                              <>
                                <span className="sm:hidden">{displayTurn || '—'}</span>
                                <span className="hidden sm:inline">✓</span>
                              </>
                            ) : (displayTurn || '—')}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 mt-1 whitespace-nowrap">
                            {app.status === 'completed'
                              ? (isEn ? 'Done' : 'تم')
                              : isTurnCard
                              ? (isEn ? 'Turn' : 'دور')
                              : formatTimeTo12Hour(app.time || '', isEn)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className={`text-base font-black sm:truncate ${app.status === 'cancelled' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                              {app.patientName}
                            </h4>
                            {app.status !== 'cancelled' && (
                              <div className="hidden sm:flex items-center gap-1 shrink-0 flex-wrap">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleOpenEditPatientModal(app); }}
                                  className="p-1 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition cursor-pointer"
                                  title={isEn ? 'Edit Patient Data' : 'تعديل بيانات المريض'}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
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
                                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
                                  title={isEn ? 'Patient Financials & Accounts' : 'المالية والحسابات التابعة للمريض'}
                                >
                                  <Coins className="h-3 w-3" />
                                  {isEn ? 'Financials' : 'الماليات'}
                                </button>
                                {onOpenMedicalFile && app.patientId && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onOpenMedicalFile(app.patientId); }}
                                    className="text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
                                    title={isEn ? 'Patient Medical File' : 'الملف الطبي للمريض'}
                                  >
                                    <FileText className="h-3 w-3" />
                                    {isEn ? 'File' : 'الملف'}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 font-medium sm:truncate">
                            {appPhone}{appAge ? ` • ${isEn ? 'Age' : 'عمر'} ${appAge}${isEn ? '' : ' سنة'}` : ''}
                          </p>
                          {/* Mobile-only row: patient actions (name takes full width; turn number is inside the avatar) */}
                          {app.status !== 'cancelled' && (
                            <div className="flex sm:hidden items-center gap-1.5 flex-wrap mt-1.5">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleOpenEditPatientModal(app); }}
                                className="p-1 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition cursor-pointer"
                                title={isEn ? 'Edit Patient Data' : 'تعديل بيانات المريض'}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
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
                                className="text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
                                title={isEn ? 'Patient Financials & Accounts' : 'المالية والحسابات التابعة للمريض'}
                              >
                                <Coins className="h-3 w-3" />
                                {isEn ? 'Financials' : 'الماليات'}
                              </button>
                              {onOpenMedicalFile && app.patientId && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onOpenMedicalFile(app.patientId); }}
                                  className="text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition cursor-pointer flex items-center gap-1"
                                  title={isEn ? 'Patient Medical File' : 'الملف الطبي للمريض'}
                                >
                                  <FileText className="h-3 w-3" />
                                  {isEn ? 'File' : 'الملف'}
                                </button>
                              )}
                            </div>
                          )}
                          <div className="hidden sm:flex items-center gap-1.5 flex-wrap mt-1.5">
                            {app.status === 'scheduled' && (
                              <span className="text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200/70 px-2 py-0.5 rounded-lg">
                                {isEn ? 'Unconfirmed' : 'غير مؤكد'}
                              </span>
                            )}
                            {app.status === 'waiting' && (
                              <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200/70 px-2 py-0.5 rounded-lg flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                {isEn ? 'Waiting' : 'في الانتظار'}
                              </span>
                            )}
                            {app.status === 'completed' && (
                              <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200/70 px-2 py-0.5 rounded-lg">
                                {isEn ? 'Completed ✓' : 'مكتمل ✓'}
                              </span>
                            )}
                            {app.status === 'cancelled' && (
                              <span className="text-[10px] font-black bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-lg">
                                {isEn ? 'Cancelled' : 'ملغى'}
                              </span>
                            )}
                            {app.treatmentType && (
                              <span className="text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200/70 px-2 py-0.5 rounded-lg">
                                {formatProcedureName(app.treatmentType, isEn)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Amount + payment badge */}
                      <div className={`shrink-0 ${isEn ? 'text-right' : 'text-left'}`}>
                        <div className="text-base font-black text-[#272E40] font-mono whitespace-nowrap">
                          {appPrice.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                        </div>
                        {appRemaining > 0 && appPrice > 0 ? (
                          <span className="inline-block mt-1 text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200/70 px-2 py-0.5 rounded-lg">
                            {isEn ? 'Deferred' : 'آجل'}
                          </span>
                        ) : appPaid > 0 ? (
                          <span className="inline-block mt-1 text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200/70 px-2 py-0.5 rounded-lg">
                            {isEn ? 'Paid' : 'مدفوع'}{lastPaymentMethod ? ` ${formatPaymentMethodName(lastPaymentMethod, isEn)}` : ''}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Procedures: collapsed line / expanded table */}
                    <div className="procedure-table-container mt-3">
                      {expandedProcedureAppIds[app.id] ? (
                        <div className="rounded-xl border border-blue-200/70 overflow-hidden animate-fade-in">
                          <div className="bg-blue-50/80 px-3 py-1.5 flex items-center justify-between">
                            <span className="text-[11px] font-black text-blue-800 flex items-center gap-1.5">
                              <Stethoscope className="h-3.5 w-3.5 text-blue-600" />
                              {isEn ? 'Procedures & Services Table' : 'جدول الإجراءات والخدمات'}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleProcedures(app.id); }}
                              className="text-[10px] font-black text-blue-700 bg-white/80 hover:bg-white border border-blue-200 px-2 py-0.5 rounded-lg transition cursor-pointer flex items-center gap-1"
                            >
                              {isEn ? 'Close table' : 'إغلاق الجدول'} ▴
                            </button>
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-50/80 text-slate-500 text-[10px] font-black">
                                <th className="text-start px-3 py-1.5 font-black">{isEn ? 'Procedure' : 'الإجراء'}</th>
                                <th className="text-center px-3 py-1.5 font-black w-20">{isEn ? 'Tooth' : 'السن'}</th>
                                <th className="text-end px-3 py-1.5 font-black w-28">{isEn ? 'Price' : 'السعر'}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {procBreakdown.map((proc, idx) => (
                                <tr key={idx} className="text-slate-700">
                                  <td className="px-3 py-1.5 font-bold">{formatProcedureName(proc.name, isEn)}</td>
                                  <td className="px-3 py-1.5 text-center text-slate-500 font-bold">
                                    {proc.tooth ? (isEn ? `Tooth ${proc.tooth}` : `ضرس ${proc.tooth}`) : '-'}
                                  </td>
                                  <td className="px-3 py-1.5 text-end font-black font-mono text-slate-800">
                                    {proc.price > 0 ? `${proc.price.toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}` : (isEn ? 'Free / Included' : 'مجاني / شامل')}
                                  </td>
                                </tr>
                              ))}
                              <tr className="bg-emerald-50/70">
                                <td className="px-3 py-1.5 font-black text-emerald-900">{isEn ? 'Total Cost' : 'إجمالي التكلفة'}</td>
                                <td></td>
                                <td className="px-3 py-1.5 text-end font-black text-emerald-700 font-mono">
                                  {appPrice.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          {app.notes && (
                            <div className="bg-amber-50/70 px-3 py-1.5 text-[11px] text-amber-900 border-t border-amber-100/80 leading-relaxed">
                              <span className="font-black">{isEn ? 'Notes: ' : 'ملاحظات: '}</span>
                              <span className="font-medium">{app.notes}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          onClick={(e) => { e.stopPropagation(); toggleProcedures(app.id); }}
                          className="bg-blue-50/60 hover:bg-blue-50 border border-blue-200/60 rounded-xl px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition group"
                          title={isEn ? 'Click to view procedures details' : 'انقر لعرض جدول الإجراءات التفصيلي'}
                        >
                          <span className="text-[11px] font-bold text-blue-900 truncate">
                            {isEn ? 'Procedures: ' : 'الإجراءات: '}
                            {procNamesJoined || formatProcedureName(app.treatmentType || '', isEn)}
                            {app.notes ? (isEn ? ' + notes' : ' + ملاحظات') : ''}
                            {' • '}{isEn ? 'Total: ' : 'الإجمالي: '}{appPrice.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                            {isFullyPaid ? ` • ${isEn ? 'Paid' : 'مدفوع'}${lastPaymentMethod ? ` ${formatPaymentMethodName(lastPaymentMethod, isEn)}` : ''}` : ''}
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 text-blue-700 shrink-0 group-hover:translate-y-0.5 transition-transform" />
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-3 mt-3 border-t border-slate-100">
                      {app.status === 'scheduled' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(app.id, 'waiting')}
                            className="bg-gradient-to-l from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-sm cursor-pointer text-xs py-1.5 px-3.5 rounded-xl font-black transition flex items-center gap-1"
                            title={isEn ? 'Confirm attendance and move to waiting' : 'تأكيد حضور المريض للعيادة وتحويل الموعد لانتظار'}
                          >
                            {isEn ? 'Confirm Arrival' : 'تأكيد الحضور'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(app.id, 'cancelled')}
                            className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/70 text-xs px-3 py-1.5 rounded-xl font-bold transition cursor-pointer"
                            title={isEn ? 'Cancel appointment' : 'إلغاء الموعد'}
                          >
                            {isEn ? 'Cancel Appointment' : 'إلغاء الموعد'}
                          </button>
                        </>
                      )}

                      {app.status === 'waiting' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(app.id, 'completed')}
                          className="bg-gradient-to-l from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-sm cursor-pointer text-xs py-1.5 px-3.5 rounded-xl font-black transition flex items-center gap-1"
                          title={isEn ? 'Confirm completion' : 'تأكيد إتمام الموعد'}
                        >
                          {isEn ? 'Complete Visit ✓' : 'إتمام الكشف ✓'}
                        </button>
                      )}

                      {app.status === 'cancelled' && (
                        <span className="bg-slate-100 border border-slate-200 text-slate-500 text-[11px] py-1.5 px-3 rounded-xl font-bold">
                          {isEn ? '✕ Cancelled' : '✕ ملغى'}
                        </span>
                      )}

                      {app.status !== 'cancelled' && (
                        <>
                          <button
                            type="button"
                            onClick={() => sendWhatsAppReminder(app)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs px-3 py-1.5 rounded-xl font-bold transition cursor-pointer flex items-center gap-1"
                            title={isEn ? 'Send appointment reminder' : 'إرسال رسالة تذكير بالموعد'}
                          >
                            <Send className="h-3 w-3" />
                            {isEn ? 'Reminder' : 'تذكير'}
                          </button>
                        </>
                      )}

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
                              className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 text-xs font-bold px-2.5 py-1.5 rounded-xl transition cursor-pointer flex items-center gap-1"
                              title={isEn ? 'Delete appointment permanently' : 'حذف الموعد نهائياً'}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {isEn ? 'Delete' : 'حذف'}
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

        {/* Sidebar Column: Mini Calendar + Daily Revenue (pinned on top on mobile) */}
        <div className="lg:col-span-4 space-y-5 order-1 lg:order-2">
          {/* Mini Calendar Card */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => navigateMonth('prev')}
                  className="p-1.5 hover:bg-slate-50 rounded-lg border border-slate-100 transition cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4 text-slate-600 rtl:rotate-0 ltr:rotate-180" />
                </button>
                <h3 className="font-black text-slate-800 text-sm min-w-[110px] text-center">
                  {monthsList[month]} {year}
                </h3>
                <button
                  type="button"
                  onClick={() => navigateMonth('next')}
                  className="p-1.5 hover:bg-slate-50 rounded-lg border border-slate-100 transition cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4 text-slate-600 rtl:rotate-0 ltr:rotate-180" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => fetchAppointments(true)}
                className="text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/70 px-2.5 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                {isEn ? 'Refresh' : 'تحديث'}
              </button>
            </div>

            {/* Weekdays */}
            <div className="grid grid-cols-7 text-center mb-1">
              {daysList.map((day) => (
                <div key={day} className="text-[10px] font-bold text-slate-400 py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Month Days Grid (compact) */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((cell, idx) => {
                const pad = (num: number) => String(num).padStart(2, '0');
                const cellIso = `${cell.year}-${pad(cell.month + 1)}-${pad(cell.day)}`;
                const isSelected = selectedDate === cellIso;
                const count = getAppointmentsCount(cell.day, cell.month, cell.year);
                const today = new Date();
                const isToday = today.getDate() === cell.day && today.getMonth() === cell.month && today.getFullYear() === cell.year;

                return (
                  <button
                    key={`${cell.year}-${cell.month}-${cell.day}-${idx}`}
                    type="button"
                    onClick={() => handleSelectDate(cellIso)}
                    className={`relative h-9 rounded-lg text-xs font-bold transition flex items-center justify-center cursor-pointer ${
                      !cell.isCurrentMonth
                        ? 'text-slate-300'
                        : isSelected
                        ? 'bg-[#272E40] text-white shadow-md'
                        : isToday
                        ? 'ring-2 ring-emerald-400 text-emerald-700 bg-emerald-50/50'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {cell.day}
                    {count > 0 && (
                      <span className={`absolute -top-1 ${isEn ? '-right-1' : '-left-1'} min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-black flex items-center justify-center ${
                        isSelected ? 'bg-white text-[#272E40]' : 'bg-[#272E40] text-white'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
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
                        className="text-[10px] text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded-full font-bold cursor-pointer transition"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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
