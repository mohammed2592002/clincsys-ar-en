import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { db, query, where, setDoc, doc, getAppointmentsRef, cleanDbData, getDocsSmart as getDocs, getDocSmart } from '../dbClient';
import { Appointment, Clinic, Patient } from '../types';
import { Coins, DollarSign, Receipt, Check, RefreshCw, X, Printer, Wallet, Plus, Gift, Sparkles, ChevronDown, ChevronUp, History, Calendar, CreditCard, ArrowLeft, Award, Tag, AlertTriangle } from 'lucide-react';
import { calculateEarnedPoints, calculatePointsRedemption, awardLoyaltyPoints, redeemLoyaltyPoints } from '../utils/loyaltyUtils';
import { formatTimeTo12Hour } from './InteractiveCalendar';
import { useDialogs } from './DialogContext';
import { PrintPreviewModal } from './PrintPreviewModal';
import { resolveProcedureBreakdown } from '../utils';
import { ToothBadge } from './ToothBadge';

interface PatientFinancialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  clinicId: string;
  patientId?: string;
  patientName: string;
  patientPhone?: string;
  onNavigateToFullFile?: (patientId: string) => void;
  initialAppointmentId?: string;
  autoShowPayment?: boolean;
  paymentMethods?: string[];
  activeShiftDate?: string;
  activeShiftId?: string;
  activeShift?: any;
}

export const getEgyptTodayStr = () => {
  try {
    const egyptTime = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
    return egyptTime; // Returns 'YYYY-MM-DD'
  } catch (e) {
    const today = new Date();
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  }
};

// Robust payment method normalizer to handle spelling variations (hamzas, yaas, etc.)
export const normalizePaymentMethod = (method: string | undefined): string => {
  if (!method) return 'كاش';
  const m = method.toLowerCase().trim()
    .replace(/[أإآا]/g, 'ا') // Standardize Alifs
    .replace(/[ىي]/g, 'ي')   // Standardize Yaa / Alif Maksura
    .replace(/[ةه]/g, 'ه');   // Standardize Tehs / Hehs

  if (m === 'cash' || m.includes('كاش') || m.includes('نقدي') || m.includes('نقدى')) return 'كاش';
  if (m === 'card' || m === 'visa' || m.includes('فيزا') || m.includes('بطاق') || m.includes('كارت') || m.includes('شبك')) return 'فيزا';
  if (m === 'instapay' || m.includes('انستا') || m.includes('اينستا')) return 'إنستاباي';
  if (m === 'wallet' || m.includes('محفظ')) return 'محفظة';
  if (m.includes('نقط') || m.includes('نقاط')) return 'نقاط الولاء';
  return method;
};

// Helper to filter out legacy auto-generated payment notes from display
export const cleanNotes = (notes?: string) => {
  if (!notes) return '';
  return notes
    .split('\n')
    .filter(line => !line.trim().startsWith('[تم سداد'))
    .join('\n')
    .trim();
};

// Helper to get or build payments list for an appointment
export const getAppointmentPayments = (app: any): any[] => {
  if (!app) return [];
  const list = app.payments && Array.isArray(app.payments) ? [...app.payments] : [];
  
  const totalPaid = Number(app.paidAmount) || 0;
  const sumInPayments = list.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);

  // If there's an unaccounted paidAmount difference (e.g. initial payment before payments array existed)
  if (totalPaid > sumInPayments) {
    const unrecordedAmount = totalPaid - sumInPayments;
    list.unshift({
      id: 'pay_init_' + (app.id || 'initial'),
      amount: unrecordedAmount,
      paymentMethod: app.paymentMethod || 'كاش',
      date: app.paymentDate || app.date || getEgyptTodayStr(),
      createdAt: app.createdAt || new Date().toISOString(),
      notes: 'الدفعة الأولى السابقة',
      type: 'initial'
    });
  }

  return list;
};

export default function PatientFinancialsModal({
  isOpen,
  onClose,
  clinicId,
  patientId,
  patientName,
  patientPhone,
  onNavigateToFullFile,
  initialAppointmentId,
  autoShowPayment,
  paymentMethods,
  activeShiftDate,
  activeShiftId,
  activeShift
}: PatientFinancialsModalProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const methodsList = React.useMemo(() => {
    const defaultMethods = ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
    const custom = paymentMethods && paymentMethods.length > 0 ? paymentMethods : [];
    const combined = [...defaultMethods];
    custom.forEach(cm => {
      const normCm = normalizePaymentMethod(cm);
      if (!combined.some(m => normalizePaymentMethod(m) === normCm)) {
        combined.push(cm);
      }
    });
    return combined.filter(m => normalizePaymentMethod(m) !== 'نقاط الولاء');
  }, [paymentMethods]);

  // Payment Recording State
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showPaymentBox, setShowPaymentBox] = useState<boolean>(false);
  const paymentBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (methodsList.length > 0 && !paymentMethod) {
      setPaymentMethod(methodsList[0]);
    }
  }, [methodsList]);

  useEffect(() => {
    if (selectedAppId) {
      const app = appointments.find(a => a.id === selectedAppId);
      if (app && app.paymentMethod) {
        const norm = normalizePaymentMethod(app.paymentMethod);
        const matched = methodsList.find(m => normalizePaymentMethod(m) === norm);
        setPaymentMethod(matched || app.paymentMethod);
      } else if (methodsList.length > 0) {
        setPaymentMethod(methodsList[0]);
      }
    }
  }, [selectedAppId]);

  // Loyalty Program & Points Wallet State
  const [clinicData, setClinicData] = useState<Clinic | null>(null);
  const [patientPoints, setPatientPoints] = useState<number>(0);
  const [resolvedPatientId, setResolvedPatientId] = useState<string>('');

  // Dedicated Points Payment Modal State
  const [isPointsModalOpen, setIsPointsModalOpen] = useState<boolean>(false);
  const [pointsAppId, setPointsAppId] = useState<string>('');
  const [pointsInput, setPointsInput] = useState<number | ''>('');
  const [egpInput, setEgpInput] = useState<number | ''>('');
  const [pointsPaymentNotes, setPointsPaymentNotes] = useState<string>('');
  const [isRedeemingPoints, setIsRedeemingPoints] = useState<boolean>(false);

  // Direct Session Discount Modal State
  const [sessionDiscountAppId, setSessionDiscountAppId] = useState<string | null>(null);
  const [sessionDiscountAmount, setSessionDiscountAmount] = useState<number | ''>('');
  const [sessionDiscountNotes, setSessionDiscountNotes] = useState<string>('');
  const [isApplyingSessionDiscount, setIsApplyingSessionDiscount] = useState<boolean>(false);

  const isLoyaltyEnabled = Boolean(clinicData && clinicData.loyaltyProgramEnabled !== false);

  // Points conversion rates (e.g., 1000 pts = 250 EGP => 0.25 EGP/pt)
  const redeemThreshold = (clinicData?.loyaltyRedeemPointsThreshold && Number(clinicData.loyaltyRedeemPointsThreshold) > 0)
    ? Number(clinicData.loyaltyRedeemPointsThreshold)
    : 1000;
  const redeemEgp = (clinicData?.loyaltyRedeemDiscountEgp && Number(clinicData.loyaltyRedeemDiscountEgp) > 0)
    ? Number(clinicData.loyaltyRedeemDiscountEgp)
    : 250;
  const minRedeemPoints = (clinicData?.loyaltyMinRedeemPoints && Number(clinicData.loyaltyMinRedeemPoints) > 0)
    ? Number(clinicData.loyaltyMinRedeemPoints)
    : 0;

  const egpPerPoint = redeemEgp / redeemThreshold; // EGP for 1 point
  const pointsPerEgp = redeemThreshold / redeemEgp; // Points for 1 EGP
  const minRedeemEgp = Math.round(minRedeemPoints * egpPerPoint * 100) / 100;
  const maxWalletEgp = Math.floor(patientPoints * egpPerPoint * 100) / 100;

  // Live Two-Way Calculation Handlers for Points Payment
  const handlePointsInputChange = (val: number | '') => {
    setPointsInput(val);
    if (val === '' || isNaN(Number(val)) || Number(val) <= 0) {
      setEgpInput('');
      return;
    }
    const calcEgp = Math.round(Number(val) * egpPerPoint * 100) / 100;
    setEgpInput(calcEgp);
  };

  const handleEgpInputChange = (val: number | '') => {
    setEgpInput(val);
    if (val === '' || isNaN(Number(val)) || Number(val) <= 0) {
      setPointsInput('');
      return;
    }
    const calcPts = Math.ceil(Number(val) * pointsPerEgp);
    setPointsInput(calcPts);
  };

  const openPointsPaymentModal = (targetAppId?: string) => {
    if (minRedeemPoints > 0 && patientPoints < minRedeemPoints) {
      dialogs.alert(`عفواً، الحد الأدنى لاستبدال النقاط هو ${minRedeemPoints} نقطة (ما يعادل ${minRedeemEgp} ج.م). رصيد المريض الحالي (${patientPoints} نقطة) أقل من الحد الأدنى المسموح به.`, { severity: 'warning' });
      return;
    }
    const defaultApp = appointments.find(a => a.id === targetAppId) || appointments.find(a => (a.remainingAmount || 0) > 0) || appointments[0];
    if (defaultApp) {
      setPointsAppId(defaultApp.id);
      const rem = defaultApp.remainingAmount !== undefined ? Number(defaultApp.remainingAmount) : 0;
      if (rem > 0 && patientPoints > 0) {
        const initialEgp = Math.min(rem, maxWalletEgp);
        handleEgpInputChange(initialEgp);
      } else {
        setPointsInput('');
        setEgpInput('');
      }
    } else {
      setPointsInput('');
      setEgpInput('');
    }
    setPointsPaymentNotes('');
    setIsPointsModalOpen(true);
  };

  // Expandable Installment History state
  const [expandedHistories, setExpandedHistories] = useState<{ [appId: string]: boolean }>({});

  // Printing State
  const [printingApp, setPrintingApp] = useState<Appointment | null>(null);

  const fetchFinancialRecords = async () => {
    if (!clinicId || (!patientId && !patientName)) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch clinic data for loyalty settings
      try {
        const clinicSnap = await getDocSmart(doc(db, 'clinics', clinicId));
        if (clinicSnap.exists()) {
          setClinicData({ id: clinicSnap.id, ...clinicSnap.data() } as Clinic);
        }
      } catch (cErr) {
        console.warn("Could not fetch clinic doc:", cErr);
      }

      const ref = getAppointmentsRef(clinicId);
      let loadedApps: Appointment[] = [];

      if (patientId) {
        const q = query(ref, where("patientId", "==", patientId));
        const snap = await getDocs(q);
        snap.forEach(d => loadedApps.push({ id: d.id, ...d.data() } as Appointment));
      }

      // If no appointments found by ID (or if patientId was not provided), try by phone or exact name
      if (loadedApps.length === 0 && patientPhone) {
        const qPhone = query(ref, where("patientPhone", "==", patientPhone));
        const snapPhone = await getDocs(qPhone);
        snapPhone.forEach(d => {
          if (!loadedApps.some(a => a.id === d.id)) {
            loadedApps.push({ id: d.id, ...d.data() } as Appointment);
          }
        });
      }

      if (loadedApps.length === 0 && patientName) {
        const qName = query(ref, where("patientName", "==", patientName));
        const snapName = await getDocs(qName);
        snapName.forEach(d => {
          if (!loadedApps.some(a => a.id === d.id)) {
            loadedApps.push({ id: d.id, ...d.data() } as Appointment);
          }
        });
      }

      // Sort by date descending and filter out cancelled appointments
      loadedApps = loadedApps.filter(a => a.status !== 'cancelled');
      loadedApps.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setAppointments(loadedApps);

      // Resolve Patient ID and fetch loyalty points
      const targetPatientId = patientId || (loadedApps.length > 0 ? loadedApps[0].patientId : '');
      if (targetPatientId) {
        setResolvedPatientId(targetPatientId);
        try {
          const pSnap = await getDocSmart(doc(db, `clinics/${clinicId}/patients`, targetPatientId));
          if (pSnap.exists()) {
            const pData = pSnap.data();
            setPatientPoints(Number(pData.loyaltyPoints) || 0);
          }
        } catch (pErr) {
          console.warn("Could not fetch patient loyalty points:", pErr);
        }
      }

      // Check if there is an initialAppointmentId and it exists in loadedApps
      const initialApp = initialAppointmentId ? loadedApps.find(a => a.id === initialAppointmentId) : null;
      if (initialApp) {
        setSelectedAppId(initialApp.id);
        const rem = initialApp.remainingAmount !== undefined ? initialApp.remainingAmount : 0;
        setPaymentAmount(rem > 0 ? rem : initialApp.price);
      } else {
        // Auto select the first unpaid or pending appointment
        const firstUnpaid = loadedApps.find(a => {
          const rem = a.remainingAmount !== undefined ? a.remainingAmount : 0;
          return rem > 0 || a.invoiceStatus === 'pending_payment';
        });
        if (firstUnpaid) {
          setSelectedAppId(firstUnpaid.id);
          const rem = firstUnpaid.remainingAmount !== undefined ? firstUnpaid.remainingAmount : 0;
          setPaymentAmount(rem > 0 ? rem : firstUnpaid.price);
        } else if (loadedApps.length > 0) {
          setSelectedAppId(loadedApps[0].id);
          setPaymentAmount(0);
        }
      }
    } catch (err: any) {
      console.error("Error fetching patient financials:", err);
      setError("حدث خطأ أثناء تحميل الحسابات والأقساط: " + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      fetchFinancialRecords();
      setPrintingApp(null);
      setShowPaymentBox(!!autoShowPayment);
      if (methodsList.length > 0) {
        setPaymentMethod(methodsList[0]);
      }
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, clinicId, patientId, patientName, autoShowPayment, initialAppointmentId, methodsList]);

  // Calculate overall metrics
  const totalCost = appointments.reduce((sum, app) => sum + (Number(app.price) || 0), 0);
  const totalPaid = appointments.reduce((sum, app) => {
    const paid = app.paidAmount !== undefined ? Number(app.paidAmount) : Number(app.price) || 0;
    return sum + paid;
  }, 0);
  const totalRemaining = appointments.reduce((sum, app) => {
    const rem = app.remainingAmount !== undefined ? Number(app.remainingAmount) : 0;
    return sum + rem;
  }, 0);

  const selectedAppointmentObj = appointments.find(a => a.id === selectedAppId);

  const handleConfirmPointsPayment = async () => {
    const pts = Number(pointsInput);
    const egp = Number(egpInput);

    if (!pointsAppId) {
      dialogs.alert("يرجى اختيار الجلسة المراد السداد عليها أولاً", { severity: 'warning' });
      return;
    }
    if (!pts || pts <= 0 || !egp || egp <= 0) {
      dialogs.alert("يرجى إدخال قيم صحيحة للنقاط والمبلغ المدفوع", { severity: 'warning' });
      return;
    }
    if (pts > patientPoints) {
      dialogs.alert(`عفواً، عدد النقاط المطلوب (${pts} نقطة) أكبر من الرصيد المتوفر في محفظة المريض (${patientPoints} نقطة).`, { severity: 'warning' });
      return;
    }
    if (minRedeemPoints > 0 && pts < minRedeemPoints) {
      dialogs.alert(`عفواً، عدد النقاط المطلوب (${pts} نقطة) أقل من الحد الأدنى المسموح به للاستبدال (${minRedeemPoints} نقطة - ما يعادل ${minRedeemEgp} ج.م).`, { severity: 'warning' });
      return;
    }

    const app = appointments.find(a => a.id === pointsAppId);
    if (!app) return;

    const currentPaid = app.paidAmount !== undefined ? Number(app.paidAmount) : Number(app.price) || 0;
    const currentRemaining = app.remainingAmount !== undefined ? Number(app.remainingAmount) : 0;

    if (egp > currentRemaining) {
      dialogs.alert(`عفواً، المبلغ المدفوع بالنقاط (${egp} ج.م) أكبر من المتبقي على الجلسة (${currentRemaining} ج.م).`, { severity: 'warning' });
      return;
    }

    setIsRedeemingPoints(true);
    try {
      // 1. Deduct points from patient wallet in Firestore
      const newBalance = await redeemLoyaltyPoints(clinicId, resolvedPatientId, pts);

      // 2. Record payment on appointment with method "نقاط الولاء"
      const docRef = doc(getAppointmentsRef(clinicId), app.id);
      const newPaid = currentPaid + egp;
      const newRemaining = Math.max(0, currentRemaining - egp);
      const newPrice = Math.max(Number(app.price) || 0, newPaid);
      const newStatus = newRemaining === 0 ? 'paid' : 'installment';

      const existingPayments = app.payments && Array.isArray(app.payments) ? app.payments : [];
      const resolvedPayments = [...existingPayments];
      if (resolvedPayments.length === 0 && currentPaid > 0) {
        resolvedPayments.push({
          id: 'pay_init_' + app.id,
          amount: currentPaid,
          paymentMethod: app.paymentMethod || 'كاش',
          date: app.date || getEgyptTodayStr(),
          createdAt: app.updatedAt || app.createdAt || new Date().toISOString(),
          notes: 'دفعة أولى (تلقائية)',
          type: 'initial'
        });
      }

      const resolvedShiftId = activeShiftId || (activeShift ? activeShift.id : undefined);
      const noteDetail = `[تم السداد من محفظة النقاط: خصم ${pts} نقطة مقابل ${egp} ج.م] ${pointsPaymentNotes.trim() ? `(${pointsPaymentNotes.trim()})` : ''}`;
      const newPaymentRecord = {
        id: 'pay_' + Math.random().toString(36).substring(2, 11),
        amount: egp,
        paymentMethod: 'نقاط الولاء',
        date: (activeShift && activeShift.date) || activeShiftDate || getEgyptTodayStr(),
        createdAt: new Date().toISOString(),
        shiftId: resolvedShiftId || undefined,
        notes: noteDetail,
        type: 'installment'
      };

      const updatedPayments = [...resolvedPayments, newPaymentRecord];
      const updatedNotes = cleanNotes(app.notes || '') + `\n• ${noteDetail}`;

      await setDoc(docRef, cleanDbData({
        ...(app || {}),
        paidAmount: newPaid,
        remainingAmount: newRemaining,
        price: newPrice,
        invoiceStatus: newStatus,
        notes: updatedNotes.trim(),
        paymentMethod: app.paymentMethod || 'نقاط الولاء',
        shiftId: resolvedShiftId || app.shiftId || undefined,
        updatedAt: new Date().toISOString(),
        payments: updatedPayments
      }), { merge: true });

      dialogs.alert(`تم سداد ${egp} ج.م بنجاح عبر محفظة النقاط! (خصم ${pts} نقطة - الرصيد المتبقي: ${newBalance} نقطة).`, { severity: 'success' });

      setPatientPoints(newBalance);
      setIsPointsModalOpen(false);
      setPointsInput('');
      setEgpInput('');
      setPointsPaymentNotes('');
      setShowPaymentBox(false);

      await fetchFinancialRecords();
    } catch (err: any) {
      console.error("Error confirming points payment:", err);
      dialogs.alert("فشل السداد بالنقاط: " + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setIsRedeemingPoints(false);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppId) {
      dialogs.alert("يرجى تحديد جلسة أو موعد لتسجيل الدفعة عليه", { severity: 'warning' });
      return;
    }

    if (normalizePaymentMethod(paymentMethod) === 'نقاط الولاء') {
      openPointsPaymentModal(selectedAppId);
      return;
    }

    const amt = Number(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      dialogs.alert("يرجى إدخال مبلغ صحيح أكبر من الصفر", { severity: 'warning' });
      return;
    }

    const app = appointments.find(a => a.id === selectedAppId);
    if (!app) {
      dialogs.alert("يرجى اختيار الجلسة أولاً", { severity: 'warning' });
      return;
    }

    const currentPaid = app.paidAmount !== undefined ? Number(app.paidAmount) : Number(app.price) || 0;
    const currentRemaining = app.remainingAmount !== undefined ? Number(app.remainingAmount) : 0;

    if (currentRemaining <= 0 || app.invoiceStatus === 'paid' || (currentPaid >= (Number(app.price) || 0) && (Number(app.price) || 0) > 0)) {
      dialogs.alert("عفواً، تم سداد تكلفة هذه الجلسة بالكامل ولا يوجد مبلغ متبقي لتحصيله!", { severity: 'warning' });
      return;
    }

    if (amt > currentRemaining) {
      dialogs.alert(`عفواً، المبلغ المدخل (${amt} ج.م) أكبر من القسط المتبقي على هذه الجلسة (${currentRemaining} ج.م). لا يمكن تحصيل مبلغ أكبر من المستحق.`, { severity: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Award points earned on cash/visa/etc payment
      let newlyEarnedPts = 0;
      if (isLoyaltyEnabled && clinicData && clinicId && resolvedPatientId) {
        newlyEarnedPts = calculateEarnedPoints(amt, clinicData);
        if (newlyEarnedPts > 0) {
          const updatedPts = await awardLoyaltyPoints(clinicId, resolvedPatientId, newlyEarnedPts);
          setPatientPoints(updatedPts);
        }
      }

      const docRef = doc(getAppointmentsRef(clinicId), app.id);
      const newPaid = currentPaid + amt;
      const newRemaining = Math.max(0, currentRemaining - amt);
      const newPrice = Math.max(Number(app.price) || 0, newPaid);
      const newStatus = newRemaining === 0 ? 'paid' : 'installment';

      const selectedMethod = paymentMethod || methodsList[0] || 'كاش';

      const existingPayments = app.payments && Array.isArray(app.payments) ? [...app.payments] : [];
      const sumExisting = existingPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
      const resolvedPayments = [...existingPayments];
      if (currentPaid > sumExisting) {
        resolvedPayments.unshift({
          id: 'pay_init_' + app.id,
          amount: currentPaid - sumExisting,
          paymentMethod: app.paymentMethod || 'كاش',
          date: app.paymentDate || app.date || getEgyptTodayStr(),
          createdAt: app.updatedAt || app.createdAt || new Date().toISOString(),
          notes: 'الدفعة الأولى السابقة',
          type: 'initial'
        });
      }

      const resolvedShiftId = activeShiftId || (activeShift ? activeShift.id : undefined);
      const newPaymentRecord = {
        id: 'pay_' + Math.random().toString(36).substring(2, 11),
        amount: amt,
        paymentMethod: selectedMethod,
        date: (activeShift && activeShift.date) || activeShiftDate || getEgyptTodayStr(),
        createdAt: new Date().toISOString(),
        shiftId: resolvedShiftId || undefined,
        notes: paymentNotes ? `سداد قسط: ${paymentNotes}` : 'سداد قسط',
        type: 'installment'
      };

      const updatedPayments = [...resolvedPayments, newPaymentRecord];
      const updatedNotes = cleanNotes(app.notes || '') + (paymentNotes.trim() ? `\n• ${paymentNotes.trim()}` : '');

      await setDoc(docRef, cleanDbData({
        ...(app || {}),
        paidAmount: newPaid,
        remainingAmount: newRemaining,
        price: newPrice,
        invoiceStatus: newStatus,
        notes: updatedNotes.trim(),
        paymentMethod: selectedMethod,
        shiftId: resolvedShiftId || app.shiftId || undefined,
        updatedAt: new Date().toISOString(),
        payments: updatedPayments
      }), { merge: true });

      // Dispatch sync events so calendar and financials update in real time
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'appointments' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'records' } }));

      let successMsg = `تم تحصيل القسط بقيمة (${amt} ج.م) وتحديث حساب المريض بنجاح!`;
      if (newlyEarnedPts > 0) {
        successMsg += `\n✨ وحصل المريض على +${newlyEarnedPts} نقطة ولاء جديدة!`;
      }

      dialogs.alert(successMsg, { severity: 'success' });

      setPaymentAmount(0);
      setPaymentNotes('');
      setShowPaymentBox(false);

      await fetchFinancialRecords();
    } catch (err: any) {
      console.error("Error updating payment:", err);
      dialogs.alert("فشل تحديث الحساب: " + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmSessionDiscount = async () => {
    if (!sessionDiscountAppId || !sessionDiscountAmount || Number(sessionDiscountAmount) <= 0) {
      dialogs.alert("يرجى إدخال مبلغ الخصم المراد تأكيده بشكل صحيح", { severity: 'warning' });
      return;
    }
    const app = appointments.find(a => a.id === sessionDiscountAppId);
    if (!app) return;

    const discountVal = Number(sessionDiscountAmount);
    const currentPrice = Number(app.price) || 0;
    const currentPaid = Number(app.paidAmount) || 0;
    const currentRem = app.remainingAmount !== undefined ? Number(app.remainingAmount) : Math.max(0, currentPrice - currentPaid);

    if (discountVal > currentRem) {
      dialogs.alert(`عفواً، مبلغ الخصم (${discountVal} ج.م) أكبر من المتبقي على هذه الجلسة (${currentRem} ج.م)!`, { severity: 'warning' });
      return;
    }

    setIsApplyingSessionDiscount(true);
    try {
      const docRef = doc(getAppointmentsRef(clinicId), app.id);
      const newPrice = Math.max(currentPaid, currentPrice - discountVal);
      const newRem = Math.max(0, currentRem - discountVal);
      const newStatus = newRem === 0 ? 'paid' : 'installment';
      const noteText = `\n• [تم تأكيد خصم خاص بقيمة ${discountVal} ج.م] ${sessionDiscountNotes.trim() ? `(${sessionDiscountNotes.trim()})` : ''}`;

      await setDoc(docRef, cleanDbData({
        ...(app || {}),
        price: newPrice,
        remainingAmount: newRem,
        invoiceStatus: newStatus,
        notes: (cleanNotes(app.notes || '') + noteText).trim()
      }), { merge: true });

      dialogs.alert(`تم تأكيد الخصم بقيمة ${discountVal} ج.م وتحديث باقي حساب الجلسة بنجاح!`, { severity: 'success' });
      setSessionDiscountAppId(null);
      setSessionDiscountAmount('');
      setSessionDiscountNotes('');
      await fetchFinancialRecords();
    } catch (err: any) {
      console.error("Error applying session discount:", err);
      dialogs.alert("حدث خطأ أثناء تأكيد الخصم: " + err.message, { severity: 'error' });
    } finally {
      setIsApplyingSessionDiscount(false);
    }
  };

  const getPaymentMethodLabel = (method?: string) => {
    const norm = normalizePaymentMethod(method);
    if (norm === 'كاش') return isEn ? 'Cash' : 'كاش';
    if (norm === 'فيزا') return isEn ? 'Visa / Card' : 'فيزا';
    if (norm === 'إنستاباي') return isEn ? 'InstaPay' : 'إنستاباي';
    if (norm === 'محفظة') return isEn ? 'E-Wallet' : 'محفظة إلكترونية';
    if (norm === 'نقاط الولاء') return isEn ? 'Loyalty Points' : 'نقاط الولاء';
    return method || (isEn ? 'Cash' : 'كاش');
  };

  const toggleHistoryExpand = (appId: string) => {
    setExpandedHistories(prev => ({
      ...prev,
      [appId]: !prev[appId]
    }));
  };

  const handlePrint = (app: Appointment) => {
    setPrintingApp(app);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-md"
          dir={isEn ? 'ltr' : 'rtl'}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 15 }}
            transition={{ type: "spring", duration: 0.35 }}
            className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200/90"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
                  <Coins className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    {isEn ? 'Patient Account Statement & Installments' : 'كشف الحساب والأقساط'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium flex items-center gap-2 mt-0.5">
                    <span>{isEn ? 'Patient:' : 'المريض:'} <strong className="text-slate-200">{patientName}</strong></span>
                    {patientPhone && <span className="font-mono text-slate-400" dir="ltr">• {patientPhone}</span>}
                  </p>
                </div>
              </div>

              {/* Right Side Header Loyalty Badge */}
              <div className="flex items-center gap-3">
                {isLoyaltyEnabled && (
                  <div className="flex items-center gap-1.5 bg-amber-500/10 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-xl text-xs font-bold">
                    <Gift className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>{isEn ? 'Loyalty Points:' : 'نقاط الولاء:'}</span>
                    <span className="font-mono text-amber-200 text-sm font-black">{patientPoints}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                  title={isEn ? 'Close' : 'إغلاق'}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50/50">
              {loading ? (
                <div className="py-20 text-center text-slate-400 space-y-3">
                  <RefreshCw className="h-8 w-8 animate-spin mx-auto text-emerald-600" />
                  <p className="font-bold text-sm text-slate-600">{isEn ? 'Loading patient statement and installments...' : 'جاري تحميل كشف الحساب والأقساط...'}</p>
                </div>
              ) : error ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 font-bold text-xs">
                  {error}
                </div>
              ) : (
                <>
                  {/* Financial Metrics Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Total Cost */}
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
                      <div>
                        <span className="text-xs text-slate-500 font-bold block mb-1">{isEn ? 'Total Bill (Cost)' : 'إجمالي الحساب (التكلفة)'}</span>
                        <span className="text-lg font-black text-slate-900 font-mono">
                          {totalCost.toLocaleString()} <span className="text-xs font-normal text-slate-500">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>
                      <div className="p-2.5 bg-slate-100 rounded-xl text-slate-600">
                        <Receipt className="h-5 w-5" />
                      </div>
                    </div>

                    {/* Paid */}
                    <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 shadow-2xs flex items-center justify-between">
                      <div>
                        <span className="text-xs text-emerald-800 font-bold block mb-1">{isEn ? 'Total Paid' : 'المحّصل الفعلي (المدفوع)'}</span>
                        <span className="text-lg font-black text-emerald-700 font-mono">
                          {totalPaid.toLocaleString()} <span className="text-xs font-normal text-emerald-600">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>
                      <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
                        <Check className="h-5 w-5" />
                      </div>
                    </div>

                    {/* Remaining */}
                    <div className={`p-4 rounded-2xl border shadow-2xs flex items-center justify-between ${
                      totalRemaining > 0
                        ? 'bg-red-50/90 border-red-200 text-red-950'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}>
                      <div>
                        <span className={`text-xs font-bold block mb-1 ${totalRemaining > 0 ? 'text-red-800' : 'text-slate-700'}`}>{isEn ? 'Remaining Balance' : 'المتبقي (الأقساط المستحقة)'}</span>
                        <span className={`text-lg font-black font-mono ${totalRemaining > 0 ? 'text-red-600' : 'text-slate-600'}`}>
                          {totalRemaining.toLocaleString()} <span className="text-xs font-normal">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>
                      <div className={`p-2.5 rounded-xl ${totalRemaining > 0 ? 'bg-red-100 text-red-600' : 'bg-slate-200 text-slate-600'}`}>
                        <Wallet className="h-5 w-5" />
                      </div>
                    </div>
                  </div>

                  {/* Payment Collector Panel */}
                  {!showPaymentBox ? (
                    <div className="flex items-center justify-between bg-white border border-slate-200 p-4 rounded-2xl shadow-2xs hover:border-slate-300 transition">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-2xs">
                          <Plus className="h-5 w-5" />
                        </div>
                        <div>
                          <span className="font-bold text-slate-900 text-sm block">
                            {isEn ? 'Collect New Payment / Installment' : 'تحصيل دفعة أو قسط جديد'}
                          </span>
                          <p className="text-xs text-slate-500 font-medium mt-0.5">
                            {isEn ? 'Record due installment payments for patient sessions instantly.' : 'سجل الدفعات المستحقة على جلسات المريض فوراً بكل سهولة.'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPaymentBox(true);
                          if (!selectedAppId && appointments.length > 0) {
                            const firstPending = appointments.find(a => (a.remainingAmount !== undefined ? a.remainingAmount : 0) > 0) || appointments[0];
                            if (firstPending) {
                              setSelectedAppId(firstPending.id);
                              const rem = firstPending.remainingAmount !== undefined ? firstPending.remainingAmount : 0;
                              if (rem > 0) setPaymentAmount(rem);
                            }
                          }
                          setTimeout(() => {
                            paymentBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }, 50);
                        }}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <Wallet className="h-4 w-4" />
                        {isEn ? 'New Payment' : 'سداد دفعة جديدة'}
                      </button>
                    </div>
                  ) : (
                    <div ref={paymentBoxRef} className="bg-white p-5 rounded-2xl border-2 border-emerald-500 shadow-sm space-y-4">
                      {/* Form Header */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-5 w-5 text-emerald-600" />
                          <h4 className="font-bold text-slate-900 text-sm">{isEn ? 'Record New Payment / Installment' : 'تسجيل تحصيل دفعة / قسط جديد'}</h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowPaymentBox(false)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                          title={isEn ? 'Close Form' : 'إغلاق النموذج'}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {appointments.length === 0 ? (
                        <p className="text-xs text-slate-400 py-3 text-center">{isEn ? 'No patient sessions recorded to collect payment.' : 'لا توجد جلسات مسجلة للمريض لتسجيل قسط عليها.'}</p>
                      ) : (
                        <div className="space-y-4">
                          {/* Patient Points Wallet Card */}
                          {isLoyaltyEnabled && (
                            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/90 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-xs shrink-0">
                                  <Gift className="h-5 w-5" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-amber-950 text-xs">{isEn ? 'Patient Loyalty Wallet' : 'محفظة نقاط الولاء للمريض'}</span>
                                    <span className="bg-amber-200/70 text-amber-900 font-mono text-[11px] font-black px-2 py-0.5 rounded-full">
                                      {patientPoints} {isEn ? 'pts' : 'نقطة'}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-amber-800 font-medium mt-0.5">
                                    {isEn ? 'Available Cash Value:' : 'القيمة النقدية المتاحة بالنقاط:'} <strong className="font-mono font-bold text-emerald-800">{maxWalletEgp} {isEn ? 'EGP' : 'ج.م'}</strong> ({redeemThreshold} {isEn ? 'pts' : 'نقطة'} = {redeemEgp} {isEn ? 'EGP' : 'ج.م'}{minRedeemPoints > 0 ? ` • ${isEn ? 'Min:' : 'الحد الأدنى:'} ${minRedeemPoints} ${isEn ? 'pts' : 'نقطة'}` : ''})
                                  </p>
                                </div>
                              </div>
                              {patientPoints > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openPointsPaymentModal(selectedAppId)}
                                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-2xs transition shrink-0 cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                  <Gift className="h-4 w-4" />
                                  {isEn ? 'Pay with Points' : 'دفع باستخدام النقاط'}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Payment Form Fields */}
                          <form onSubmit={handleRecordPayment} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                            <div className="sm:col-span-5">
                              <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Select Session *' : 'اختر الجلسة *'}</label>
                              <select
                                value={selectedAppId}
                                onChange={(e) => {
                                  const id = e.target.value;
                                  setSelectedAppId(id);
                                  const sel = appointments.find(a => a.id === id);
                                  if (sel) {
                                    const rem = sel.remainingAmount !== undefined ? Number(sel.remainingAmount) : 0;
                                    const paid = sel.paidAmount !== undefined ? Number(sel.paidAmount) : Number(sel.price) || 0;
                                    if (rem <= 0 || sel.invoiceStatus === 'paid' || (paid >= (Number(sel.price) || 0) && (Number(sel.price) || 0) > 0)) {
                                      dialogs.alert(isEn ? "This session has been fully paid with no remaining balance!" : "تم سداد تكلفة هذه الجلسة بالكامل ولا يوجد مبلغ متبقي لتحصيله!", { severity: 'warning' });
                                      setPaymentAmount(0);
                                    } else {
                                      setPaymentAmount(rem);
                                    }
                                  }
                                }}
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                              >
                                {appointments.map(app => {
                                  const rem = app.remainingAmount !== undefined ? app.remainingAmount : 0;
                                  return (
                                    <option key={app.id} value={app.id}>
                                      {app.date} • {app.treatmentType || (isEn ? 'Treatment' : 'علاج')} {rem > 0 ? `(${isEn ? 'Due:' : 'متبقي:'} ${rem} ${isEn ? 'EGP' : 'ج.م'})` : `(${isEn ? 'Paid' : 'خالص'})`}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            <div className="sm:col-span-3">
                              <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Amount to Collect (EGP) *' : 'المبلغ التحصيل الآن (ج.م) *'}</label>
                              <input
                                type="number"
                                min="1"
                                required
                                inputMode="decimal"
                                value={paymentAmount || ''}
                                onChange={(e) => setPaymentAmount(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                                placeholder={isEn ? 'Amount' : 'المبلغ'}
                                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-black font-mono text-emerald-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Payment Method' : 'طريقة الدفع'}</label>
                              <select
                                value={paymentMethod}
                                onChange={(e: any) => setPaymentMethod(e.target.value)}
                                className="w-full px-2.5 py-2 border border-slate-300 rounded-xl text-xs font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                              >
                                {methodsList.map((m) => {
                                  const norm = normalizePaymentMethod(m);
                                  let label = m;
                                  if (norm === 'كاش') label = isEn ? '💵 Cash' : '💵 كاش';
                                  else if (norm === 'فيزا') label = isEn ? '💳 Visa / Card' : '💳 فيزا';
                                  else if (norm === 'إنستاباي') label = isEn ? '⚡ InstaPay' : '⚡ إنستاباي';
                                  else if (norm === 'محفظة') label = isEn ? '📱 E-Wallet' : '📱 محفظة';
                                  return (
                                    <option key={m} value={m}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            <div className="sm:col-span-2">
                              <button
                                type="submit"
                                disabled={isSubmitting || !selectedAppId}
                                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-2xs transition flex items-center justify-center gap-1 cursor-pointer"
                              >
                                {isSubmitting ? (
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Check className="h-4 w-4" />
                                    {isEn ? 'Confirm' : 'تأكيد'}
                                  </>
                                )}
                              </button>
                            </div>

                            <div className="sm:col-span-12">
                              <input
                                type="text"
                                value={paymentNotes}
                                onChange={(e) => setPaymentNotes(e.target.value)}
                                placeholder={isEn ? 'Payment note (optional)...' : 'ملاحظة حول السداد (اختياري)...'}
                                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                              />
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sessions & Invoices Breakdown */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <h4 className="font-bold text-xs text-slate-800 flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-slate-600" />
                        <span>{isEn ? `Sessions & Installments History (${appointments.length})` : `سجل الجلسات والأقساط (${appointments.length})`}</span>
                      </h4>
                    </div>

                    {appointments.length === 0 ? (
                      <div className="p-10 text-center bg-white border border-slate-200 rounded-2xl text-slate-400 font-medium text-xs">
                        {isEn ? 'No previous sessions or accounts recorded for this patient.' : 'لا توجد حسابات أو جلسات سابقة مسجلة للمريض.'}
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                        {appointments.map((app) => {
                          const paid = app.paidAmount !== undefined ? Number(app.paidAmount) : Number(app.price) || 0;
                          const rem = app.remainingAmount !== undefined ? Number(app.remainingAmount) : 0;
                          const historyPayments = getAppointmentPayments(app);
                          const isExpanded = !!expandedHistories[app.id];

                          return (
                            <div
                              key={app.id}
                              className={`p-4 rounded-2xl border transition space-y-3 ${
                                rem > 0
                                  ? 'bg-rose-50/20 border-rose-200/80'
                                  : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              {/* Session Top Row */}
                              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg">
                                    {app.date} • {formatTimeTo12Hour(app.time)}
                                  </span>
                                  {rem === 0 ? (
                                    <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200">
                                      {isEn ? '✓ Fully Paid' : '✓ خالص الحساب'}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] bg-red-100 text-red-800 px-2.5 py-0.5 rounded-full font-bold border border-red-200">
                                      {isEn ? `Due Installment: ${rem.toLocaleString()} EGP` : `متبقي قسط: ${rem.toLocaleString()} ج.م`}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 font-mono text-xs">
                                  <span className="text-slate-500">{isEn ? 'Cost:' : 'التكلفة:'} <strong className="text-slate-900">{Number(app.price).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</strong></span>
                                  <span className="text-emerald-700">| {isEn ? 'Paid:' : 'المدفوع:'} <strong>{paid.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</strong></span>
                                </div>
                              </div>

                              {/* Procedures & Details */}
                              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                <div className="space-y-1 text-xs">
                                  <div className="font-bold text-slate-800">
                                    {resolveProcedureBreakdown(app).map((p, idx) => (
                                      <span key={idx} className="inline-flex items-center gap-1.5 ml-3">
                                        <span>• {p.name}</span>
                                        {p.tooth && <ToothBadge tooth={p.tooth} size="sm" showTextLabel={false} />}
                                      </span>
                                    ))}
                                  </div>
                                  {cleanNotes(app.notes) && (
                                    <p className="text-[11px] text-slate-500 font-normal line-clamp-2">
                                      {cleanNotes(app.notes)}
                                    </p>
                                  )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                  {rem > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSessionDiscountAppId(app.id);
                                        setSessionDiscountAmount('');
                                        setSessionDiscountNotes('');
                                      }}
                                      className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl text-xs transition border border-amber-200 flex items-center gap-1 cursor-pointer"
                                      title={isEn ? 'Apply Session Discount' : 'تطبيق خصم وتأكيده على هذه الجلسة'}
                                    >
                                      <Tag className="h-3.5 w-3.5 text-amber-600" />
                                      <span>{isEn ? 'Discount' : 'خصم'}</span>
                                    </button>
                                  )}
                                  {rem > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedAppId(app.id);
                                        setPaymentAmount(rem);
                                        setShowPaymentBox(true);
                                        setTimeout(() => {
                                          paymentBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        }, 50);
                                      }}
                                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition shadow-2xs flex items-center gap-1 cursor-pointer"
                                    >
                                      <DollarSign className="h-3.5 w-3.5" />
                                      {isEn ? 'Pay Installment' : 'سداد القسط'}
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                                      {isEn ? 'Fully Paid' : 'مسدد بالكامل'}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handlePrint(app)}
                                    className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer"
                                    title={isEn ? 'Print Receipt' : 'طباعة الإيصال'}
                                  >
                                    <Printer className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Installments History Drawer */}
                              {historyPayments.length > 0 && (
                                 <div className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => toggleHistoryExpand(app.id)}
                                    className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 transition cursor-pointer"
                                  >
                                    <History className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{isEn ? `Installments History (${historyPayments.length})` : `سجل الدفعات الأقساط (${historyPayments.length})`}</span>
                                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  </button>

                                  {isExpanded && (
                                    <div className="mt-2 space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                                      {historyPayments.map((p, idx) => (
                                        <div key={p.id || idx} className="flex items-center justify-between text-xs py-1 border-b border-dashed border-slate-200 last:border-0 font-medium">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-400">#{idx + 1}</span>
                                            <span className="font-bold text-slate-800 font-mono">{p.amount} {isEn ? 'EGP' : 'ج.م'}</span>
                                            <span className="text-[10px] text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                                              {getPaymentMethodLabel(p.paymentMethod)}
                                            </span>
                                            {p.notes && <span className="text-[10px] text-slate-500 truncate max-w-[200px]">({p.notes})</span>}
                                          </div>
                                          <span className="text-[10px] font-mono text-slate-400">{p.date}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-2xl text-xs transition cursor-pointer"
              >
                {isEn ? 'Close Window' : 'إغلاق النافذة'}
              </button>

              {onNavigateToFullFile && patientId && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToFullFile(patientId);
                  }}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-black rounded-2xl text-xs transition shadow-sm flex items-center gap-2 cursor-pointer"
                >
                  <Receipt className="h-4 w-4" />
                  {isEn ? 'Go to Full Medical Record' : 'الانتقال للملف الطبي الشامل'}
                </button>
              )}
            </div>
          </motion.div>

          {/* Dedicated Points Payment Modal Dialog */}
          <AnimatePresence>
            {isPointsModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" dir={isEn ? 'ltr' : 'rtl'}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2.5 bg-amber-500 text-white rounded-2xl shadow-sm">
                        <Gift className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-slate-900 text-base">{isEn ? 'Pay with Loyalty Points' : 'السداد باستخدام محفظة النقاط'}</h3>
                        <p className="text-xs text-slate-500">{isEn ? 'Select session and enter points or amount to redeem' : 'اختر الجلسة وأدخل النقاط أو المبلغ المراد خصمه'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPointsModalOpen(false)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Patient Wallet Summary Banner */}
                  <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="text-xs text-amber-900 font-bold block">{isEn ? 'Patient Wallet Balance:' : 'رصيد محفظة المريض الحالي:'}</span>
                      <span className="text-lg font-black text-amber-700 font-mono">{patientPoints} {isEn ? 'pts' : 'نقطة'}</span>
                    </div>
                    <div className="text-left">
                      <span className="text-xs text-amber-900 font-bold block">{isEn ? 'Available Amount:' : 'القيمة المتاحة للسداد:'}</span>
                      <span className="text-lg font-black text-emerald-700 font-mono">{maxWalletEgp} {isEn ? 'EGP' : 'ج.م'}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* Session Selector */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Select Session / Appointment *' : 'اختر الجلسة/الموعد المراد السداد عليه *'}</label>
                      <select
                        value={pointsAppId}
                        onChange={(e) => {
                          const appVal = e.target.value;
                          setPointsAppId(appVal);
                          const targetApp = appointments.find(a => a.id === appVal);
                          if (targetApp) {
                            const rem = targetApp.remainingAmount !== undefined ? Number(targetApp.remainingAmount) : 0;
                            if (rem > 0 && patientPoints > 0) {
                              const initialEgp = Math.min(rem, maxWalletEgp);
                              handleEgpInputChange(initialEgp);
                            }
                          }
                        }}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden"
                      >
                        {appointments.map((a) => {
                          const rem = a.remainingAmount !== undefined ? Number(a.remainingAmount) : 0;
                          return (
                            <option key={a.id} value={a.id}>
                              {a.date} ({a.treatmentType}) - {isEn ? `Due: ${rem} EGP` : `المتبقي: ${rem} ج.م`}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Two-way Calculation Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Deducted Points *' : 'عدد النقاط المخصومة *'}</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            value={pointsInput}
                            onChange={(e) => handlePointsInputChange(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                            placeholder={isEn ? 'Enter points' : 'أدخل عدد النقاط'}
                            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-amber-500 outline-hidden"
                          />
                          <span className="absolute left-3 top-2.5 text-xs font-bold text-amber-700">{isEn ? 'pts' : 'نقطة'}</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Equivalent Amount (EGP) *' : 'المبلغ المدفوع المقابل (ج.م) *'}</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            value={egpInput}
                            onChange={(e) => handleEgpInputChange(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                            placeholder={isEn ? 'Enter EGP' : 'أدخل المبلغ بالجنيه'}
                            className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                          />
                          <span className="absolute left-3 top-2.5 text-xs font-bold text-emerald-700">{isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Live Warnings */}
                    {Number(pointsInput) > patientPoints && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-800 text-xs font-bold">
                        <X className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                        <span>{isEn ? `Warning: Requested points (${pointsInput} pts) exceed patient balance (${patientPoints} pts).` : `تنبيه: عدد النقاط المطلوب (${pointsInput} نقطة) أكبر من رصيد النقاط المتوفر للمريض (${patientPoints} نقطة). لن تتم العملية حتى تعديل القيم.`}</span>
                      </div>
                    )}

                    {minRedeemPoints > 0 && Number(pointsInput) > 0 && Number(pointsInput) < minRedeemPoints && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-amber-900 text-xs font-bold">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                        <span>{isEn ? `Warning: Minimum redemption threshold is ${minRedeemPoints} pts (${minRedeemEgp} EGP).` : `تنبيه: الحد الأدنى للاستبدال هو ${minRedeemPoints} نقطة (ما يعادل ${minRedeemEgp} ج.م).`}</span>
                      </div>
                    )}

                    {(() => {
                      const targetApp = appointments.find(a => a.id === pointsAppId);
                      const rem = targetApp?.remainingAmount !== undefined ? Number(targetApp.remainingAmount) : 0;
                      if (Number(egpInput) > rem && rem >= 0) {
                        return (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-amber-900 text-xs font-bold">
                            <X className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                            <span>{isEn ? `Warning: Paid amount (${egpInput} EGP) exceeds remaining session balance (${rem} EGP).` : `تنبيه: المبلغ المدفوع بالنقاط (${egpInput} ج.م) أكبر من المبلغ المتبقي على هذه الجلسة (${rem} ج.م).`}</span>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Notes (Optional)' : 'ملاحظات العملية (اختياري)'}</label>
                      <input
                        type="text"
                        value={pointsPaymentNotes}
                        onChange={(e) => setPointsPaymentNotes(e.target.value)}
                        placeholder={isEn ? 'Enter additional notes...' : 'أدخل أية ملاحظات إضافية...'}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white focus:ring-2 focus:ring-amber-500 outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleConfirmPointsPayment}
                      disabled={
                        isRedeemingPoints ||
                        !pointsInput || Number(pointsInput) <= 0 ||
                        !egpInput || Number(egpInput) <= 0 ||
                        Number(pointsInput) > patientPoints ||
                        (minRedeemPoints > 0 && Number(pointsInput) < minRedeemPoints) ||
                        (() => {
                          const targetApp = appointments.find(a => a.id === pointsAppId);
                          const rem = targetApp?.remainingAmount !== undefined ? Number(targetApp.remainingAmount) : 0;
                          return Number(egpInput) > rem;
                        })()
                      }
                      className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-xs rounded-2xl shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isRedeemingPoints ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          {isEn ? 'Confirm Points Payment' : 'تأكيد السداد بالنقاط'}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPointsModalOpen(false)}
                      className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-2xl transition cursor-pointer"
                    >
                      {isEn ? 'Cancel' : 'إلغاء'}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Direct Session Discount Modal Dialog */}
          <AnimatePresence>
            {sessionDiscountAppId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" dir={isEn ? 'ltr' : 'rtl'}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-slate-900 text-base">{isEn ? 'Apply Session Discount' : 'نافذة الخصم وتأكيده'}</h3>
                        <p className="text-xs text-slate-500">{isEn ? 'Apply direct discount to selected session' : 'تطبيق خصم مباشر على الجلسة المحددة'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSessionDiscountAppId(null)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Discount Amount (EGP) *' : 'مبلغ الخصم المراد خصمه (ج.م) *'}</label>
                      <input
                        type="number"
                        min="1"
                        value={sessionDiscountAmount}
                        onChange={(e) => setSessionDiscountAmount(e.target.value === '' ? '' : Math.max(0, Number(e.target.value)))}
                        placeholder={isEn ? 'Enter discount value' : 'أدخل قيمة الخصم بالجنيه'}
                        className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-bold bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">{isEn ? 'Reason / Notes (Optional)' : 'ملاحظة / سبب الخصم (اختياري)'}</label>
                      <input
                        type="text"
                        value={sessionDiscountNotes}
                        onChange={(e) => setSessionDiscountNotes(e.target.value)}
                        placeholder={isEn ? 'e.g. Special discount, Guild discount...' : 'مثال: خصم خاص، خصم نقابة، مراعاة حالة...'}
                        className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleConfirmSessionDiscount}
                      disabled={isApplyingSessionDiscount || !sessionDiscountAmount || Number(sessionDiscountAmount) <= 0}
                      className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs rounded-2xl shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isApplyingSessionDiscount ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          {isEn ? 'Confirm Discount' : 'تأكيد الخصم'}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSessionDiscountAppId(null)}
                      className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-2xl transition cursor-pointer"
                    >
                      {isEn ? 'Cancel' : 'إلغاء'}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Printable Invoice Modal */}
          <PrintPreviewModal
            isOpen={!!printingApp}
            onClose={() => setPrintingApp(null)}
            title={isEn ? "Payment Receipt & Due Balance" : "إيصال تحصيل ومستحقات مالية"}
          >
            {printingApp && (
              <div className="bg-white p-6 text-black" dir={isEn ? 'ltr' : 'rtl'}>
                <div className="border-b-2 border-black pb-4 mb-6 flex justify-between items-center">
                  <div>
                    <h1 className="text-2xl font-black mb-1">{isEn ? 'Payment Receipt & Due Balance' : 'إيصال تحصيل ومستحقات مالية'}</h1>
                    <p className="text-sm">{isEn ? 'Print Date:' : 'تاريخ الطباعة:'} {new Date().toLocaleDateString(isEn ? 'en-US' : 'ar-EG')}</p>
                  </div>
                  <div className="text-left font-bold">
                    <p>{isEn ? 'Patient Name:' : 'اسم المريض:'} {patientName}</p>
                    {patientPhone && <p>{isEn ? 'Phone:' : 'الهاتف:'} {patientPhone}</p>}
                  </div>
                </div>

                <div className="space-y-4 text-sm font-bold">
                  <div className="flex justify-between border-b pb-2">
                    <span>{isEn ? 'Session Date & Time:' : 'تاريخ الموعد/الجلسة:'}</span>
                    <span>{printingApp.date} • {printingApp.time}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span>{isEn ? 'Medical Procedure / Service:' : 'الإجراء الطبي أو الخدمة:'}</span>
                    <span>{printingApp.treatmentType}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span>{isEn ? 'Total Cost:' : 'إجمالي التكلفة:'}</span>
                    <span>{Number(printingApp.price).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span>{isEn ? 'Collected Amount (Paid):' : 'المبلغ المدفوع / المحصل:'}</span>
                    <span>{(printingApp.paidAmount !== undefined ? Number(printingApp.paidAmount) : Number(printingApp.price)).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                  </div>
                  <div className="flex justify-between border-b pb-2 text-red-600">
                    <span>{isEn ? 'Remaining Balance (Due):' : 'المتبقي (الأقساط):'}</span>
                    <span>{(printingApp.remainingAmount !== undefined ? Number(printingApp.remainingAmount) : 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                  </div>
                  {printingApp.notes && (
                    <div className="mt-4 p-3 bg-gray-100 rounded">
                      <p>{isEn ? 'Notes & Transaction Logs:' : 'ملاحظات وحركات التحصيل:'}</p>
                      <p className="font-normal mt-1 whitespace-pre-line">{printingApp.notes}</p>
                    </div>
                  )}
                </div>

                <div className="mt-12 pt-4 border-t flex justify-between text-xs font-bold">
                  <span>{isEn ? 'Reception / Staff Signature: .........................' : 'توقيع الموظف المختص / الاستقبال: .........................'}</span>
                  <span>{isEn ? 'Clinic Stamp: .........................' : 'ختم العيادة: .........................'}</span>
                </div>
              </div>
            )}
          </PrintPreviewModal>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

