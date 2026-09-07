import React, { useState, useEffect, FormEvent, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getPatientsRef, getAppointmentsRef, OperationType, handleDbError, getDocsSmart as getDocs, getDocSmart as getDoc, db, addDoc, updateDoc, deleteDoc, doc, query, orderBy, limit, startAfter, where, clearQueryCache } from '../dbClient';
import { Patient, PatientQuestionnaire, Clinic, QuestionnaireQuestion, DEFAULT_QUESTIONNAIRE_QUESTIONS } from '../types';
import { 
  Users, UserPlus, Search, Phone, Edit, Trash2, Heart, Sparkles, 
  AlertCircle, RefreshCw, FileText, Coins, MapPin, Briefcase, Building2,
  MessageSquare, BarChart3, PieChart, Target, CheckCircle2, Copy, Globe, Activity, ShieldAlert, Filter
} from 'lucide-react';
import { useDialogs } from './DialogContext';
import PatientFinancialsModal from './PatientFinancialsModal';
import { getEgyptTodayStr, checkSubscriptionBlocked } from '../utils/timeUtils';
import { EGYPT_GOVERNORATES, translateGovernorate, translateCenter, formatLocationDisplayName } from '../data/egyptLocations';
import { SearchableSelect } from './SearchableSelect';
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from '../utils/phoneUtils';

interface PatientsManagerProps {
  clinic: Clinic;
  isStaff?: boolean;
  onOpenMedicalFile?: (patientId: string) => void;
  onOpenPatientFinancials?: (patientId: string) => void;
  activeShift?: any;
}

export default function PatientsManager({ clinic, isStaff, onOpenMedicalFile, onOpenPatientFinancials, activeShift }: PatientsManagerProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  const formAnchorRef = useRef<HTMLDivElement>(null);
  
  // Active View Tab: 'list' (Records) or 'analytics' (Marketing & Geographical Analysis)
  const [activeTab, setActiveTab] = useState<'list' | 'analytics'>('list');

  // Paginated patients state
  const [patients, setPatients] = useState<Patient[]>([]);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search full cache state
  const [allPatients, setAllPatients] = useState<Patient[]>([]);
  const [hasLoadedAllForSearch, setHasLoadedAllForSearch] = useState(false);
  const [searching, setSearching] = useState(false);

  const [financialModalPatient, setFinancialModalPatient] = useState<Patient | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Form State
  const [isAdding, setIsAdding] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  
  // Basic Demographic Fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [gender, setGender] = useState<'ذكر' | 'أنثى'>('ذكر');
  const [age, setAge] = useState('');
  const [governorate, setGovernorate] = useState(''); // المحافظة
  const [cityOrDistrict, setCityOrDistrict] = useState(''); // المركز / المدينة
  const [address, setAddress] = useState(''); // تفاصيل العنوان التفصيلية
  const [area, setArea] = useState(''); // المنطقة / الحي للتسويق
  const [occupation, setOccupation] = useState(''); // الوظيفة

  const governorateOptions = useMemo(() => {
    return EGYPT_GOVERNORATES.map(g => isEn ? g.nameEn : g.name);
  }, [isEn]);

  const currentGovernorateObj = useMemo(() => {
    return EGYPT_GOVERNORATES.find(g => 
      g.name === governorate || 
      g.nameEn.toLowerCase() === governorate.toLowerCase() ||
      g.id === governorate
    );
  }, [governorate]);

  const centerOptions = useMemo(() => {
    if (currentGovernorateObj) {
      return isEn ? currentGovernorateObj.centersEn : currentGovernorateObj.centers;
    }
    const allCenters = EGYPT_GOVERNORATES.flatMap(g => isEn ? g.centersEn : g.centers);
    return Array.from(new Set(allCenters));
  }, [currentGovernorateObj, isEn]);

  const handleGovernorateChange = (newGov: string) => {
    setGovernorate(newGov);
    const govObj = EGYPT_GOVERNORATES.find(g => 
      g.name === newGov || 
      g.nameEn.toLowerCase() === newGov.toLowerCase()
    );
    if (govObj && cityOrDistrict) {
      const allowedCenters = [...govObj.centers, ...govObj.centersEn];
      if (!allowedCenters.includes(cityOrDistrict)) {
        setCityOrDistrict('');
      }
    }
  };

  // Reception Pre-exam Questionnaire
  const activeQuestions = useMemo(() => {
    const list = (clinic.questionnaireQuestions && clinic.questionnaireQuestions.length > 0)
      ? clinic.questionnaireQuestions
      : DEFAULT_QUESTIONNAIRE_QUESTIONS;
    return list.filter(q => q.enabled !== false);
  }, [clinic.questionnaireQuestions]);

  const [questionnaireAnswers, setQuestionnaireAnswers] = useState<Record<string, { answer: 'نعم' | 'لا'; details: string }>>({});

  const setQuestionAnswer = (qId: string, answer: 'نعم' | 'لا', details?: string) => {
    setQuestionnaireAnswers(prev => ({
      ...prev,
      [qId]: {
        answer,
        details: details !== undefined ? details : (prev[qId]?.details || '')
      }
    }));
  };

  const [hasThyroid, setHasThyroid] = useState<'نعم' | 'لا'>('لا');
  const [thyroidDetails, setThyroidDetails] = useState('');

  const [hasDiabetes, setHasDiabetes] = useState<'نعم' | 'لا'>('لا');
  const [diabetesDetails, setDiabetesDetails] = useState('');

  const [hasHeart, setHasHeart] = useState<'نعم' | 'لا'>('لا');
  const [heartDetails, setHeartDetails] = useState('');

  const [hasChronic, setHasChronic] = useState<'نعم' | 'لا'>('لا');
  const [chronicDetails, setChronicDetails] = useState('');

  const [hasAllergies, setHasAllergies] = useState<'نعم' | 'لا'>('لا');
  const [allergiesDetails, setAllergiesDetails] = useState('');

  const [generalNotes, setGeneralNotes] = useState('');
  const [medicalHistory, setMedicalHistory] = useState('');

  const [deletingPatientId, setDeletingPatientId] = useState<string | null>(null);

  // Display states
  const [visibleCount, setVisibleCount] = useState<number>(5);

  useEffect(() => {
    setVisibleCount(5);
  }, [searchTerm]);

  const mapPatientDocData = (docSnap: any): Patient => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      name: data.name || '',
      phone: data.phone || '',
      whatsappNumber: data.whatsappNumber || data.phone || '',
      gender: data.gender || 'ذكر',
      age: data.age || '',
      address: data.address || '',
      governorate: data.governorate || '',
      cityOrDistrict: data.cityOrDistrict || '',
      area: data.area || (data.governorate ? (data.cityOrDistrict ? `${data.governorate} - ${data.cityOrDistrict}` : data.governorate) : ''),
      occupation: data.occupation || '',
      questionnaire: data.questionnaire || {},
      medicalHistory: data.medicalHistory || '',
      createdAt: data.createdAt || '',
      updatedAt: data.updatedAt || ''
    };
  };

  const PAGE_SIZE = 5;

  const fetchPatients = async () => {
    setLoading(true);
    setError(null);
    try {
      const ref = getPatientsRef(clinic.id);
      const q = query(ref, orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
      let snap;
      try {
        snap = await getDocs(q);
      } catch (err: any) {
        handleDbError(err, OperationType.LIST, `clinics/${clinic.id}/patients`);
      }
      
      const list: Patient[] = [];
      snap?.forEach((docSnap: any) => {
        list.push(mapPatientDocData(docSnap));
      });
      
      setPatients(list);
      if (snap && snap.docs && snap.docs.length > 0) {
        setLastDoc(snap.docs[snap.docs.length - 1]);
        setHasMore(snap.docs.length >= PAGE_SIZE);
      } else {
        setLastDoc(null);
        setHasMore(false);
      }

      setAllPatients([]);
      setHasLoadedAllForSearch(false);
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء تحميل سجلات المرضى: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  const fetchMorePatients = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      // If we already have a full cached list of all patients with more records, use it directly
      if (allPatients.length > patients.length) {
        const currentCount = patients.length;
        const nextBatch = allPatients.slice(0, currentCount + PAGE_SIZE);
        setPatients(nextBatch);
        setHasMore(allPatients.length > nextBatch.length);
        if (nextBatch.length > 0) {
          const lastItem = nextBatch[nextBatch.length - 1];
          setLastDoc({ id: lastItem.id, data: () => lastItem, exists: () => true });
        }
        return;
      }

      const ref = getPatientsRef(clinic.id);
      let list: Patient[] = [];
      let snap: any = null;

      if (lastDoc) {
        const q = query(ref, orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
        try {
          snap = await getDocs(q);
        } catch (err: any) {
          handleDbError(err, OperationType.LIST, `clinics/${clinic.id}/patients`);
        }
        
        snap?.forEach((docSnap: any) => {
          list.push(mapPatientDocData(docSnap));
        });
      }

      // If cursor pagination returned 0 items but we might have more, fallback to fetching all
      if (list.length === 0) {
        const qAll = query(ref, orderBy('createdAt', 'desc'));
        const allSnap = await getDocs(qAll);
        const fullList: Patient[] = [];
        allSnap?.forEach((docSnap: any) => {
          fullList.push(mapPatientDocData(docSnap));
        });
        setAllPatients(fullList);
        setHasLoadedAllForSearch(true);

        const currentCount = patients.length;
        const nextBatch = fullList.slice(0, currentCount + PAGE_SIZE);
        setPatients(nextBatch);
        setHasMore(fullList.length > nextBatch.length);
        return;
      }

      // Filter out duplicates and append
      let addedNew = false;
      setPatients(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newItems = list.filter(p => !existingIds.has(p.id));
        if (newItems.length > 0) {
          addedNew = true;
          return [...prev, ...newItems];
        }
        return prev;
      });

      if (snap?.docs && snap.docs.length > 0) {
        setLastDoc(snap.docs[snap.docs.length - 1]);
        setHasMore(snap.docs.length >= PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء تحميل المزيد من المرضى: ' + (err.message || err.toString()));
    } finally {
      setLoadingMore(false);
    }
  };

  const fetchAllPatientsForSearch = async (force = false) => {
    if ((hasLoadedAllForSearch && !force) || searching) return;
    setSearching(true);
    setError(null);
    try {
      const ref = getPatientsRef(clinic.id);
      const q = query(ref, orderBy('createdAt', 'desc'));
      let snap;
      try {
        snap = await getDocs(q, true);
      } catch (err: any) {
        handleDbError(err, OperationType.LIST, `clinics/${clinic.id}/patients`);
      }
      
      const list: Patient[] = [];
      snap?.forEach((docSnap: any) => {
        list.push(mapPatientDocData(docSnap));
      });
      
      setAllPatients(list);
      setHasLoadedAllForSearch(true);
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء تحميل البيانات للبحث والتحليل: ' + (err.message || err.toString()));
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    fetchPatients();

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};
      if (table === 'patients' && !isAdding && !editingPatient) {
        setHasLoadedAllForSearch(false);
        fetchPatients();
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => window.removeEventListener('clinic-sync', handleSync);
  }, [clinic.id, isAdding, editingPatient]);

  // Always load all patients when opening Analytics tab
  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAllPatientsForSearch(true);
    }
  }, [activeTab]);

  const resetForm = () => {
    setName('');
    setPhone('');
    setWhatsappNumber('');
    setGender('ذكر');
    setAge('');
    setGovernorate('');
    setCityOrDistrict('');
    setAddress('');
    setArea('');
    setOccupation('');
    setHasThyroid('لا');
    setThyroidDetails('');
    setHasDiabetes('لا');
    setDiabetesDetails('');
    setHasHeart('لا');
    setHeartDetails('');
    setHasChronic('لا');
    setChronicDetails('');
    setHasAllergies('لا');
    setAllergiesDetails('');
    setGeneralNotes('');
    setMedicalHistory('');

    const initialAns: Record<string, { answer: 'نعم' | 'لا'; details: string }> = {};
    activeQuestions.forEach(q => {
      initialAns[q.id] = { answer: 'لا', details: '' };
    });
    setQuestionnaireAnswers(initialAns);

    setEditingPatient(null);
    setIsAdding(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;

    if (!name.trim()) {
      dialogs.alert('يرجى إدخال اسم المريض بالكامل!', { severity: 'warning' });
      return;
    }

    const phoneClean = formatEgyptianPhoneInput(phone);
    const phoneErr = getEgyptianPhoneError(phoneClean, true, 'رقم الهاتف المحمول');
    if (phoneErr) {
      dialogs.alert(phoneErr, { severity: 'warning' });
      return;
    }

    const whatsappClean = whatsappNumber.trim() ? formatEgyptianPhoneInput(whatsappNumber) : phoneClean;
    if (whatsappNumber.trim()) {
      const whatsappErr = getEgyptianPhoneError(whatsappClean, false, 'رقم الواتساب');
      if (whatsappErr) {
        dialogs.alert(whatsappErr, { severity: 'warning' });
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const ref = getPatientsRef(clinic.id);
      
      const qDup = query(ref, where("name", "==", name.trim()));
      const dupSnap = await getDocs(qDup);
      
      let isDuplicate = false;
      if (editingPatient) {
        dupSnap.forEach((docSnap) => {
          if (docSnap.id !== editingPatient.id) {
            isDuplicate = true;
          }
        });
      } else {
        if (!dupSnap.empty) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        dialogs.alert('عذراً، هذا الاسم مسجل بالفعل لمريض آخر في العيادة. يرجى إدخال اسم فريد أو إضافة اسم العائلة لتجنب التكرار.', { severity: 'warning' });
        setLoading(false);
        return;
      }

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

      // Maintain legacy default fields for backward compatibility
      const thyroidAns = questionnaireAnswers['q_thyroid'] || { answer: hasThyroid, details: thyroidDetails };
      const finalThyroid = thyroidAns.answer === 'نعم' ? (thyroidAns.details.trim() ? `نعم - ${thyroidAns.details.trim()}` : 'نعم') : 'لا يوجد';

      const diabetesAns = questionnaireAnswers['q_diabetes'] || { answer: hasDiabetes, details: diabetesDetails };
      const finalDiabetes = diabetesAns.answer === 'نعم' ? (diabetesAns.details.trim() ? `نعم - ${diabetesAns.details.trim()}` : 'نعم') : 'لا';

      const heartAns = questionnaireAnswers['q_heart'] || { answer: hasHeart, details: heartDetails };
      const finalHeart = heartAns.answer === 'نعم' ? (heartAns.details.trim() ? `نعم - ${heartAns.details.trim()}` : 'نعم') : 'لا';

      const chronicAns = questionnaireAnswers['q_chronic'] || { answer: hasChronic, details: chronicDetails };
      const finalChronic = chronicAns.answer === 'نعم' ? (chronicAns.details.trim() || 'نعم') : '';

      const allergiesAns = questionnaireAnswers['q_allergies'] || { answer: hasAllergies, details: allergiesDetails };
      const finalAllergies = allergiesAns.answer === 'نعم' ? (allergiesAns.details.trim() || 'نعم') : '';

      const computedMedicalHistory = medicalHistory.trim() || autoMedicalParts.join(' | ') || 'سليم - لا يوجد أمراض مزمنة مسجلة';

      const questionnaireObj: PatientQuestionnaire = {
        thyroidIssue: finalThyroid,
        hasDiabetes: finalDiabetes,
        hasHeartDisease: finalHeart,
        chronicDiseases: finalChronic,
        allergies: finalAllergies,
        customAnswers: customAnswersObj,
        generalNotes: generalNotes.trim(),
        filledAt: new Date().toISOString()
      };

      const computedArea = (governorate || cityOrDistrict)
        ? (governorate && cityOrDistrict ? `${governorate} - ${cityOrDistrict}` : (governorate || cityOrDistrict))
        : area.trim();

      const patientData = {
        name: name.trim(),
        phone: phone.trim(),
        whatsappNumber: whatsappNumber.trim() || phone.trim(),
        gender,
        age: age.trim(),
        governorate: governorate.trim(),
        cityOrDistrict: cityOrDistrict.trim(),
        address: address.trim(),
        area: computedArea,
        occupation: occupation.trim(),
        questionnaire: questionnaireObj,
        medicalHistory: computedMedicalHistory,
        updatedAt: new Date().toISOString()
      };

      if (editingPatient) {
        const docRef = doc(ref, editingPatient.id);
        try {
          await updateDoc(docRef, patientData);
        } catch (err: any) {
          handleDbError(err, OperationType.UPDATE, `clinics/${clinic.id}/patients/${editingPatient.id}`);
        }
      } else {
        try {
          await addDoc(ref, {
            clinicId: clinic.id,
            ...patientData,
            createdAt: new Date().toISOString()
          });
        } catch (err: any) {
          handleDbError(err, OperationType.CREATE, `clinics/${clinic.id}/patients`);
        }
      }

      resetForm();

      clearQueryCache();
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patients' } }));
      await fetchPatients();
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء حفظ البيانات: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (p: Patient) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setEditingPatient(p);
    setName(p.name);
    setPhone(p.phone);
    setWhatsappNumber(p.whatsappNumber || p.phone);
    setGender(p.gender === 'أنثى' ? 'أنثى' : 'ذكر');
    setAge(p.age || '');
    setGovernorate(p.governorate || '');
    setCityOrDistrict(p.cityOrDistrict || '');
    setAddress(p.address || '');
    setArea(p.area || '');
    setOccupation(p.occupation || '');
    
    // Questionnaire
    const q = p.questionnaire || {};
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

    setQuestionnaireAnswers(loadedAnswers);

    // Keep legacy state updated as well
    const tVal = q.thyroidIssue || '';
    if (tVal && tVal !== 'لا' && tVal !== 'لا يوجد') {
      setHasThyroid('نعم');
      setThyroidDetails(tVal.startsWith('نعم - ') ? tVal.replace('نعم - ', '') : (tVal === 'نعم' ? '' : tVal));
    } else {
      setHasThyroid('لا');
      setThyroidDetails('');
    }

    const dVal = q.hasDiabetes || '';
    if (dVal && dVal !== 'لا') {
      setHasDiabetes('نعم');
      setDiabetesDetails(dVal.startsWith('نعم - ') ? dVal.replace('نعم - ', '') : (dVal === 'نعم' ? '' : dVal));
    } else {
      setHasDiabetes('لا');
      setDiabetesDetails('');
    }

    const hVal = q.hasHeartDisease || '';
    if (hVal && hVal !== 'لا') {
      setHasHeart('نعم');
      setHeartDetails(hVal.startsWith('نعم - ') ? hVal.replace('نعم - ', '') : (hVal === 'نعم' ? '' : hVal));
    } else {
      setHasHeart('لا');
      setHeartDetails('');
    }

    const cVal = q.chronicDiseases || '';
    if (cVal.trim()) {
      setHasChronic('نعم');
      setChronicDetails(cVal);
    } else {
      setHasChronic('لا');
      setChronicDetails('');
    }

    const aVal = q.allergies || '';
    if (aVal.trim()) {
      setHasAllergies('نعم');
      setAllergiesDetails(aVal);
    } else {
      setHasAllergies('لا');
      setAllergiesDetails('');
    }

    setGeneralNotes(q.generalNotes || '');
    setMedicalHistory(p.medicalHistory || '');

    setIsAdding(true);
    setActiveTab('list');
    
    setTimeout(() => {
      formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const handleDelete = async (id: string) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert('عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ref = getPatientsRef(clinic.id);
      try {
        await deleteDoc(doc(ref, id));
      } catch (err: any) {
        handleDbError(err, OperationType.DELETE, `clinics/${clinic.id}/patients/${id}`);
      }
      await fetchPatients();
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء حذف المريض: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  const isSearchReady = (term: string) => term.trim().length >= 3;

  useEffect(() => {
    if (isSearchReady(searchTerm)) {
      fetchAllPatientsForSearch();
    }
  }, [searchTerm]);

  const filteredPatients = useMemo(() => {
    if (isSearchReady(searchTerm)) {
      const term = searchTerm.toLowerCase();
      return allPatients.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.phone.includes(term) ||
          (p.governorate && p.governorate.toLowerCase().includes(term)) ||
          (p.cityOrDistrict && p.cityOrDistrict.toLowerCase().includes(term)) ||
          (p.area && p.area.toLowerCase().includes(term)) ||
          (p.address && p.address.toLowerCase().includes(term)) ||
          (p.occupation && p.occupation.toLowerCase().includes(term))
      );
    } else if (searchTerm.trim().length > 0) {
      return [];
    }

    return patients;
  }, [patients, allPatients, searchTerm]);

  const isFilteringActive = isSearchReady(searchTerm);
  const displayPatients = isFilteringActive
    ? filteredPatients.slice(0, visibleCount)
    : filteredPatients;

  // --- Marketing & Geographic Analytics Computation ---
  const analyticsData = useMemo(() => {
    const list = allPatients.length > 0 ? allPatients : patients;
    const total = list.length;
    
    let maleCount = 0;
    let femaleCount = 0;
    const areaMap: Record<string, number> = {};
    const occupationMap: Record<string, number> = {};
    const healthMap = {
      thyroid: 0,
      diabetes: 0,
      heart: 0,
      allergies: 0,
      chronic: 0
    };

    list.forEach((p) => {
      // Gender
      if (p.gender === 'أنثى' || p.gender === 'female') femaleCount++;
      else maleCount++;

      // Area / District
      const patientArea = p.area?.trim() || (p.governorate ? (p.cityOrDistrict ? `${p.governorate} - ${p.cityOrDistrict}` : p.governorate) : '');
      const displayArea = patientArea 
        ? formatLocationDisplayName(p.governorate, p.cityOrDistrict, patientArea, isEn)
        : (isEn ? 'Unspecified / Other Areas' : 'غير محددة / مناطق أخرى');
      areaMap[displayArea] = (areaMap[displayArea] || 0) + 1;

      // Occupation
      const rawOcc = p.occupation?.trim();
      const patientOcc = rawOcc || (isEn ? 'Unspecified' : 'غير محددة');
      occupationMap[patientOcc] = (occupationMap[patientOcc] || 0) + 1;

      // Health profile
      const q = p.questionnaire || {};
      const med = p.medicalHistory || '';
      if ((q.thyroidIssue && q.thyroidIssue !== 'لا يوجد') || med.includes('غدة') || med.includes('درقية')) {
        healthMap.thyroid++;
      }
      if ((q.hasDiabetes && q.hasDiabetes !== 'لا') || med.includes('سكر')) {
        healthMap.diabetes++;
      }
      if ((q.hasHeartDisease && q.hasHeartDisease !== 'لا') || med.includes('قلب') || med.includes('ضغط')) {
        healthMap.heart++;
      }
      if (q.allergies?.trim() || med.includes('حساسية')) {
        healthMap.allergies++;
      }
      if (q.chronicDiseases?.trim() || (med && !med.includes('سليم'))) {
        healthMap.chronic++;
      }
    });

    // Sort Areas
    const sortedAreas = Object.entries(areaMap)
      .map(([name, count]) => ({ name, count, percent: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    // Sort Occupations
    const unspecifiedOccLabel = isEn ? 'Unspecified' : 'غير محددة';
    const sortedOccupations = Object.entries(occupationMap)
      .filter(([name]) => name !== unspecifiedOccLabel && name !== 'غير محددة' && name !== 'Unspecified')
      .map(([name, count]) => ({ name, count, percent: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const unspecifiedAreaLabel = isEn ? 'Unspecified / Other Areas' : 'غير محددة / مناطق أخرى';
    const topArea = sortedAreas.find(a => a.name !== unspecifiedAreaLabel && a.name !== 'غير محددة / مناطق أخرى') || sortedAreas[0];

    return {
      total,
      maleCount,
      femaleCount,
      malePercent: total > 0 ? Math.round((maleCount / total) * 100) : 0,
      femalePercent: total > 0 ? Math.round((femaleCount / total) * 100) : 0,
      sortedAreas,
      sortedOccupations,
      healthMap,
      topAreaName: topArea ? topArea.name : '—',
      topAreaPercent: topArea ? topArea.percent : 0
    };
  }, [allPatients, patients, isEn]);

  const openWhatsApp = (phoneNum: string) => {
    const cleanNum = phoneNum.replace(/\D/g, '');
    let formatted = cleanNum;
    if (cleanNum.startsWith('01')) {
      formatted = '2' + cleanNum; // Egypt country code
    }
    window.open(`https://wa.me/${formatted}`, '_blank');
  };

  return (
    <div className="space-y-6 animate-fade-in text-start">
      {/* Header & Main Navigation Tabs */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="h-6 w-6 text-emerald-600" />
            {t('patients.title')}
          </h2>
        </div>

        {/* Navigation Tabs (Records vs Marketing Analytics) */}
        <div className="flex bg-slate-100 p-1 rounded-xl gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs transition cursor-pointer ${
              activeTab === 'list'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="h-4 w-4 text-emerald-600" />
            <span>{t('patients.recordsTab')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs transition cursor-pointer ${
              activeTab === 'analytics'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PieChart className="h-4 w-4 text-indigo-600" />
            <span>{t('patients.analyticsTab')}</span>
          </button>
        </div>
      </div>

      {/* Content for TAB 1: Patients List & Form */}
      {activeTab === 'list' && (
        <div className="space-y-6">
          {/* Upper control bar with integrated Search Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center gap-4 flex-1">
              {/* Search Bar */}
              <div className="flex-1 max-w-md w-full relative">
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2 flex items-center gap-2 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 transition-all">
                  <Search className="h-4 w-4 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={t('patients.searchPlaceholder')}
                    className="w-full bg-transparent focus:outline-none text-slate-800 text-sm font-medium placeholder-slate-400"
                  />
                  {searching && (
                    <RefreshCw className="h-4 w-4 text-emerald-600 animate-spin shrink-0" />
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                onClick={() => {
                  if (isAdding) {
                    resetForm();
                  } else {
                    resetForm();
                    setIsAdding(true);
                  }
                }}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm transition shadow-md shadow-emerald-100 cursor-pointer"
              >
                <UserPlus className="h-4 w-4" />
                {isAdding ? t('common.cancel') : t('patients.addNewPatient')}
              </button>
              <button
                onClick={fetchPatients}
                className="p-2.5 text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition cursor-pointer"
                title={t('common.loading')}
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Search Helper / Status */}
          {searchTerm.trim().length > 0 && (
            <div className="text-xs px-2 flex items-center justify-between">
              {isSearchReady(searchTerm) ? (
                <span className="text-emerald-600 font-bold flex items-center gap-1.5 animate-fade-in bg-emerald-50/40 px-3.5 py-2 rounded-xl border border-emerald-100/50 w-full">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />
                  {isEn ? `Search results: (Found ${filteredPatients.length} patients)` : `نتائج البحث في قاعدة البيانات: (تم العثور على ${filteredPatients.length} من المرضى)`}
                </span>
              ) : (
                <span className="text-amber-600 font-bold flex items-center gap-1.5 animate-fade-in bg-amber-50/40 px-3.5 py-2 rounded-xl border border-amber-100/50 w-full">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  {isEn ? 'Please type 3 or more characters to search...' : 'يرجى كتابة 3 أحرف أو أكثر لبدء البحث والفلترة تلقائياً...'}
                </span>
              )}
            </div>
          )}

          {/* Error Notification */}
          {error && (
            <div className="bg-rose-50 border-r-4 border-rose-500 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-rose-800 text-sm">تنبيه:</h4>
                <p className="text-xs text-rose-700 mt-1 leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {/* Form Anchor */}
          <div ref={formAnchorRef} className="scroll-mt-24" />

          {/* Detailed Patient Registration Form + Pre-exam Questionnaire */}
          {isAdding && (
            <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-md space-y-6 animate-fade-in text-start">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-emerald-600" />
                  {editingPatient ? t('patients.editPatient') : t('patients.addNewPatient')}
                </h3>
              </div>

              {/* Section 1: Demographic & Geographic Data (For Marketing Analysis) */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-black text-indigo-700 bg-indigo-50/70 px-3 py-1.5 rounded-lg w-fit">
                  <Globe className="h-3.5 w-3.5 text-indigo-600" />
                  <span>1. {t('patients.form.basicInfo')}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">{t('patients.form.fullName')} <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('patients.form.fullNamePlaceholder')}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">
                      {t('patients.form.phone')} <span className="text-rose-500">*</span>
                      <span className="text-[10px] text-slate-400 font-normal ms-1">(11 {t('common.search') ? '' : ''})</span>
                    </label>
                    <input
                      type="tel"
                      required
                      maxLength={11}
                      inputMode="numeric"
                      value={phone}
                      onChange={(e) => {
                        const val = formatEgyptianPhoneInput(e.target.value);
                        setPhone(val);
                        if (!whatsappNumber) setWhatsappNumber(val);
                      }}
                      placeholder={t('patients.form.phonePlaceholder')}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono text-start font-bold"
                      dir="ltr"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-600">
                        {t('patients.form.whatsapp')}
                      </label>
                      <button
                        type="button"
                        onClick={() => setWhatsappNumber(phone)}
                        className="text-[11px] text-emerald-600 hover:underline font-bold cursor-pointer"
                      >
                        {t('patients.form.phone')}
                      </button>
                    </div>
                    <input
                      type="tel"
                      maxLength={11}
                      inputMode="numeric"
                      value={whatsappNumber}
                      onChange={(e) => setWhatsappNumber(formatEgyptianPhoneInput(e.target.value))}
                      placeholder={t('patients.form.phonePlaceholder')}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono text-start font-bold"
                      dir="ltr"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">{t('patients.form.gender')}</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as any)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-bold bg-white"
                    >
                      <option value="ذكر">{t('patients.form.male')}</option>
                      <option value="أنثى">{t('patients.form.female')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">{t('patients.form.age')}</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="120"
                      value={age}
                      onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))}
                      placeholder={t('patients.form.agePlaceholder')}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">{t('patients.form.occupation')}</label>
                    <input
                      type="text"
                      value={occupation}
                      onChange={(e) => setOccupation(e.target.value)}
                      placeholder={t('patients.form.occupationPlaceholder')}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                    />
                  </div>

                  {/* المحافظة والمركز والتفاصيل السكنية */}
                  <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-200/70">
                    {/* المحافظة */}
                    <div>
                      <SearchableSelect
                        label={t('patients.form.governorate')}
                        placeholder={t('patients.form.selectGovernorate')}
                        options={governorateOptions}
                        value={isEn ? translateGovernorate(governorate, true) : translateGovernorate(governorate, false)}
                        onChange={handleGovernorateChange}
                        icon={<MapPin className="h-3.5 w-3.5 text-rose-500" />}
                        hint="Egypt Governorates"
                      />
                    </div>

                    {/* المركز / المدينة */}
                    <div>
                      <SearchableSelect
                        label={t('patients.form.cityOrDistrict')}
                        placeholder={governorate ? `${isEn ? translateGovernorate(governorate, true) : translateGovernorate(governorate, false)}...` : t('patients.form.selectCityOrDistrict')}
                        options={centerOptions}
                        value={isEn ? translateCenter(cityOrDistrict, true) : translateCenter(cityOrDistrict, false)}
                        onChange={(val) => setCityOrDistrict(val)}
                        icon={<Building2 className="h-3.5 w-3.5 text-blue-500" />}
                        hint={t('patients.form.cityOrDistrict')}
                      />
                    </div>

                    {/* تفاصيل العنوان السكني */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                        <span>{t('patients.form.address')}</span>
                      </label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={t('patients.form.addressPlaceholder')}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-medium"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Reception Intake Medical Questionnaire (الأسئلة السريعة للاستقبال) */}
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg">
                    <Heart className="h-3.5 w-3.5 text-rose-600" />
                    <span>2. {t('patients.form.questionnaireTitle')}</span>
                  </div>
                </div>

                <div className="space-y-3 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/70">
                  {activeQuestions.map((q, idx) => {
                    const ans = questionnaireAnswers[q.id] || { answer: 'لا', details: '' };
                    const isYes = ans.answer === 'نعم';

                    return (
                      <div key={q.id} className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="md:w-1/3">
                          <label className="block text-xs font-bold text-slate-800">
                            {idx + 1}. {q.text}
                          </label>
                          {q.category && (
                            <span className="inline-block mt-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                              {q.category}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                          {/* Yes/No Toggle */}
                          <div className="flex bg-slate-100 p-1 rounded-xl gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setQuestionAnswer(q.id, 'نعم')}
                              className={`px-4 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                                isYes
                                  ? 'bg-rose-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {t('common.yes')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuestionAnswer(q.id, 'لا', '')}
                              className={`px-4 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                                !isYes
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {t('common.no')}
                            </button>
                          </div>
                          {/* Details Input */}
                          <input
                            type="text"
                            disabled={!isYes}
                            value={ans.details}
                            onChange={(e) => setQuestionAnswer(q.id, 'نعم', e.target.value)}
                            placeholder={isYes ? (q.placeholder || "...") : "..."}
                            className={`w-full px-3.5 py-2 border rounded-xl text-xs font-semibold transition ${
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
                  <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 shadow-2xs">
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      {t('common.notes')}
                    </label>
                    <input
                      type="text"
                      value={generalNotes}
                      onChange={(e) => setGeneralNotes(e.target.value)}
                      placeholder={t('common.notes')}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-medium bg-white focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    {t('patients.form.medicalHistory')}
                  </label>
                  <textarea
                    value={medicalHistory}
                    onChange={(e) => setMedicalHistory(e.target.value)}
                    placeholder={t('patients.form.medicalHistoryPlaceholder')}
                    rows={2}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-5 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl text-xs font-bold transition shadow-md disabled:opacity-50 cursor-pointer flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      {editingPatient ? t('patients.form.updatePatient') : t('patients.form.savePatient')}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Patients Directory Table */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden text-start">
            {loading && patients.length === 0 ? (
              <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
                <RefreshCw className="h-8 w-8 text-emerald-600 animate-spin" />
                <p className="text-sm font-bold">{t('common.loading')}</p>
              </div>
            ) : filteredPatients.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <AlertCircle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-600">{t('patients.empty.title')}</p>
                <p className="text-xs text-slate-400 mt-1">{t('patients.empty.desc')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-4 text-start">{t('patients.table.name')}</th>
                      <th className="p-4 text-start">{t('patients.table.phone')}</th>
                      <th className="p-4 text-start">{t('patients.table.location')}</th>
                      <th className="p-4 text-start">{t('patients.table.occupation')}</th>
                      <th className="p-4 text-start">{t('patients.table.questionnaire')}</th>
                      <th className="p-4 text-end">{t('patients.table.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {displayPatients.map((p, index) => (
                      <tr key={`${p.id || 'patient'}-${index}`} className="hover:bg-slate-50/60 transition">
                        {/* Name & Gender */}
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div>
                              <p className="font-bold text-slate-800">{p.name}</p>
                              <span className={`inline-block mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                p.gender === 'أنثى' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'
                              }`}>
                                {p.gender || 'ذكر'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Phone & WhatsApp */}
                        <td className="p-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-slate-700 font-mono" dir="ltr">
                              <Phone className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span>{p.phone}</span>
                            </div>
                            {p.whatsappNumber && (
                              <button
                                type="button"
                                onClick={() => openWhatsApp(p.whatsappNumber!)}
                                className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg font-bold border border-emerald-200/60 transition cursor-pointer"
                                title="WhatsApp"
                              >
                                <MessageSquare className="h-3 w-3 text-emerald-600" />
                                <span>{t('patients.buttons.whatsapp')}</span>
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Governorate, Center & Detailed Address */}
                        <td className="p-4">
                          <div>
                            {p.governorate || p.cityOrDistrict || p.area ? (
                              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 border border-amber-200/60 text-xs px-2.5 py-1 rounded-xl font-bold">
                                <MapPin className="h-3 w-3 text-amber-600 shrink-0" />
                                {formatLocationDisplayName(p.governorate, p.cityOrDistrict, p.area, isEn)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">{t('common.notSpecified')}</span>
                            )}
                            {p.address && (
                              <p className="text-[11px] text-slate-500 mt-1 truncate max-w-[170px]" title={p.address}>{p.address}</p>
                            )}
                          </div>
                        </td>

                        {/* Occupation & Age */}
                        <td className="p-4">
                          <div className="text-xs">
                            <p className="font-bold text-slate-700">{p.occupation || t('common.notSpecified')}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">{p.age ? `${p.age} ${t('common.years')}` : t('common.notSpecified')}</p>
                          </div>
                        </td>

                        {/* Medical Questionnaire Summary */}
                        <td className="p-4 max-w-xs">
                          {p.medicalHistory ? (
                            <div className="bg-rose-50/60 border border-rose-100 p-2 rounded-xl text-xs text-rose-800 flex items-start gap-1.5">
                              <Heart className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                              <span className="line-clamp-2 font-medium">{p.medicalHistory}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">— {t('common.healthy')}</span>
                          )}
                        </td>

                        {/* Action buttons */}
                        <td className="p-4 text-end">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setFinancialModalPatient(p)}
                              className="p-2 text-amber-700 hover:bg-amber-50 rounded-xl transition flex items-center gap-1 font-bold text-xs border border-amber-200/60 bg-amber-50/40 cursor-pointer"
                              title={t('patients.buttons.financials')}
                            >
                              <Coins className="h-4 w-4 shrink-0" />
                              <span className="hidden lg:inline">{t('patients.buttons.financials')}</span>
                            </button>

                            <button
                              onClick={() => onOpenMedicalFile?.(p.id)}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-xl transition flex items-center gap-1 font-bold text-xs cursor-pointer"
                              title={t('patients.buttons.medicalFile')}
                            >
                              <FileText className="h-4 w-4" />
                              <span className="hidden sm:inline">{t('patients.buttons.medicalFile')}</span>
                            </button>

                            <button
                              onClick={() => handleEdit(p)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition cursor-pointer"
                              title={t('patients.buttons.edit')}
                            >
                              <Edit className="h-4 w-4" />
                            </button>

                            {!isStaff && (deletingPatientId === p.id ? (
                              <div className="flex items-center gap-1 bg-rose-50 p-1 rounded-lg border border-rose-100 animate-fade-in">
                                <button
                                  onClick={() => {
                                    handleDelete(p.id);
                                    setDeletingPatientId(null);
                                  }}
                                  className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] px-2 py-1 rounded font-bold transition cursor-pointer"
                                >
                                  {t('patients.buttons.confirmDelete')}
                                </button>
                                <button
                                  onClick={() => setDeletingPatientId(null)}
                                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] px-2 py-1 rounded font-bold transition cursor-pointer"
                                >
                                  {t('patients.buttons.cancelDelete')}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeletingPatientId(p.id)}
                                className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
                                title={t('patients.buttons.delete')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {/* Load More & Pagination Controls */}
            {isFilteringActive ? (
              <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50">
                <span className="text-xs text-slate-500 font-medium">
                  {t('patients.buttons.currentlyShowing')} <b className="text-slate-800">{Math.min(visibleCount, filteredPatients.length)}</b> {t('patients.buttons.outOf')} <b className="text-slate-800">{filteredPatients.length}</b> {t('patients.buttons.matchingSearch')}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {filteredPatients.length > visibleCount ? (
                    <button
                      type="button"
                      onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Users className="h-3.5 w-3.5 text-white/80" />
                      <span>{t('patients.buttons.showMore')}</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-400 font-semibold bg-slate-100 px-3 py-1.5 rounded-lg">
                      {t('patients.buttons.allDisplayed')}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              patients.length > 0 && (
                <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50">
                  <span className="text-xs text-slate-500 font-medium">
                    {t('patients.buttons.currentlyShowing')} <b className="text-slate-800">{patients.length}</b> {t('patients.buttons.patientsCount')}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasMore ? (
                      <button
                        type="button"
                        onClick={fetchMorePatients}
                        disabled={loadingMore}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-sm transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        {loadingMore ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-white" />
                            <span>{t('patients.buttons.loadingMore')}</span>
                          </>
                        ) : (
                          <>
                            <Users className="h-3.5 w-3.5 text-white/80" />
                            <span>{t('patients.buttons.showMore')}</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400 font-semibold bg-slate-100 px-3 py-1.5 rounded-lg">
                        {t('patients.buttons.allDisplayed')}
                      </span>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Content for TAB 2: Marketing & Geographic Analytics Dashboard */}
      {activeTab === 'analytics' && (
        <div className="space-y-6 animate-fade-in">
          {/* Top KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-2">
                <span>{t('patients.analytics.totalPatients')}</span>
                <Users className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-2xl font-black text-slate-800">{analyticsData.total} <span className="text-xs text-slate-500 font-normal">{t('patients.analytics.patientUnit')}</span></p>
              <p className="text-[11px] text-slate-400 mt-1">{t('patients.analytics.campaignSource')}</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-2">
                <span>{t('patients.analytics.genderDistribution')}</span>
                <PieChart className="h-4 w-4 text-indigo-600" />
              </div>
              <div className="flex items-center justify-between text-sm font-black">
                <span className="text-pink-600">{t('patients.analytics.females')}: {analyticsData.femalePercent}%</span>
                <span className="text-blue-600">{t('patients.analytics.males')}: {analyticsData.malePercent}%</span>
              </div>
              <div className="w-full bg-blue-100 h-2 rounded-full overflow-hidden mt-2 flex">
                <div style={{ width: `${analyticsData.femalePercent}%` }} className="bg-pink-500 h-full" />
                <div style={{ width: `${analyticsData.malePercent}%` }} className="bg-blue-500 h-full" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-2">
                <span>{t('patients.analytics.topArea')}</span>
                <MapPin className="h-4 w-4 text-rose-500" />
              </div>
              <p className="text-lg font-black text-slate-800 truncate">{analyticsData.topAreaName}</p>
              <p className="text-xs text-emerald-600 font-bold mt-1">
                {t('patients.analytics.representsPercent', { percent: analyticsData.topAreaPercent })}
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 text-xs font-bold mb-2">
                <span>{t('patients.analytics.medicalRisks')}</span>
                <Activity className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-2xl font-black text-amber-600">{analyticsData.healthMap.chronic} <span className="text-xs text-slate-500 font-normal">{t('patients.analytics.patientUnit')}</span></p>
              <p className="text-[11px] text-slate-500 mt-1">{t('patients.analytics.medicalCareNote')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Geographic Distribution Breakdown */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-rose-600" />
                  {t('patients.analytics.geoDistribution')}
                </h3>
                <span className="text-xs text-slate-400 font-semibold">{t('patients.analytics.sortedDesc')}</span>
              </div>

              {analyticsData.sortedAreas.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">{t('patients.analytics.noGeoData')}</p>
              ) : (
                <div className="space-y-3">
                  {analyticsData.sortedAreas.map((item, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between text-xs font-bold text-slate-700">
                        <span className="flex items-center gap-1">
                          <span className="text-slate-400 font-mono text-[10px]">#{idx + 1}</span>
                          {item.name}
                        </span>
                        <span>{item.count} {t('patients.analytics.patientUnit')} ({item.percent}%)</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div 
                          style={{ width: `${Math.max(item.percent, 3)}%` }} 
                          className={`h-full rounded-full transition-all duration-500 ${
                            idx === 0 ? 'bg-rose-500' : idx === 1 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Occupations & Demographics Breakdown */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-indigo-600" />
                  {t('patients.analytics.occupationsTitle')}
                </h3>
                <span className="text-xs text-slate-400 font-semibold">{t('patients.analytics.segmentAnalysis')}</span>
              </div>

              {analyticsData.sortedOccupations.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">{t('patients.analytics.noOccupationData')}</p>
              ) : (
                <div className="space-y-3">
                  {analyticsData.sortedOccupations.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px]">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-800">{item.name}</span>
                      </div>
                      <span className="font-bold text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                        {item.count} {t('patients.analytics.patientUnit')} ({item.percent}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Health Risk Factors Statistics */}
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 text-rose-500" />
                  {t('patients.analytics.commonRisks')}
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-100">
                    <span className="text-slate-500 text-[10px] block">{t('patients.analytics.diabetes')}</span>
                    <span className="font-black text-amber-800">{analyticsData.healthMap.diabetes} {t('patients.analytics.patientUnit')}</span>
                  </div>
                  <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-100">
                    <span className="text-slate-500 text-[10px] block">{t('patients.analytics.heart')}</span>
                    <span className="font-black text-rose-800">{analyticsData.healthMap.heart} {t('patients.analytics.patientUnit')}</span>
                  </div>
                  <div className="bg-purple-50 p-2.5 rounded-xl border border-purple-100">
                    <span className="text-slate-500 text-[10px] block">{t('patients.analytics.thyroid')}</span>
                    <span className="font-black text-purple-800">{analyticsData.healthMap.thyroid} {t('patients.analytics.patientUnit')}</span>
                  </div>
                  <div className="bg-blue-50 p-2.5 rounded-xl border border-blue-100">
                    <span className="text-slate-500 text-[10px] block">{t('patients.analytics.allergies')}</span>
                    <span className="font-black text-blue-800">{analyticsData.healthMap.allergies} {t('patients.analytics.patientUnit')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Financials Modal */}
      {financialModalPatient && (
        <PatientFinancialsModal
          isOpen={!!financialModalPatient}
          onClose={() => setFinancialModalPatient(null)}
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
    </div>
  );
}
