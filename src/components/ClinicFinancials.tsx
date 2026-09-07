import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { getAppointmentsRef, OperationType, handleDbError, db, getDocsSmart as getDocs, getDocSmart as getDoc, collection, addDoc, updateDoc, doc, query, where, deleteDoc } from '../dbClient';
import { Clinic, Appointment } from '../types';
import PatientFinancialsModal, { getAppointmentPayments, getEgyptTodayStr, normalizePaymentMethod } from './PatientFinancialsModal';
import { checkSubscriptionBlocked, normalizeDateStr } from '../utils/timeUtils';
import { 
  Receipt, 
  Calendar as CalendarIcon, 
  DollarSign, 
  CheckCircle, 
  TrendingUp, 
  Printer, 
  Search, 
  CreditCard, 
  Plus, 
  RefreshCw, 
  AlertCircle, 
  Clock, 
  Check, 
  ChevronRight, 
  FileText, 
  User, 
  Scale, 
  TrendingDown, 
  Archive,
  ArrowRight,
  Lock,
  Unlock,
  Trash2,
  X
} from 'lucide-react';
import { formatTimeTo12Hour } from './InteractiveCalendar';
import { useDialogs } from './DialogContext';
import { PrintPreviewModal } from './PrintPreviewModal';
import { resolveProcedureBreakdown, cleanNotes, getToothInfo } from '../utils';

interface ClinicFinancialsProps {
  clinic: Clinic;
  isStaff?: boolean;
  operatorName?: string;
  sharedAppointments?: Appointment[];
  onRefreshAppointments?: (silent?: boolean, date?: string, force?: boolean) => Promise<void>;
  activeShift?: any;
  onRefreshActiveShift?: () => Promise<void>;
  allowedTabs?: string[];
}

interface ShiftLog {
  id?: string;
  date: string;
  expectedCash: number;
  actualCash: number;
  discrepancy: number;
  completedCount: number;
  notes: string;
  closedAt: string;
  closedBy: string;
  expensesTotal?: number;
}

export interface Expense {
  id?: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  notes?: string;
  createdAt?: string;
  type?: 'shift' | 'personal';
  shiftId?: string;
  paymentMethod?: string;
}

/**
 * Helper to check if a payment belongs to a specific shift
 */
export const isPaymentInShift = (pay: any, app: Appointment, shift: any): boolean => {
  if (!shift) return false;

  // 1. Explicit shiftId match on payment record
  if (pay?.shiftId) {
    return pay.shiftId === shift.id;
  }

  // 2. If appointment has an explicit shiftId and payment is initial payment
  if (app?.shiftId && (pay?.type === 'initial' || !pay?.type)) {
    if (app.shiftId === shift.id) return true;
    if (app.shiftId !== shift.id) return false;
  }

  // 3. Date check
  const normShiftDate = normalizeDateStr(shift.date);
  const payDate = normalizeDateStr(pay?.date || (pay?.createdAt ? pay.createdAt.split('T')[0] : '') || app?.date);
  if (normShiftDate && payDate && normShiftDate !== payDate) {
    return false;
  }

  // 4. Timestamp range check (openedAt -> closedAt or active now)
  if (shift.openedAt) {
    const shiftOpenTime = new Date(shift.openedAt).getTime();
    const shiftCloseTime = shift.closedAt 
      ? new Date(shift.closedAt).getTime() 
      : Date.now() + 120000; // 2 min buffer if active

    const payTimestamp = pay?.createdAt ? new Date(pay.createdAt).getTime() : 
                         (app?.updatedAt ? new Date(app.updatedAt).getTime() : 
                         (app?.createdAt ? new Date(app.createdAt).getTime() : NaN));

    if (!isNaN(payTimestamp) && !isNaN(shiftOpenTime)) {
      return payTimestamp >= shiftOpenTime && payTimestamp <= shiftCloseTime;
    }
  }

  // 5. Fallback for untimed legacy records on same date
  return normShiftDate === payDate;
};

/**
 * Helper to check if an appointment belongs to a specific shift
 */
export const isAppointmentInShift = (app: Appointment, shift: any): boolean => {
  if (!shift) return false;

  // 1. Explicit shiftId match
  if (app.shiftId) {
    return app.shiftId === shift.id;
  }

  // 2. Check if any payments of this appointment belong to the shift
  const paymentsList = getAppointmentPayments(app);
  if (paymentsList && paymentsList.length > 0) {
    const hasMatchingPayment = paymentsList.some(p => isPaymentInShift(p, app, shift));
    if (hasMatchingPayment) return true;
  }

  // 3. Date check
  const normShiftDate = normalizeDateStr(shift.date);
  const appDate = normalizeDateStr(app.date);
  if (normShiftDate && appDate && normShiftDate !== appDate) {
    return false;
  }

  // 4. Timestamp check (completed or updated during shift time window)
  if (shift.openedAt) {
    const shiftOpenTime = new Date(shift.openedAt).getTime();
    const shiftCloseTime = shift.closedAt 
      ? new Date(shift.closedAt).getTime() 
      : Date.now() + 120000;

    const appTimestamp = app.updatedAt ? new Date(app.updatedAt).getTime() : 
                         (app.createdAt ? new Date(app.createdAt).getTime() : NaN);

    if (!isNaN(appTimestamp) && !isNaN(shiftOpenTime)) {
      return appTimestamp >= shiftOpenTime && appTimestamp <= shiftCloseTime;
    }
  }

  return normShiftDate === appDate;
};

/**
 * Helper to check if an expense belongs to a specific shift
 */
export const isExpenseInShift = (expense: Expense, shift: any): boolean => {
  if (!shift) return false;
  if (expense.type !== 'shift') return false;

  // 1. Explicit shiftId match
  if (expense.shiftId) {
    return expense.shiftId === shift.id;
  }

  // 2. Date check
  const normShiftDate = normalizeDateStr(shift.date);
  const expDate = normalizeDateStr(expense.date);
  if (normShiftDate && expDate && normShiftDate !== expDate) {
    return false;
  }

  // 3. Timestamp check
  if (shift.openedAt) {
    const shiftOpenTime = new Date(shift.openedAt).getTime();
    const shiftCloseTime = shift.closedAt 
      ? new Date(shift.closedAt).getTime() 
      : Date.now() + 120000;

    const expTimestamp = expense.createdAt ? new Date(expense.createdAt).getTime() : NaN;
    if (!isNaN(expTimestamp) && !isNaN(shiftOpenTime)) {
      return expTimestamp >= shiftOpenTime && expTimestamp <= shiftCloseTime;
    }
  }

  return normShiftDate === expDate;
};

export default function ClinicFinancials({ 
  clinic, 
  isStaff, 
  operatorName,
  sharedAppointments,
  onRefreshAppointments,
  activeShift,
  onRefreshActiveShift,
  allowedTabs
}: ClinicFinancialsProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  const [activeTab, setActiveTab] = useState<'shift_closure' | 'shift_history' | 'installments' | 'expenses' | 'revenues'>('shift_closure');
  
  const allowedFeatures = clinic.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];

  const isTabAllowed = (tabId: 'shift_closure' | 'shift_history' | 'revenues' | 'installments' | 'expenses') => {
    const map: Record<string, string> = {
      shift_closure: 'financials_daily_closing',
      shift_history: 'financials_closing_log',
      revenues: 'financials_reports',
      installments: 'financials_patients_installments',
      expenses: 'financials_expenses'
    };
    const permKey = map[tabId];

    // Determine clinic-level allowance first
    let isClinicAllowed = allowedFeatures.includes(permKey);
    if (!isClinicAllowed) {
      const hasExplicitClinicSubPerms = ['financials_daily_closing', 'financials_closing_log', 'financials_reports', 'financials_patients_installments', 'financials_expenses'].some(k => allowedFeatures.includes(k));
      if (!hasExplicitClinicSubPerms && allowedFeatures.includes('financials')) {
        isClinicAllowed = true;
      }
    }

    if (!isClinicAllowed) return false;

    // Determine staff-level allowance if it's a staff member
    if (isStaff && allowedTabs) {
      const hasExplicitStaffSubPerms = ['financials_daily_closing', 'financials_closing_log', 'financials_reports', 'financials_patients_installments', 'financials_expenses'].some(id => allowedTabs.includes(id));
      
      if (hasExplicitStaffSubPerms) {
        // If staff has custom granular permissions, they must explicitly have this sub-perm key
        return allowedTabs.includes(permKey);
      } else {
        // Fallback for older staff members who only have the generic 'financials' permission
        return allowedTabs.includes('financials');
      }
    }

    return true;
  };

  useEffect(() => {
    const tabsList: ('shift_closure' | 'shift_history' | 'revenues' | 'installments' | 'expenses')[] = [
      'shift_closure',
      'shift_history',
      'revenues',
      'installments',
      'expenses'
    ];
    const allowed = tabsList.filter(t => isTabAllowed(t));
    if (allowed.length > 0 && !allowed.includes(activeTab)) {
      setActiveTab(allowed[0]);
    }
  }, [clinic.allowedFeatures, allowedTabs, activeTab]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>(() => (sharedAppointments && sharedAppointments.length > 0 ? sharedAppointments : []));
  const [shiftHistory, setShiftHistory] = useState<ShiftLog[]>([]);

  useEffect(() => {
    if (sharedAppointments && sharedAppointments.length > 0) {
      setAppointments(sharedAppointments);
    }
  }, [sharedAppointments]);

  // Expenses state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('مستلزمات طبية');
  const [expenseDate, setExpenseDate] = useState(() => getEgyptTodayStr());
  const [expenseNotes, setExpenseNotes] = useState('');
  const [expenseType, setExpenseType] = useState<'shift' | 'personal' | null>(null);
  const [expensePaymentMethod, setExpensePaymentMethod] = useState('');
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseFilterCategory, setExpenseFilterCategory] = useState('all');
  const [expenseFilterPeriod, setExpenseFilterPeriod] = useState<'all' | 'today' | 'month' | 'custom_day' | 'custom_range'>('today');
  const [expensesLimit, setExpensesLimit] = useState<number>(5);
  const [expenseFilterSpecificDate, setExpenseFilterSpecificDate] = useState(() => getEgyptTodayStr());
  const [expenseFilterStartDate, setExpenseFilterStartDate] = useState('');
  const [expenseFilterEndDate, setExpenseFilterEndDate] = useState('');
  const [selectedHistoryShift, setSelectedHistoryShift] = useState<any | null>(null);

  // Reset expenses pagination on filter/search change
  useEffect(() => {
    setExpensesLimit(5);
  }, [expenseSearch, expenseFilterCategory, expenseFilterPeriod, expenseFilterSpecificDate, expenseFilterStartDate, expenseFilterEndDate]);

  // Selected date for shift closure (defaults to today's date in local time)
  const [selectedShiftDate, setSelectedShiftDate] = useState<string>(() => getEgyptTodayStr());

  const activeShiftDate = activeShift ? activeShift.date : selectedShiftDate;

  // Current shift reference for calculations
  const currentShift = React.useMemo(() => {
    if (activeShift) return activeShift;
    return {
      id: 'preview',
      date: selectedShiftDate || getEgyptTodayStr(),
      status: 'closed'
    };
  }, [activeShift, selectedShiftDate]);

  // Active shift operations limit
  const [shiftOperationsLimit, setShiftOperationsLimit] = useState<number>(5);

  // Shift history limit
  const [shiftHistoryLimit, setShiftHistoryLimit] = useState<number>(5);

  // Selected appointment for invoice / installment payment details
  const [selectedApp, setSelectedApp] = useState<Appointment | null>(null);

  // State to control PatientFinancialsModal from here
  const [financialModalPatient, setFinancialModalPatient] = useState<{
    id?: string;
    name: string;
    phone?: string;
    appointmentId?: string;
  } | null>(null);
  
  // Installment payment input
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  // Filter search for patient billings
  const [billingSearch, setBillingSearch] = useState('');
  const [billingFilter, setBillingFilter] = useState<'all' | 'remaining' | 'paid'>('all');

  // Installments list state - defaults to today with limit of 5
  const [installmentsLimit, setInstallmentsLimit] = useState<number>(5);
  const [installmentsSearch, setInstallmentsSearch] = useState<string>('');
  const [installmentsFilterPeriod, setInstallmentsFilterPeriod] = useState<'today' | 'month' | 'all'>('today');

  // Reset installments pagination on filter/search change
  useEffect(() => {
    setInstallmentsLimit(5);
  }, [installmentsSearch, installmentsFilterPeriod]);

  // Revenues tab states and helpers
  const getTodayStr = () => {
    const today = new Date();
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  };

  const getSevenDaysAgoStr = () => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const getTodayMonthStr = () => {
    const today = new Date();
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  };

  const [revenueFilterMode, setRevenueFilterMode] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [revenueDailyDate, setRevenueDailyDate] = useState(getTodayStr);
  const [revenueWeeklyDate, setRevenueWeeklyDate] = useState(getTodayStr);
  const [revenueMonthlyVal, setRevenueMonthlyVal] = useState(getTodayMonthStr);
  const [revenueStartDate, setRevenueStartDate] = useState(getSevenDaysAgoStr);
  const [revenueEndDate, setRevenueEndDate] = useState(getTodayStr);
  const [revenuesLimit, setRevenuesLimit] = useState<number>(5);
  const [revenueReportType, setRevenueReportType] = useState<'gross' | 'net'>('gross');

  // Reset revenues pagination on filter mode or date changes
  useEffect(() => {
    setRevenuesLimit(5);
  }, [revenueFilterMode, revenueDailyDate, revenueWeeklyDate, revenueMonthlyVal, revenueStartDate, revenueEndDate, revenueReportType]);

  const getWeekBounds = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDay();
    // Start week on Saturday
    const offsetToSaturday = day === 6 ? 0 : day + 1;
    
    const start = new Date(date);
    start.setDate(date.getDate() - offsetToSaturday);
    
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    
    const pad = (num: number) => String(num).padStart(2, '0');
    const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    
    return {
      startDateStr: formatDate(start),
      endDateStr: formatDate(end),
      startDate: start,
      endDate: end
    };
  };

  const formatArabicDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const formatArabicMonth = (yearMonthStr: string) => {
    if (!yearMonthStr) return '';
    try {
      const [year, month] = yearMonthStr.split('-');
      const d = new Date(parseInt(year), parseInt(month) - 1, 1);
      return d.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    } catch {
      return yearMonthStr;
    }
  };

  // Group appointments with remainingAmount > 0 by patient
  const installmentPatients = React.useMemo(() => {
    const patientMap: { [patientIdOrPhone: string]: {
      patientId: string;
      patientName: string;
      patientPhone: string;
      totalRemaining: number;
      totalPaid: number;
      totalPrice: number;
      appointments: Appointment[];
    }} = {};

    const todayStr = (() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    })();

    const currentMonth = todayStr.substring(0, 7);

    appointments.forEach((app) => {
      const remaining = app.remainingAmount !== undefined ? app.remainingAmount : 0;
      if (remaining > 0 && app.status === 'completed') {
        // Filter by installmentsFilterPeriod
        if (installmentsFilterPeriod === 'today' && app.date !== todayStr) {
          return;
        }
        if (installmentsFilterPeriod === 'month' && app.date.substring(0, 7) !== currentMonth) {
          return;
        }

        const key = app.patientId || app.patientPhone || app.patientName;
        const paid = app.paidAmount !== undefined ? app.paidAmount : app.price;
        if (!patientMap[key]) {
          patientMap[key] = {
            patientId: app.patientId,
            patientName: app.patientName,
            patientPhone: app.patientPhone,
            totalRemaining: 0,
            totalPaid: 0,
            totalPrice: 0,
            appointments: []
          };
        }
        patientMap[key].totalRemaining += remaining;
        patientMap[key].totalPaid += paid;
        patientMap[key].totalPrice += app.price;
        patientMap[key].appointments.push(app);
      }
    });

    return Object.values(patientMap).sort((a, b) => b.totalRemaining - a.totalRemaining);
  }, [appointments, installmentsFilterPeriod]);

  const filteredInstallmentPatients = React.useMemo(() => {
    return installmentPatients.filter(p => 
      p.patientName.toLowerCase().includes(installmentsSearch.toLowerCase()) ||
      (p.patientPhone && p.patientPhone.includes(installmentsSearch))
    );
  }, [installmentPatients, installmentsSearch]);

  const visibleInstallmentPatients = React.useMemo(() => {
    return filteredInstallmentPatients.slice(0, installmentsLimit);
  }, [filteredInstallmentPatients, installmentsLimit]);

  // Get active shift expenses (type === 'shift' and matched by shiftId or openedAt window)
  const activeShiftExpenses = React.useMemo(() => {
    return expenses.filter(e => isExpenseInShift(e, currentShift));
  }, [expenses, currentShift]);

  const activeShiftExpensesTotal = React.useMemo(() => {
    return activeShiftExpenses.reduce((sum, e) => sum + e.amount, 0);
  }, [activeShiftExpenses]);

  // Shift closure input
  const [actualCashInput, setActualCashInput] = useState<string>('');
  const [shiftNotes, setShiftNotes] = useState<string>('');
  const [closedByInput, setClosedByInput] = useState<string>(operatorName || '');
  const [shiftSuccess, setShiftSuccess] = useState<string | null>(null);

  const [startCashInput, setStartCashInput] = useState<string>('');
  const [cashierNameInput, setCashierNameInput] = useState<string>(operatorName || '');
  const [openingNotesInput, setOpeningNotesInput] = useState<string>('');

  useEffect(() => {
    if (operatorName) {
      setClosedByInput(operatorName);
      setCashierNameInput(operatorName);
    }
  }, [operatorName]);

  // Print States
  const [printInvoiceData, setPrintInvoiceData] = useState<Appointment | null>(null);
  const [printShiftData, setPrintShiftData] = useState<{
    date: string;
    openedAt?: string;
    closedAt?: string;
    cashierName?: string;
    closedBy?: string;
    startCash?: number;
    totalRevenue?: number;
    cashRevenue?: number;
    cardRevenue?: number;
    instapayRevenue?: number;
    walletRevenue?: number;
    remainingRevenue?: number;
    expected: number;
    expectedCash: number;
    actual: number;
    discrepancy: number;
    appointments: Appointment[];
    paymentRecords?: any[];
    notes: string;
    cashAmount?: number;
    cardAmount?: number;
    instapayAmount?: number;
    walletAmount?: number;
    expensesTotal?: number;
    cashExpenses?: number;
    expensesList?: Expense[];
    revenuesMap?: Record<string, number>;
    expensesMap?: Record<string, number>;
    activeMethodsList?: string[];
  } | null>(null);

  const fetchAppointments = async (silent = false) => {
    if (!silent && appointments.length === 0 && (!sharedAppointments || sharedAppointments.length === 0)) {
      setLoading(true);
    }
    setError(null);
    try {
      const ref = getAppointmentsRef(clinic.id);
      let snap;
      try {
        snap = await getDocs(ref);
      } catch (err: any) {
        handleDbError(err, OperationType.LIST, `clinics/${clinic.id}/appointments`);
      }
      
      const list: Appointment[] = [];
      snap?.forEach((docSnap: any) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          patientId: data.patientId || '',
          patientName: data.patientName || 'مريض غير معروف',
          patientPhone: data.patientPhone || '',
          date: data.date || '',
          time: data.time || '',
          treatmentType: data.treatmentType || '',
          price: Number(data.price) || 0,
          notes: cleanNotes(data.notes || ''),
          status: data.status || 'scheduled',
          paidAmount: data.paidAmount !== undefined ? Number(data.paidAmount) : undefined,
          remainingAmount: data.remainingAmount !== undefined ? Number(data.remainingAmount) : undefined,
          invoiceStatus: data.invoiceStatus,
          financialNote: data.financialNote || '',
          paymentMethod: data.paymentMethod || undefined,
          toothNumber: data.toothNumber !== undefined ? Number(data.toothNumber) : undefined,
          procedures: data.procedures || [],
          payments: data.payments || []
        });
      });

      // Sort by date (newest first) and then time
      list.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
      setAppointments(list);
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء تحميل البيانات المالية للحجوزات: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  const autoCloseShiftRecord = async (
    shiftId: string,
    shiftData: Record<string, any>,
    closedBy: string,
    reasonNote: string
  ) => {
    const { doc, updateDoc } = await import('../dbClient');
    const startCash = Number(shiftData.startCash) || 0;
    const shiftRef = doc(db, 'clinics', clinic.id, 'shifts', shiftId);
    await updateDoc(shiftRef, {
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy,
      expectedCash: startCash,
      actualCash: startCash,
      discrepancy: 0,
      expensesTotal: 0,
      totalRevenue: 0,
      notes: `${shiftData.notes || ''} [${reasonNote}]`.trim()
    });
  };

  const closeAllOpenShifts = async (exceptShiftId: string | null, closedBy: string, reasonNote: string) => {
    const { collection, getDocs, query, where } = await import('../dbClient');
    const shiftsRef = collection(db, 'clinics', clinic.id, 'shifts');
    const q = query(shiftsRef, where('status', '==', 'open'));
    const snap = await getDocs(q);

    for (const openDoc of snap.docs) {
      if (openDoc.id === exceptShiftId) continue;
      await autoCloseShiftRecord(openDoc.id, openDoc.data(), closedBy, reasonNote);
    }
  };

  const fetchShiftHistory = async () => {
    try {
      const shiftsRef = collection(db, 'clinics', clinic.id, 'shifts');
      const snap = await getDocs(shiftsRef);
      const list: any[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.status !== 'closed' && !data.closedAt) return;
        list.push({
          id: docSnap.id,
          date: data.date || '',
          expectedCash: Number(data.expectedCash) || 0,
          actualCash: Number(data.actualCash) || 0,
          discrepancy: Number(data.discrepancy) || 0,
          completedCount: Number(data.completedCount) || 0,
          notes: data.notes || '',
          closedAt: data.closedAt || '',
          closedBy: data.closedBy || 'السكرتارية',
          cashierName: data.cashierName || data.closedBy || 'السكرتارية',
          openedAt: data.openedAt || '',
          expensesTotal: data.expensesTotal !== undefined ? Number(data.expensesTotal) : 0,
          cashExpenses: data.cashExpenses !== undefined ? Number(data.cashExpenses) : 0,
          totalRevenue: data.totalRevenue !== undefined ? Number(data.totalRevenue) : 0,
          cashRevenue: data.cashRevenue !== undefined ? Number(data.cashRevenue) : 0,
          cardRevenue: data.cardRevenue !== undefined ? Number(data.cardRevenue) : 0,
          instapayRevenue: data.instapayRevenue !== undefined ? Number(data.instapayRevenue) : 0,
          walletRevenue: data.walletRevenue !== undefined ? Number(data.walletRevenue) : 0,
          startCash: data.startCash !== undefined ? Number(data.startCash) : 0,
          dynamicRevenues: data.dynamicRevenues || null,
          dynamicExpenses: data.dynamicExpenses || null
        });
      });
      // Sort newest first
      list.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
      setShiftHistory(list);
    } catch (err) {
      console.error('Error fetching shift history:', err);
    }
  };

  const fetchExpenses = async () => {
    try {
      const expensesRef = collection(db, 'clinics', clinic.id, 'expenses');
      const snap = await getDocs(expensesRef);
      const list: Expense[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          title: data.title || '',
          amount: Number(data.amount) || 0,
          category: data.category || 'مستلزمات طبية',
          date: data.date || '',
          notes: data.notes || '',
          createdAt: data.createdAt || '',
          type: data.type || undefined,
          shiftId: data.shiftId || undefined,
          paymentMethod: data.paymentMethod || undefined
        });
      });
      // Sort newest first
      list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
      setExpenses(list);
    } catch (err) {
      console.error('Error fetching expenses:', err);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    const amt = Number(expenseAmount);
    if (!expenseTitle.trim()) {
      dialogs.alert('يرجى إدخال بيان أو وصف المصروف أولاً', { severity: 'warning' });
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      dialogs.alert('يرجى إدخال قيمة مالية صحيحة أكبر من صفر للمصروف', { severity: 'warning' });
      return;
    }
    if (!expenseType) {
      dialogs.alert('يرجى تحديد مصدر الصرف (خصم من الوردية أو مال خاص) قبل حفظ المصروف', { severity: 'warning' });
      return;
    }
    if (expenseType === 'shift' && !activeShift) {
      dialogs.alert('عذراً، لا يمكن تسجيل مصروف "خصم من الوردية" لعدم وجود وردية نشطة مفتوحة حالياً. يرجى بدء وردية كاشير أولاً أو تحديد "مال خاص".', { severity: 'error' });
      return;
    }

    setLoading(true);
    try {
      const activeMethods = clinic.paymentMethods && clinic.paymentMethods.length > 0
        ? clinic.paymentMethods
        : ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
      const resolvedPaymentMethod = expenseType === 'shift'
        ? (expensePaymentMethod || activeMethods[0])
        : null;

      const expensesRef = collection(db, 'clinics', clinic.id, 'expenses');
      await addDoc(expensesRef, {
        title: expenseTitle.trim(),
        amount: amt,
        category: expenseCategory,
        date: expenseDate,
        notes: expenseType === 'shift' ? `خصم من الوردية المفتوحة - طريقة الدفع: ${resolvedPaymentMethod}` : 'مال خاص / تمويل ذاتي',
        type: expenseType,
        shiftId: expenseType === 'shift' && activeShift ? activeShift.id : null,
        paymentMethod: resolvedPaymentMethod,
        createdAt: new Date().toISOString()
      });

      setExpenseTitle('');
      setExpenseAmount('');
      setExpenseNotes('');
      setExpenseType(null); // Reset choice to keep both empty/unchecked
      setExpensePaymentMethod('');
      dialogs.alert('تم تسجيل المصروف بنجاح!', { severity: 'success' });
      await fetchExpenses();
    } catch (err: any) {
      console.error('Error adding expense:', err);
      dialogs.alert('حدث خطأ أثناء تسجيل المصروف: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteExpense = async (expense: Expense) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert('عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    if (!expense.id) return;
    const confirmed = await dialogs.confirm(`هل أنت متأكد من حذف مصروف "${expense.title}" بقيمة ${expense.amount} ج.م؟ لا يمكن التراجع عن هذه العملية.`, { severity: 'warning' });
    if (!confirmed) return;

    setLoading(true);
    try {
      const expensesRef = collection(db, 'clinics', clinic.id, 'expenses');
      const docRef = doc(expensesRef, expense.id);
      await deleteDoc(docRef);
      dialogs.alert('تم حذف المصروف بنجاح!', { severity: 'success' });
      await fetchExpenses();
    } catch (err: any) {
      console.error('Error deleting expense:', err);
      dialogs.alert('حدث خطأ أثناء حذف المصروف: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const hasInitialData = (sharedAppointments && sharedAppointments.length > 0) || appointments.length > 0;
    Promise.allSettled([
      fetchAppointments(hasInitialData),
      fetchShiftHistory(),
      fetchExpenses()
    ]);

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};
      
      const relevantTables = ['shifts', 'appointments', 'records', 'patients', 'closings', 'billing', 'expenses'];
      if (relevantTables.includes(table)) {
        console.log(`[ClinicFinancials] Instant financial/shift sync triggered for table: ${table}`);
        Promise.allSettled([
          fetchShiftHistory(),
          fetchExpenses(),
          fetchAppointments(true)
        ]);
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => window.removeEventListener('clinic-sync', handleSync);
  }, [clinic.id]);

  useEffect(() => {
    if (activeShiftDate && onRefreshAppointments) {
      onRefreshAppointments(true, activeShiftDate, false);
    }
  }, [activeShiftDate]);

  // Recalculate selected appointment if the whole appointments list changes
  useEffect(() => {
    if (selectedApp) {
      const updated = appointments.find(a => a.id === selectedApp.id);
      if (updated) {
        setSelectedApp(updated);
      }
    }
  }, [appointments]);

  // Record safe payment ( قسط / دفعة جديدة )
  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!selectedApp) return;

    const inputAmt = Number(paymentAmount);
    if (isNaN(inputAmt) || inputAmt <= 0) {
      dialogs.alert('يرجى إدخال مبلغ دفع صحيح أكبر من صفر', { severity: 'warning' });
      return;
    }

    const currentPaid = selectedApp.paidAmount !== undefined ? selectedApp.paidAmount : selectedApp.price;
    const currentRemaining = selectedApp.remainingAmount !== undefined ? selectedApp.remainingAmount : 0;

    if (inputAmt > currentRemaining && currentRemaining > 0) {
      const hasConfirmed = await dialogs.confirm(`المبلغ المدخل (${inputAmt} ج.م) أكبر من المتبقي على المريض (${currentRemaining} ج.م). هل تريد إضافة المبلغ الفائض وتحديث التكلفة الإجمالية؟`, { severity: 'info' });
      if (!hasConfirmed) return;
    }

    setLoading(true);
    try {
      const ref = getAppointmentsRef(clinic.id);
      const docRef = doc(ref, selectedApp.id);

      const newPaid = currentPaid + inputAmt;
      // If payment exceeds remaining, we either set remaining to 0 or we keep normal math
      const newRemaining = Math.max(0, currentRemaining - inputAmt);
      const newPrice = Math.max(selectedApp.price, newPaid);

      const existingPayments = selectedApp.payments && Array.isArray(selectedApp.payments) ? selectedApp.payments : [];
      const resolvedPayments = [...existingPayments];
      if (resolvedPayments.length === 0 && currentPaid > 0) {
        resolvedPayments.push({
          id: 'pay_init_' + selectedApp.id,
          amount: currentPaid,
          paymentMethod: selectedApp.paymentMethod || 'كاش',
          date: selectedApp.date || getEgyptTodayStr(),
          createdAt: selectedApp.updatedAt || selectedApp.createdAt || new Date().toISOString(),
          notes: 'الدفعة الأولى السابقة',
          type: 'initial'
        });
      }

      const resolvedShiftId = activeShift?.id || undefined;
      resolvedPayments.push({
        id: 'pay_rec_' + Math.random().toString(36).substring(2, 11),
        amount: inputAmt,
        paymentMethod: selectedApp.paymentMethod || 'كاش',
        date: activeShiftDate || selectedShiftDate || getEgyptTodayStr(),
        createdAt: new Date().toISOString(),
        shiftId: resolvedShiftId,
        notes: paymentNotes ? `سداد قسط: ${paymentNotes}` : 'سداد قسط',
        type: 'installment'
      });

      const updatedNotes = cleanNotes(selectedApp.notes || '') + (paymentNotes.trim() ? `\n• ${paymentNotes.trim()}` : '');

      await updateDoc(docRef, {
        paidAmount: newPaid,
        remainingAmount: newRemaining,
        price: newPrice,
        payments: resolvedPayments,
        shiftId: resolvedShiftId || selectedApp.shiftId || undefined,
        updatedAt: new Date().toISOString(),
        notes: updatedNotes.trim()
      });

      setPaymentAmount(0);
      setPaymentNotes('');
      setIsRecordingPayment(false);
      dialogs.alert('تم تسجيل الدفعة بنجاح وتحديث حساب المريض الفوري!', { severity: 'success' });
      await fetchAppointments();
    } catch (err: any) {
      console.error(err);
      setError('فشل تسجيل الدفعة المالية: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  // Open a new cashier shift (بدء وردية كاشير جديدة)
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setLoading(true);
    try {
      const { collection, getDocs, addDoc, query, where } = await import('../dbClient');
      
      // Double check if any shift is currently open
      const shiftsRef = collection(db, 'clinics', clinic.id, 'shifts');
      const q = query(shiftsRef, where('status', '==', 'open'));
      const snap = await getDocs(q);
      
      const cashier = cashierNameInput.trim() || operatorName || 'السكرتارية';
      const startCash = Number(startCashInput) || 0;

      if (!snap.empty) {
        const openDocs = [...snap.docs];
        openDocs.sort((a, b) => {
          const aTime = a.data().openedAt ? new Date(a.data().openedAt).getTime() : 0;
          const bTime = b.data().openedAt ? new Date(b.data().openedAt).getTime() : 0;
          return bTime - aTime;
        });
        const latestOpen = openDocs[0].data();

        const confirmAutoClose = await dialogs.confirm(
          openDocs.length > 1
            ? `تنبيه: هناك ${openDocs.length} ورديات مفتوحة (آخرها بتاريخ ${latestOpen.date} باسم ${latestOpen.cashierName}).\n\nهل ترغب في إغلاق جميع الورديات المفتوحة تلقائياً وبدء وردية جديدة الآن؟`
            : `تنبيه: هناك وردية مفتوحة بالفعل بتاريخ (${latestOpen.date}) باسم الكاشير (${latestOpen.cashierName}).\n\nهل ترغب في إغلاق هذه الوردية السابقة تلقائياً وبدء ورديتك الجديدة الآن؟`,
          { severity: 'warning' }
        );
        
        if (confirmAutoClose) {
          await closeAllOpenShifts(null, cashier, 'تم الإغلاق تلقائياً لفتح وردية جديدة');
        } else {
          setLoading(false);
          if (onRefreshActiveShift) {
            await onRefreshActiveShift();
          }
          return;
        }
      }
      
      await addDoc(shiftsRef, {
        status: 'open',
        cashierName: cashier,
        startCash: startCash,
        openedAt: new Date().toISOString(),
        date: selectedShiftDate, // use the currently selected shift date as the working day for this shift
        notes: openingNotesInput.trim()
      });

      setStartCashInput('');
      setOpeningNotesInput('');
      setShiftSuccess(`تم فتح الوردية بنجاح للكاشير (${cashier}) بعهدة افتتاحية قدرها ${startCash} ج.م! يمكنك الآن تسجيل الحجوزات والمدفوعات.`);
      
      if (onRefreshActiveShift) {
        await onRefreshActiveShift();
      }
      
      setTimeout(() => {
        setShiftSuccess(null);
      }, 5000);
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء فتح الوردية: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  // Confirm and close the active daily shift (إقفال ومطابقة الوردية المفتوحة)
  const handleConfirmShiftClosure = async () => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!activeShift) {
      dialogs.alert('عذراً، لا توجد وردية مفتوحة حالياً لإغلاقها!', { severity: 'warning' });
      return;
    }

    const startCash = Number(activeShift.startCash) || 0;
    const cashExpenses = dynamicExpenses['كاش'] || dynamicExpenses[activeMethodsList[0]] || 0;
    const expected = startCash + dailyCashAmount - cashExpenses;
    const actual = Number(actualCashInput);

    if (actualCashInput.trim() === '' || isNaN(actual)) {
      dialogs.alert('الرجاء كتابة المبلغ الفعلي المتواجد في درج العيادة لمطابقته', { severity: 'warning' });
      return;
    }

    const discrepancy = actual - expected;
    let confirmMsg = `هل أنت متأكد من رغبتك في إغلاق الوردية المفتوحة باسم الكاشير (${activeShift.cashierName})؟\n\n`;
    confirmMsg += `💵 الكاش الفعلي بالدرج: ${actual} ج.م\n`;
    confirmMsg += `📊 الكاش المتوقع بالدرج (البداية + المحصل كاش - مصاريف الكاش): ${expected} ج.م (عهدة افتتاحية: ${startCash} | كاش محصل: ${dailyCashAmount} | مصاريف نقدية مخصومة: ${cashExpenses})\n\n`;
    
    confirmMsg += `💳 تفصيل مطابقة بقية طرق الدفع:\n`;
    activeMethodsList.forEach(m => {
      const rev = dynamicRevenues[m] || 0;
      const exp = dynamicExpenses[m] || 0;
      if (rev > 0 || exp > 0) {
        confirmMsg += `• ${m}: مقبوضات ${rev} ج.م | مصاريف مخصومة ${exp} ج.م | الصافي: ${rev - exp} ج.م\n`;
      }
    });
    confirmMsg += `\n📈 إجمالي إيرادات الوردية (بدون عهدة البداية ودون خصم المصاريف): ${dailyExpectedCash} ج.م\n\n`;

    if (discrepancy === 0) {
      confirmMsg += `حالة المطابقة للدرج: متطابقة تماماً (درج سليم)`;
    } else if (discrepancy < 0) {
      confirmMsg += `حالة المطابقة للدرج: هناك عجز بالدرج بقيمة ${Math.abs(discrepancy)} ج.م`;
    } else {
      confirmMsg += `حالة المطابقة للدرج: هناك زيادة بالدرج بقيمة ${discrepancy} ج.م`;
    }

    const hasConfirmed = await dialogs.confirm(confirmMsg, { severity: discrepancy === 0 ? 'success' : 'warning' });
    if (!hasConfirmed) return;

    setLoading(true);
    try {
      const { doc, updateDoc } = await import('../dbClient');
      const shiftDocRef = doc(db, 'clinics', clinic.id, 'shifts', activeShift.id);
      
      const expensesBreakdown = activeShiftExpenses.map(e => `• ${e.title}: ${e.amount} ج.م (${e.category}) [طريقة الدفع: ${e.paymentMethod || 'كاش'}]`).join('\n');
      const methodsBreakdown = activeMethodsList.map(method => {
        const rev = dynamicRevenues[method] || 0;
        const exp = dynamicExpenses[method] || 0;
        const net = rev - exp;
        const startText = (method === 'كاش' || method === activeMethodsList[0]) ? ` (عهدة الافتتاح: ${startCash} ج.م | المتوقع بالدرج: ${expected} ج.م | الفعلي: ${actual} ج.م)` : '';
        return `• ${method}: مقبوضات ${rev} ج.م | مصاريف مخصومة ${exp} ج.م | صافي ${net} ج.م${startText}`;
      }).join('\n');

      const autoNotes = `[تفاصيل مطابقة الوردية الديناميكية]
عهدة الافتتاح نقداً: ${startCash} ج.م
المتوقع نقداً بالدرج: ${expected} ج.م (البداية + كاش محصل - مصاريف نقدية)
الفعلي المسجل نقداً: ${actual} ج.م
الفارق نقداً بالدرج: ${discrepancy} ج.م.

📊 ملخص الحسابات لكل طرق الدفع:
${methodsBreakdown}

💸 المصاريف المسجلة بالوردية بالتفصيل (${activeShiftExpensesTotal} ج.م):\n${expensesBreakdown || 'لا يوجد'}`;
      
      const finalNotes = shiftNotes.trim()
        ? `${shiftNotes.trim()}\n\n— تفاصيل إلكترونية تلقائية —\n${autoNotes}`
        : autoNotes;

      const closedByName = closedByInput.trim() || operatorName || (isStaff ? 'بوابة السكرتارية' : 'مدير العيادة (الطبيب)');

      await updateDoc(shiftDocRef, {
        status: 'closed',
        expectedCash: expected,
        actualCash: actual,
        discrepancy: discrepancy,
        completedCount: dailyCompletedAppointments.length,
        notes: finalNotes,
        closedAt: new Date().toISOString(),
        closedBy: closedByName,
        totalRevenue: dailyExpectedCash,
        cashRevenue: dailyCashAmount,
        cardRevenue: dailyCardAmount,
        instapayRevenue: dailyInstapayAmount,
        walletRevenue: dailyWalletAmount,
        remainingRevenue: dailyRemainingCash,
        startCash: startCash,
        expensesTotal: activeShiftExpensesTotal,
        cashExpenses: cashExpenses,
        dynamicRevenues: dynamicRevenues,
        dynamicExpenses: dynamicExpenses
      });

      // Close any stale duplicate open shifts so the drawer is fully closed
      await closeAllOpenShifts(activeShift.id, closedByName, 'تم الإغلاق تلقائياً - وردية مفتوحة مكررة');

      setActualCashInput('');
      setShiftNotes('');
      setShiftSuccess(`تم إقفال ومطابقة الوردية بنجاح وحفظها في السجل التاريخي!`);
      
      if (onRefreshActiveShift) {
         await onRefreshActiveShift();
      }
      await fetchShiftHistory();
      
      setTimeout(() => {
        setShiftSuccess(null);
      }, 5000);
    } catch (err: any) {
      console.error(err);
      setError('حدث خطأ أثناء إقفال الوردية: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  // Filtered appointments for Billings Tab
  const filteredBillings = appointments.filter(app => {
    // Only completed appointments are relevant for final billings, but scheduled with billing details can be shown too
    const matchesSearch = app.patientName.toLowerCase().includes(billingSearch.toLowerCase()) || 
                          app.treatmentType.toLowerCase().includes(billingSearch.toLowerCase()) || 
                          app.patientPhone.includes(billingSearch);
    
    const remaining = app.remainingAmount !== undefined ? app.remainingAmount : 0;
    const isCompleted = app.status === 'completed';

    if (billingFilter === 'remaining') {
      return matchesSearch && remaining > 0 && isCompleted;
    } else if (billingFilter === 'paid') {
      return matchesSearch && remaining === 0 && isCompleted;
    }
    return matchesSearch && isCompleted; // 'all' - only completed appointments belong in Billings tab
  });

  // Daily bookings link for Shift tab (filtering by active shift ID or shift time window)
  const dailyAppointments = React.useMemo(() => {
    return appointments.filter(app => isAppointmentInShift(app, currentShift));
  }, [appointments, currentShift]);

  const dailyCompletedAppointments = React.useMemo(() => {
    return dailyAppointments.filter(app => app.status === 'completed');
  }, [dailyAppointments]);

  // Dynamic Payment Methods list and normalization helper
  const activeMethodsList = React.useMemo(() => {
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

  // Expense Payment Methods list
  const expenseMethodsList = React.useMemo(() => {
    return activeMethodsList;
  }, [activeMethodsList]);

  const formatPaymentMethod = React.useCallback((method?: string): string => {
    return normalizePaymentMethod(method);
  }, []);

  // Revenues filter calculations
  const filteredRevenueAppointments = React.useMemo(() => {
    // Only completed appointments count as revenue
    const completedApps = appointments.filter(app => app.status === 'completed');
    
    if (revenueFilterMode === 'daily') {
      return completedApps.filter(app => app.date === revenueDailyDate);
    } else if (revenueFilterMode === 'weekly') {
      const { startDateStr, endDateStr } = getWeekBounds(revenueWeeklyDate);
      return completedApps.filter(app => app.date >= startDateStr && app.date <= endDateStr);
    } else if (revenueFilterMode === 'monthly') {
      return completedApps.filter(app => app.date && app.date.startsWith(revenueMonthlyVal));
    } else { // custom range
      return completedApps.filter(app => {
        const dateOk = (!revenueStartDate || app.date >= revenueStartDate) &&
                       (!revenueEndDate || app.date <= revenueEndDate);
        return dateOk;
      });
    }
  }, [appointments, revenueFilterMode, revenueDailyDate, revenueWeeklyDate, revenueMonthlyVal, revenueStartDate, revenueEndDate]);

  // Revenues by payment method for the selected period
  const revenueMethodBreakdown = React.useMemo(() => {
    const breakdown: Record<string, number> = {};
    activeMethodsList.forEach(m => {
      breakdown[m] = 0;
    });

    const isDateInPeriod = (rawD: string) => {
      const d = normalizeDateStr(rawD);
      const normDaily = normalizeDateStr(revenueDailyDate);
      if (revenueFilterMode === 'daily') {
        return d === normDaily;
      } else if (revenueFilterMode === 'weekly') {
        const { startDateStr, endDateStr } = getWeekBounds(revenueWeeklyDate);
        return d >= normalizeDateStr(startDateStr) && d <= normalizeDateStr(endDateStr);
      } else if (revenueFilterMode === 'monthly') {
        return d && d.startsWith(revenueMonthlyVal);
      } else {
        return (!revenueStartDate || d >= normalizeDateStr(revenueStartDate)) && (!revenueEndDate || d <= normalizeDateStr(revenueEndDate));
      }
    };

    appointments.forEach(app => {
      const paymentsList = getAppointmentPayments(app);

      if (paymentsList && paymentsList.length > 0) {
        paymentsList.forEach(pay => {
          const payDate = normalizeDateStr(pay.date || (pay.createdAt ? pay.createdAt.split('T')[0] : '') || app.date);
          if (payDate && isDateInPeriod(payDate)) {
            const normMethod = normalizePaymentMethod(pay.paymentMethod || 'كاش');
            let matched = activeMethodsList.find(m => normalizePaymentMethod(m) === normMethod);
            if (!matched && normMethod !== 'نقاط الولاء') {
              matched = activeMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || activeMethodsList[0] || 'كاش';
            }
            if (matched) {
              breakdown[matched] = (breakdown[matched] || 0) + Number(pay.amount || 0);
            }
          }
        });
      } else if (app.status === 'completed' && app.date && isDateInPeriod(app.date) && Number(app.paidAmount || 0) > 0) {
        const normMethod = normalizePaymentMethod(app.paymentMethod || 'كاش');
        let matched = activeMethodsList.find(m => normalizePaymentMethod(m) === normMethod);
        if (!matched && normMethod !== 'نقاط الولاء') {
          matched = activeMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || activeMethodsList[0] || 'كاش';
        }
        if (matched) {
          breakdown[matched] = (breakdown[matched] || 0) + Number(app.paidAmount || 0);
        }
      }
    });

    return breakdown;
  }, [activeMethodsList, appointments, revenueFilterMode, revenueDailyDate, revenueWeeklyDate, revenueMonthlyVal, revenueStartDate, revenueEndDate, normalizePaymentMethod]);

  const totalPeriodRevenue = React.useMemo(() => {
    return Object.values(revenueMethodBreakdown).reduce((sum: number, val: any) => sum + Number(val || 0), 0);
  }, [revenueMethodBreakdown]);

  const totalPeriodExpenses = React.useMemo(() => {
    let periodExpenses = [];
    if (revenueFilterMode === 'daily') {
      periodExpenses = expenses.filter(e => e.date === revenueDailyDate);
    } else if (revenueFilterMode === 'weekly') {
      const { startDateStr, endDateStr } = getWeekBounds(revenueWeeklyDate);
      periodExpenses = expenses.filter(e => e.date >= startDateStr && e.date <= endDateStr);
    } else if (revenueFilterMode === 'monthly') {
      periodExpenses = expenses.filter(e => e.date && e.date.startsWith(revenueMonthlyVal));
    } else { // custom range
      periodExpenses = expenses.filter(e => {
        const dateOk = (!revenueStartDate || e.date >= revenueStartDate) &&
                       (!revenueEndDate || e.date <= revenueEndDate);
        return dateOk;
      });
    }
    return periodExpenses.reduce((sum, e) => sum + e.amount, 0);
  }, [expenses, revenueFilterMode, revenueDailyDate, revenueWeeklyDate, revenueMonthlyVal, revenueStartDate, revenueEndDate]);

  const expenseMethodBreakdown = React.useMemo(() => {
    const breakdown: Record<string, number> = {};
    expenseMethodsList.forEach(m => {
      breakdown[m] = 0;
    });

    let periodExpenses = [];
    if (revenueFilterMode === 'daily') {
      periodExpenses = expenses.filter(e => e.date === revenueDailyDate);
    } else if (revenueFilterMode === 'weekly') {
      const { startDateStr, endDateStr } = getWeekBounds(revenueWeeklyDate);
      periodExpenses = expenses.filter(e => e.date >= startDateStr && e.date <= endDateStr);
    } else if (revenueFilterMode === 'monthly') {
      periodExpenses = expenses.filter(e => e.date && e.date.startsWith(revenueMonthlyVal));
    } else { // custom range
      periodExpenses = expenses.filter(e => {
        const dateOk = (!revenueStartDate || e.date >= revenueStartDate) &&
                       (!revenueEndDate || e.date <= revenueEndDate);
        return dateOk;
      });
    }

    periodExpenses.forEach(exp => {
      const normExp = normalizePaymentMethod(exp.paymentMethod || 'كاش');
      let matched = expenseMethodsList.find(m => normalizePaymentMethod(m) === normExp);
      if (!matched) {
        matched = expenseMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || expenseMethodsList[0] || 'كاش';
      }
      if (matched) {
        breakdown[matched] = (breakdown[matched] || 0) + exp.amount;
      }
    });

    return breakdown;
  }, [expenseMethodsList, expenses, revenueFilterMode, revenueDailyDate, revenueWeeklyDate, revenueMonthlyVal, revenueStartDate, revenueEndDate, normalizePaymentMethod]);

  // Compute revenues by method for active shift (filtering payments by shiftId or shift time window)
  const dynamicRevenues = React.useMemo(() => {
    const revenueMap: Record<string, number> = {};
    activeMethodsList.forEach(m => {
      revenueMap[m] = 0;
    });

    appointments.forEach(app => {
      const paymentsList = getAppointmentPayments(app);

      if (paymentsList && paymentsList.length > 0) {
        paymentsList.forEach(pay => {
          if (isPaymentInShift(pay, app, currentShift)) {
            const normMethod = normalizePaymentMethod(pay.paymentMethod || 'كاش');
            let matched = activeMethodsList.find(m => normalizePaymentMethod(m) === normMethod);
            if (!matched && normMethod !== 'نقاط الولاء') {
              matched = activeMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || activeMethodsList[0] || 'كاش';
            }
            if (matched) {
              revenueMap[matched] = (revenueMap[matched] || 0) + Number(pay.amount || 0);
            }
          }
        });
      } else if (app.status === 'completed' && isAppointmentInShift(app, currentShift) && Number(app.paidAmount || 0) > 0) {
        const normMethod = normalizePaymentMethod(app.paymentMethod || 'كاش');
        let matched = activeMethodsList.find(m => normalizePaymentMethod(m) === normMethod);
        if (!matched && normMethod !== 'نقاط الولاء') {
          matched = activeMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || activeMethodsList[0] || 'كاش';
        }
        if (matched) {
          revenueMap[matched] = (revenueMap[matched] || 0) + Number(app.paidAmount || 0);
        }
      }
    });

    return revenueMap;
  }, [activeMethodsList, appointments, currentShift, normalizePaymentMethod]);

  // Compute shift expenses by method for active shift day
  const dynamicExpenses = React.useMemo(() => {
    const expenseMap: Record<string, number> = {};
    expenseMethodsList.forEach(m => {
      expenseMap[m] = 0;
    });

    activeShiftExpenses.forEach(e => {
      const normExp = normalizePaymentMethod(e.paymentMethod);
      let matched = expenseMethodsList.find(m => normalizePaymentMethod(m) === normExp);
      if (!matched) {
        matched = expenseMethodsList.find(m => normalizePaymentMethod(m) === 'كاش') || expenseMethodsList[0] || 'كاش';
      }
      if (matched) {
        expenseMap[matched] = (expenseMap[matched] || 0) + e.amount;
      }
    });

    return expenseMap;
  }, [expenseMethodsList, activeShiftExpenses, normalizePaymentMethod]);

  // Individual payment transactions collected in the active shift
  const activeShiftPaymentRecords = React.useMemo(() => {
    const list: Array<{
      id: string;
      app: Appointment;
      amount: number;
      paymentMethod: string;
      date: string;
      time: string;
      notes?: string;
    }> = [];

    appointments.forEach(app => {
      const paymentsList = getAppointmentPayments(app);
      let foundShiftPayment = false;

      paymentsList.forEach((pay, pIdx) => {
        if (isPaymentInShift(pay, app, currentShift)) {
          foundShiftPayment = true;

          let timeStr = app.time || '12:00';
          if (pay.createdAt) {
            try {
              const d = new Date(pay.createdAt);
              if (!isNaN(d.getTime())) {
                const hours = d.getHours().toString().padStart(2, '0');
                const minutes = d.getMinutes().toString().padStart(2, '0');
                timeStr = `${hours}:${minutes}`;
              }
            } catch (e) {
              // fallback
            }
          }

          list.push({
            id: pay.id || `pay_${app.id}_${pIdx}`,
            app,
            amount: Number(pay.amount || 0),
            paymentMethod: pay.paymentMethod || app.paymentMethod || 'كاش',
            date: pay.date || app.date,
            time: timeStr,
            notes: pay.notes
          });
        }
      });

      // If appointment was completed in active shift but had 0 shift payments in array
      if (!foundShiftPayment && app.status === 'completed' && isAppointmentInShift(app, currentShift)) {
        list.push({
          id: `no_pay_${app.id}`,
          app,
          amount: Number(app.paidAmount || 0),
          paymentMethod: app.paymentMethod || 'كاش',
          date: app.date,
          time: app.time || '12:00',
          notes: 'حجز مكتمل'
        });
      }
    });

    return list;
  }, [appointments, currentShift]);

  // Daily totals
  const dailyExpectedCash = Object.values(dynamicRevenues).reduce((sum: number, val: any) => sum + Number(val || 0), 0);
  const dailyRemainingCash = dailyCompletedAppointments.reduce((sum, app) => sum + (app.remainingAmount !== undefined ? app.remainingAmount : 0), 0);
  const dailyTotalCash = dailyExpectedCash + dailyRemainingCash;
  const dailyScheduledCount = dailyAppointments.filter(app => app.status === 'scheduled').length;
  const dailyCancelledCount = dailyAppointments.filter(app => app.status === 'cancelled').length;

  // Breakdown by payment method
  const getAmountForMethod = (revenues: Record<string, number>, canonicalName: 'كاش' | 'فيزا' | 'إنستاباي' | 'محفظة'): number => {
    let total = 0;
    Object.keys(revenues).forEach(k => {
      if (normalizePaymentMethod(k) === canonicalName) {
        total += Number(revenues[k] || 0);
      }
    });
    return total;
  };

  const dailyCashAmount = getAmountForMethod(dynamicRevenues, 'كاش');
  const dailyCardAmount = getAmountForMethod(dynamicRevenues, 'فيزا');
  const dailyInstapayAmount = getAmountForMethod(dynamicRevenues, 'إنستاباي');
  const dailyWalletAmount = getAmountForMethod(dynamicRevenues, 'محفظة');

  const cashExpenses = getAmountForMethod(dynamicExpenses, 'كاش');

  // Sessions sent from doctor waiting for nurse/receptionist collection outside
  const pendingNurseInvoices = appointments.filter(app => 
    app.status === 'completed' && (
      app.invoiceStatus === 'pending_payment' || 
      ((app.remainingAmount !== undefined ? app.remainingAmount : 0) > 0 && (app.paidAmount || 0) === 0)
    )
  );

  const handleQuickNurseCollect = async (app: Appointment) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setLoading(true);
    try {
      const ref = getAppointmentsRef(clinic.id);
      const docRef = doc(ref, app.id);
      
      const currentPaid = app.paidAmount !== undefined ? Number(app.paidAmount) : 0;
      const amountToCollect = Math.max(0, (app.price || 0) - currentPaid);
      
      const existingPayments = app.payments && Array.isArray(app.payments) ? app.payments : [];
      const resolvedPayments = [...existingPayments];
      if (resolvedPayments.length === 0 && currentPaid > 0) {
        resolvedPayments.push({
          id: 'pay_init_' + app.id,
          amount: currentPaid,
          paymentMethod: app.paymentMethod || 'كاش',
          date: app.date || getEgyptTodayStr(),
          createdAt: app.updatedAt || app.createdAt || new Date().toISOString(),
          notes: 'الدفعة السابقة التلقائية',
          type: 'initial'
        });
      }
      
      const resolvedShiftId = activeShift?.id || undefined;
      if (amountToCollect > 0) {
        resolvedPayments.push({
          id: 'pay_quick_' + Math.random().toString(36).substring(2, 11),
          amount: amountToCollect,
          paymentMethod: app.paymentMethod || 'كاش',
          date: activeShiftDate || selectedShiftDate || getEgyptTodayStr(),
          createdAt: new Date().toISOString(),
          shiftId: resolvedShiftId,
          notes: 'تحصيل سريع من لوحة الممرضة',
          type: 'installment'
        });
      }

      await updateDoc(docRef, {
        paidAmount: app.price,
        remainingAmount: 0,
        invoiceStatus: 'paid',
        payments: resolvedPayments,
        shiftId: resolvedShiftId || app.shiftId || undefined,
        updatedAt: new Date().toISOString(),
        notes: (app.notes || '') + `\n[تم التحصيل والتأكيد عند الممرضة/الاستقبال في ${new Date().toLocaleTimeString('ar-EG')}]`
      });
      await fetchAppointments();
    } catch (err: any) {
      setError('فشل تحصيل المبلغ: ' + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };

  // Print Invoice trigger
  const handlePrintInvoice = (app: Appointment) => {
    setPrintInvoiceData(app);
  };

  // Print Shift trigger (Active Shift)
  const handlePrintShift = () => {
    const startCash = activeShift ? (Number(activeShift.startCash) || 0) : 0;
    const cashExpenses = dynamicExpenses['كاش'] !== undefined 
      ? dynamicExpenses['كاش'] 
      : (dynamicExpenses[activeMethodsList[0]] || 0);
    const activeShiftExpensesTotal = activeShiftExpenses.reduce((sum, e) => sum + e.amount, 0);
    const expectedCashOnly = startCash + dailyCashAmount - cashExpenses;
    const actual = actualCashInput ? Number(actualCashInput) : expectedCashOnly;
    const closedByName = closedByInput.trim() || operatorName || (activeShift ? activeShift.cashierName : 'طاقم العيادة');

    setPrintShiftData({
      date: activeShiftDate,
      openedAt: activeShift?.openedAt,
      cashierName: activeShift?.cashierName || operatorName || 'السكرتارية',
      closedBy: closedByName,
      startCash: startCash,
      totalRevenue: dailyExpectedCash,
      cashRevenue: dailyCashAmount,
      cardRevenue: dailyCardAmount,
      instapayRevenue: dailyInstapayAmount,
      walletRevenue: dailyWalletAmount,
      remainingRevenue: dailyRemainingCash,
      expected: dailyExpectedCash,
      expectedCash: expectedCashOnly,
      actual: actual,
      discrepancy: actual - expectedCashOnly,
      appointments: dailyCompletedAppointments,
      paymentRecords: activeShiftPaymentRecords,
      notes: shiftNotes || (activeShift?.notes || ''),
      expensesTotal: activeShiftExpensesTotal,
      cashExpenses: cashExpenses,
      expensesList: activeShiftExpenses,
      revenuesMap: dynamicRevenues,
      expensesMap: dynamicExpenses,
      activeMethodsList: activeMethodsList
    });
  };

  // Print Shift trigger (Historical Archive Shift)
  const handlePrintHistoryShift = (shift: any) => {
    const revMap = shift.dynamicRevenues || {
      'كاش': shift.cashRevenue || 0,
      'فيزا': shift.cardRevenue || 0,
      'إنستاباي': shift.instapayRevenue || 0,
      'محفظة': shift.walletRevenue || 0
    };
    const expMap = shift.dynamicExpenses || {
      'كاش': shift.cashExpenses !== undefined ? shift.cashExpenses : (shift.expensesTotal || 0)
    };
    const activeMethods = activeMethodsList;

    // Filter appointments for that shift
    const shiftApps = appointments.filter(a => isAppointmentInShift(a, shift));
    const completedApps = shiftApps.filter(a => a.status === 'completed');

    // Filter payment records for that shift
    const pRecords: any[] = [];
    appointments.forEach(app => {
      const paymentsList = getAppointmentPayments(app);
      paymentsList.forEach((pay, pIdx) => {
        if (isPaymentInShift(pay, app, shift)) {
          let timeStr = app.time || '12:00';
          if (pay.createdAt) {
            try {
              const d = new Date(pay.createdAt);
              if (!isNaN(d.getTime())) {
                const hours = d.getHours().toString().padStart(2, '0');
                const minutes = d.getMinutes().toString().padStart(2, '0');
                timeStr = `${hours}:${minutes}`;
              }
            } catch (e) {
              // fallback
            }
          }

          pRecords.push({
            id: pay.id || `pay_${app.id}_${pIdx}`,
            app,
            amount: Number(pay.amount || 0),
            paymentMethod: pay.paymentMethod || app.paymentMethod || 'كاش',
            date: pay.date || app.date,
            time: timeStr,
            notes: pay.notes
          });
        }
      });
    });

    // Filter expenses for that shift
    const shiftExpList = expenses.filter(e => isExpenseInShift(e, shift));
    const expTotal = shift.expensesTotal !== undefined ? shift.expensesTotal : shiftExpList.reduce((sum, e) => sum + e.amount, 0);
    const cashExp = shift.cashExpenses !== undefined ? shift.cashExpenses : (expMap['كاش'] || expMap[activeMethods[0]] || 0);
    const shiftRemaining = shift.remainingRevenue !== undefined
      ? shift.remainingRevenue
      : completedApps.reduce((sum, app) => sum + (app.remainingAmount !== undefined ? app.remainingAmount : 0), 0);

    setPrintShiftData({
      date: shift.date,
      closedAt: shift.closedAt,
      openedAt: shift.openedAt,
      cashierName: shift.cashierName || shift.closedBy || 'السكرتارية',
      closedBy: shift.closedBy || 'السكرتارية',
      startCash: shift.startCash || 0,
      totalRevenue: shift.totalRevenue || (shift.cashRevenue + shift.cardRevenue + shift.instapayRevenue + shift.walletRevenue),
      cashRevenue: shift.cashRevenue || 0,
      cardRevenue: shift.cardRevenue || 0,
      instapayRevenue: shift.instapayRevenue || 0,
      walletRevenue: shift.walletRevenue || 0,
      remainingRevenue: shiftRemaining,
      expected: shift.totalRevenue || 0,
      expectedCash: shift.expectedCash || 0,
      actual: shift.actualCash || 0,
      discrepancy: shift.discrepancy || 0,
      appointments: completedApps,
      paymentRecords: pRecords.length > 0 ? pRecords : completedApps,
      notes: shift.notes || '',
      expensesTotal: expTotal,
      cashExpenses: cashExp,
      expensesList: shiftExpList,
      revenuesMap: revMap,
      expensesMap: expMap,
      activeMethodsList: activeMethods
    });
  };

  return (
    <div className="space-y-6 font-sans">
      
      {/* Printable Invoice Modal */}
      <PrintPreviewModal
        isOpen={!!printInvoiceData}
        onClose={() => setPrintInvoiceData(null)}
        title={isEn ? 'Treatment & Financial Invoice' : 'فاتورة علاج ومتابعة مالية'}
      >
        {printInvoiceData && (
          <div className="bg-white text-slate-900 leading-relaxed text-right" dir="rtl">
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
              <div>
                <h1 className="text-2xl font-black text-slate-900">{clinic.nameAr || clinic.name}</h1>
                <p className="text-sm text-slate-600 mt-1">{clinic.doctorSpecialtyAr || 'طب وجراحة الأسنان وعلاجات التقويم والزراعة'}</p>
                <p className="text-xs text-slate-500 mt-0.5">الدكتور: {clinic.doctorName || 'طبيب متخصص'}</p>
                {clinic.doctorPhone && <p className="text-xs text-slate-500">هاتف: {clinic.doctorPhone}{clinic.additionalPhones && clinic.additionalPhones.length > 0 ? ` - ${clinic.additionalPhones.filter(Boolean).join(' - ')}` : ''}</p>}
                {clinic.address && <p className="text-xs text-slate-500">العنوان: {clinic.address}</p>}
              </div>
              {clinic.logoUrl && clinic.logoUrl.trim() !== '' ? (
                <img src={clinic.logoUrl} alt="Logo" className="w-32 h-24 object-contain object-left shrink-0" />
              ) : (
                <div className="w-16 h-16 bg-slate-100 rounded-xl flex items-center justify-center border-2 border-slate-300 font-bold text-slate-400">CMS</div>
              )}
            </div>

            <div className="text-center my-6">
              <h2 className="text-xl font-black tracking-wide border-y border-slate-300 py-2.5">فاتورة علاج ومتابعة مالية</h2>
              <p className="text-xs text-slate-400 mt-1">تاريخ طباعة الفاتورة: {new Date().toLocaleString('ar-EG')}</p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-y-3 gap-x-6 text-sm mb-6">
              <div>
                <span className="font-bold text-slate-600">اسم المريض:</span>{' '}
                <span className="font-black text-slate-800">{printInvoiceData.patientName}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600">رقم الهاتف:</span>{' '}
                <span className="font-mono text-slate-800">{printInvoiceData.patientPhone || 'غير مسجل'}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600">تاريخ الموعد:</span>{' '}
                <span className="font-mono text-slate-800">{printInvoiceData.date}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600">توقيت الجلسة:</span>{' '}
                <span className="font-mono text-slate-800">{formatTimeTo12Hour(printInvoiceData.time)}</span>
              </div>
            </div>

            <div className="mb-6">
              <table className="w-full border-collapse border border-slate-300 text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-800">
                    <th className="border border-slate-300 p-3 text-right">نوع الإجراء / العلاج الطبي</th>
                    <th className="border border-slate-300 p-3 text-center">الحالة</th>
                    <th className="border border-slate-300 p-3 text-left">التكلفة الكلية (ج.م)</th>
                  </tr>
                </thead>
                <tbody>
                  {resolveProcedureBreakdown(printInvoiceData).map((proc, pIdx) => (
                    <tr key={pIdx}>
                      <td className="border border-slate-300 p-3 font-bold">
                        {proc.name} {proc.tooth ? `(${getToothInfo(proc.tooth).fullText})` : ''}
                      </td>
                      <td className="border border-slate-300 p-3 text-center">
                        {printInvoiceData.status === 'completed' ? 'تم تقديم الخدمة' : 'موعد مجدول'}
                      </td>
                      <td className="border border-slate-300 p-3 text-left font-mono font-bold">{proc.price.toLocaleString()} ج.م</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="w-80 mr-auto space-y-2 border-t border-slate-300 pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 font-bold">إجمالي تكلفة العلاج:</span>
                <span className="font-bold font-mono text-slate-800">{printInvoiceData.price.toLocaleString()} ج.م</span>
              </div>
              <div className="flex justify-between text-emerald-700 bg-emerald-50/50 p-1 px-2 rounded font-bold">
                <span>ما تم دفعه اليوم (مسدد):</span>
                <span className="font-black font-mono">{(printInvoiceData.paidAmount !== undefined ? printInvoiceData.paidAmount : printInvoiceData.price).toLocaleString()} ج.م</span>
              </div>
              <div className="flex justify-between text-amber-700 bg-amber-50/50 p-1 px-2 rounded font-bold border-t border-dashed border-amber-200">
                <span>المتبقي في الجلسات القادمة:</span>
                <span className="font-black font-mono">{(printInvoiceData.remainingAmount !== undefined ? printInvoiceData.remainingAmount : 0).toLocaleString()} ج.م</span>
              </div>
            </div>

            {printInvoiceData.notes && (
              <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <span className="font-bold text-slate-700 block mb-1">ملاحظات وسجل الدفعات:</span>
                <p className="whitespace-pre-line text-slate-600 leading-relaxed">{printInvoiceData.notes}</p>
              </div>
            )}

            <div className="mt-16 text-center border-t border-slate-200 pt-6 flex justify-between items-center text-xs text-slate-400">
              <span>توقيع الحسابات / السكرتارية: .........................</span>
              <span>توقيع طبيب العيادة الشريك: .........................</span>
              <span>نظام إدارة العيادات السحابي الموحد</span>
            </div>
          </div>
        )}
      </PrintPreviewModal>

      {/* Printable Shift Closure Report Modal */}
      <PrintPreviewModal
        isOpen={!!printShiftData}
        onClose={() => setPrintShiftData(null)}
        title="تقرير إغلاق الوردية الشامل (الشيفت واليومية المالية)"
      >
        {printShiftData && (
          <div className="bg-white text-slate-900 leading-normal text-right text-xs p-1 font-sans" dir="rtl">
            
            {/* 1. Header Section */}
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-2 mb-2.5">
              <div className="space-y-0.5">
                <h1 className="text-lg font-black text-slate-900">{clinic.nameAr || clinic.name}</h1>
                <p className="text-[10px] text-slate-600 font-bold">
                  د. {clinic.doctorName || 'طبيب متخصص'} {clinic.doctorSpecialtyAr ? `• ${clinic.doctorSpecialtyAr}` : ''}
                </p>
                {clinic.doctorPhone && (
                  <p className="text-[9px] text-slate-500 font-mono">
                    هاتف: {clinic.doctorPhone}{clinic.additionalPhones && clinic.additionalPhones.length > 0 ? ` - ${clinic.additionalPhones.filter(Boolean).join(' - ')}` : ''}
                  </p>
                )}
                {clinic.address && <p className="text-[9px] text-slate-500">العنوان: {clinic.address}</p>}
              </div>

              <div className="text-left space-y-0.5">
                <div className="inline-block bg-slate-900 text-white font-black text-[11px] px-2.5 py-0.5 rounded">
                  تقرير إغلاق ومطابقة الوردية
                </div>
                <p className="text-[10px] text-slate-700 font-bold block mt-1">تاريخ اليومية: <span className="font-mono text-xs">{printShiftData.date}</span></p>
                <p className="text-[9px] text-slate-500 block">توقيت الإغلاق: {printShiftData.closedAt ? new Date(printShiftData.closedAt).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }) : new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                <p className="text-[9px] text-slate-600 font-bold block">الكاشير / المسؤول: {printShiftData.cashierName || printShiftData.closedBy || 'طاقم العيادة'}</p>
              </div>
            </div>

            {/* 2. Key Financial Indicators Grid */}
            <div className="mb-2.5 bg-slate-50 border border-slate-300 rounded-lg p-2 space-y-1">
              <span className="text-[10px] font-extrabold text-slate-900 block border-b border-slate-200 pb-0.5">
                📊 {isEn ? 'Shift Financial Performance & Profitability Summary' : 'ملخص الأداء المالي والربحية للوردية'}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-center pt-0.5">
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <span className="text-[9px] text-slate-500 block font-bold">{isEn ? 'Opening Float (Start Cash)' : 'عهدة الافتتاح (كاش بداية)'}</span>
                  <span className="text-xs font-black text-slate-800 font-mono">{(printShiftData.startCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <span className="text-[9px] text-slate-500 block font-bold">{isEn ? 'Total Receipts (Income)' : 'إجمالي المقبوضات (الوارد)'}</span>
                  <span className="text-xs font-black text-emerald-700 font-mono">{(printShiftData.totalRevenue || printShiftData.expected || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <span className="text-[9px] text-slate-500 block font-bold">{isEn ? 'Total Deducted Expenses' : 'إجمالي المصاريف المخصومة'}</span>
                  <span className="text-xs font-black text-rose-700 font-mono">-{((printShiftData.expensesTotal) || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div className="bg-amber-50 p-1.5 rounded border border-amber-200">
                  <span className="text-[9px] text-amber-900 block font-bold">{isEn ? 'Installments & Outstanding' : 'الأقساط والمتبقي بالذمة'}</span>
                  <span className="text-xs font-black text-amber-700 font-mono">{(printShiftData.remainingRevenue || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div className="bg-white p-1.5 rounded border border-slate-200">
                  <span className="text-[9px] text-slate-500 block font-bold">{isEn ? 'Net Collected Revenue' : 'صافي الإيراد المحصل'}</span>
                  <span className="text-xs font-black text-indigo-700 font-mono">
                    {((printShiftData.totalRevenue || printShiftData.expected || 0) - (printShiftData.expensesTotal || 0)).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Detailed Payment Methods Matrix Table */}
            <div className="mb-2.5 border border-slate-300 rounded-lg p-2">
              <span className="text-[10px] font-extrabold text-slate-900 block mb-1">
                💳 {isEn ? 'Receipts, Expenses & Net Analysis by Payment Method' : 'تحليل المقبوضات والمصاريف والصافي حسب طريقة الدفع'}
              </span>
              <table className="w-full border-collapse border border-slate-300 text-[10px] text-center">
                <thead>
                  <tr className="bg-slate-100 text-slate-800 font-bold">
                    <th className="border border-slate-300 p-1 text-right">{isEn ? 'Payment Method' : 'طريقة الدفع'}</th>
                    <th className="border border-slate-300 p-1">{isEn ? 'Total In (Collected)' : 'إجمالي الوارد (المقبوض)'}</th>
                    <th className="border border-slate-300 p-1">{isEn ? 'Total Expenses (Deducted)' : 'إجمالي المصاريف (المخصومة)'}</th>
                    <th className="border border-slate-300 p-1">{isEn ? 'Net Collected' : 'الصافي المحصل'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(printShiftData.activeMethodsList || ['كاش', 'فيزا', 'إنستاباي', 'محفظة']).map((method, idx) => {
                    const rev = printShiftData.revenuesMap ? (printShiftData.revenuesMap[method] || 0) : (
                      method === 'كاش' ? (printShiftData.cashRevenue || printShiftData.cashAmount || 0) :
                      method === 'فيزا' ? (printShiftData.cardRevenue || printShiftData.cardAmount || 0) :
                      method === 'إنستاباي' ? (printShiftData.instapayRevenue || printShiftData.instapayAmount || 0) :
                      method === 'محفظة' ? (printShiftData.walletRevenue || printShiftData.walletAmount || 0) : 0
                    );
                    const exp = printShiftData.expensesMap ? (printShiftData.expensesMap[method] || 0) : (
                      method === 'كاش' ? (printShiftData.cashExpenses || 0) : 0
                    );
                    const net = rev - exp;
                    const displayMethod = isEn ? (
                      method === 'كاش' ? 'Cash' :
                      method === 'فيزا' ? 'Visa / Card' :
                      method === 'إنستاباي' ? 'InstaPay' :
                      method === 'محفظة' ? 'E-Wallet' : method
                    ) : method;
                    return (
                      <tr key={idx} className={method === 'كاش' ? 'bg-amber-50/40 font-bold' : ''}>
                        <td className="border border-slate-300 p-1 text-right font-bold text-slate-800">
                          {displayMethod} {method === 'كاش' ? '💵' : method === 'فيزا' ? '💳' : method === 'إنستاباي' ? '⚡' : '📱'}
                        </td>
                        <td className="border border-slate-300 p-1 font-mono text-emerald-700 font-bold">{rev.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                        <td className="border border-slate-300 p-1 font-mono text-rose-600">{exp > 0 ? `-${exp.toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}` : `0 ${isEn ? 'EGP' : 'ج.م'}`}</td>
                        <td className="border border-slate-300 p-1 font-mono font-black text-indigo-800">{net.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-200/80 font-black text-slate-900 border-t border-slate-400">
                    <td className="border border-slate-300 p-1 text-right">{isEn ? 'Overall Shift Total' : 'الإجمالي الكلي للوردية'}</td>
                    <td className="border border-slate-300 p-1 font-mono text-emerald-800">{(printShiftData.totalRevenue || printShiftData.expected || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                    <td className="border border-slate-300 p-1 font-mono text-rose-800">-{((printShiftData.expensesTotal) || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                    <td className="border border-slate-300 p-1 font-mono text-indigo-900">
                      {((printShiftData.totalRevenue || printShiftData.expected || 0) - (printShiftData.expensesTotal || 0)).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 4. Cash Drawer Reconciliation Formula Box */}
            <div className="mb-2.5 border border-indigo-300 bg-indigo-50/20 rounded-lg p-2 text-xs space-y-1">
              <div className="flex justify-between items-center border-b border-indigo-100 pb-0.5">
                <span className="font-black text-indigo-950 text-[11px] flex items-center gap-1">
                  💵 {isEn ? 'Cash Drawer Reconciliation Formula' : 'معادلة مطابقة الخزنة النقدية الكاش بالدرج (Cash Reconciliation)'}
                </span>
                <span className="text-[9px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-bold">
                  {isEn ? 'Drawer Reconciliation' : 'مطابقة الدرج'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px] pt-0.5">
                <div>
                  <span className="text-slate-500 block">{isEn ? 'Opening Float:' : 'عهدة الافتتاح:'}</span>
                  <span className="font-mono font-bold text-slate-800">{(printShiftData.startCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">{isEn ? '+ Cash Receipts:' : '+ المقبوضات الكاش:'}</span>
                  <span className="font-mono font-bold text-emerald-700">+{(printShiftData.cashRevenue || printShiftData.cashAmount || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">{isEn ? '- Deducted Cash Expenses:' : '- مصاريف الكاش المخصومة:'}</span>
                  <span className="font-mono font-bold text-rose-600">-{((printShiftData.cashExpenses !== undefined ? printShiftData.cashExpenses : printShiftData.expensesTotal) || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
              </div>
              <div className="border-t border-dashed border-indigo-200 pt-1 flex flex-wrap justify-between items-center text-[10px] font-bold gap-2">
                <div>
                  <span className="text-slate-700">{isEn ? 'Expected Drawer Cash: ' : 'الكاش المتوقع بالدرج: '}</span>
                  <span className="font-mono text-indigo-900 font-black">{(printShiftData.expectedCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div>
                  <span className="text-slate-700">{isEn ? 'Actual Drawer Cash: ' : 'الكاش الفعلي بالدرج: '}</span>
                  <span className="font-mono text-slate-900 font-black">{(printShiftData.actual || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                </div>
                <div className="bg-white px-2 py-0.5 rounded border border-indigo-200">
                  <span className="text-slate-600">{isEn ? 'Reconciliation Status: ' : 'حالة المطابقة: '}</span>
                  <span className={`font-mono font-black ${
                    printShiftData.discrepancy === 0 
                      ? 'text-emerald-700' 
                      : printShiftData.discrepancy < 0 
                        ? 'text-rose-600' 
                        : 'text-indigo-600'
                  }`}>
                    {printShiftData.discrepancy === 0 
                      ? (isEn ? 'Exact Match (0)' : 'مطابق تماماً (0)') 
                      : `${printShiftData.discrepancy > 0 ? (isEn ? 'Surplus: +' : 'زيادة: +') : (isEn ? 'Deficit: ' : 'عجز: ')}${printShiftData.discrepancy.toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}`}
                  </span>
                </div>
              </div>
            </div>

            {/* 5. Itemized Expenses Section */}
            {printShiftData.expensesList && printShiftData.expensesList.length > 0 && (
              <div className="mb-2.5 border border-rose-200 rounded-lg p-2">
                <span className="text-[10px] font-extrabold text-rose-900 block mb-1">
                  📉 {isEn ? `Deducted Shift Expenses Table (${printShiftData.expensesList.length} items)` : `جدول المصاريف المخصومة بالوردية (${printShiftData.expensesList.length} بند)`}
                </span>
                <table className="w-full border-collapse border border-slate-300 text-[10px]">
                  <thead>
                    <tr className="bg-rose-50 text-rose-900 font-bold">
                      <th className="border border-slate-300 p-1 text-right">{isEn ? 'Expense Description' : 'بيان المصروف'}</th>
                      <th className="border border-slate-300 p-1 text-center">{isEn ? 'Category' : 'الفئة'}</th>
                      <th className="border border-slate-300 p-1 text-center">{isEn ? 'Deduction Method' : 'طريقة الخصم'}</th>
                      <th className="border border-slate-300 p-1 text-left">{isEn ? 'Amount' : 'المبلغ'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printShiftData.expensesList.map((exp: any, idx: number) => (
                      <tr key={exp.id || idx}>
                        <td className="border border-slate-300 p-1 font-bold text-slate-800">{exp.title}</td>
                        <td className="border border-slate-300 p-1 text-center text-slate-600">{exp.category || (isEn ? 'General' : 'عام')}</td>
                        <td className="border border-slate-300 p-1 text-center font-bold text-slate-700">{exp.paymentMethod || (isEn ? 'Cash' : 'كاش')}</td>
                        <td className="border border-slate-300 p-1 text-left font-mono font-bold text-rose-700">-{exp.amount.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 6. Itemized Patients & Collections Table */}
            <div className="mb-2.5 border border-slate-300 rounded-lg p-2">
              <span className="text-[10px] font-extrabold text-slate-900 block mb-1">
                📋 {isEn ? `Shift Bookings & Patient Payments Details (${printShiftData.appointments ? printShiftData.appointments.length : 0} bookings/ops)` : `تفاصيل الحجوزات والمدفوعات المحصلة من المرضى بالوردية (${printShiftData.appointments ? printShiftData.appointments.length : 0} حجز/عملية)`}
              </span>
              <table className="w-full border-collapse border border-slate-300 text-[10px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-800 font-bold">
                    <th className="border border-slate-300 p-1 text-right">{isEn ? 'Time' : 'الوقت'}</th>
                    <th className="border border-slate-300 p-1 text-right">{isEn ? 'Patient Name' : 'اسم المريض'}</th>
                    <th className="border border-slate-300 p-1 text-right">{isEn ? 'Treatment / Procedure' : 'نوع العلاج / الإجراء'}</th>
                    <th className="border border-slate-300 p-1 text-center">{isEn ? 'Payment Method' : 'طريقة الدفع'}</th>
                    <th className="border border-slate-300 p-1 text-left">{isEn ? 'Total Cost' : 'التكلفة الإجمالية'}</th>
                    <th className="border border-slate-300 p-1 text-left">{isEn ? 'Collected in Shift' : 'المحصل بالوردية'}</th>
                    <th className="border border-slate-300 p-1 text-left">{isEn ? 'Remaining (Credit)' : 'المتبقي (آجل)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(printShiftData.paymentRecords && printShiftData.paymentRecords.length > 0
                    ? printShiftData.paymentRecords
                    : printShiftData.appointments || []
                  ).map((item: any, idx: number) => {
                    const isPaymentRecord = !!item.app;
                    const app = isPaymentRecord ? item.app : item;
                    const paid = isPaymentRecord ? item.amount : (app.paidAmount !== undefined ? app.paidAmount : app.price);
                    const remaining = app.remainingAmount !== undefined ? app.remainingAmount : 0;
                    const method = isPaymentRecord ? item.paymentMethod : app.paymentMethod;
                    const timeVal = isPaymentRecord ? item.time : app.time;
                    const isUnpaid = (paid || 0) === 0;
                    return (
                      <tr key={item.id || idx} className={isUnpaid ? 'bg-rose-100/80 text-rose-950 font-bold' : ''}>
                        <td className="border border-slate-300 p-1 font-mono text-slate-600">{formatTimeTo12Hour(timeVal)}</td>
                        <td className="border border-slate-300 p-1 font-bold text-slate-800">{app.patientName} {isUnpaid ? (isEn ? '⚠️ (Unpaid)' : '⚠️ (لم يدفع)') : ''}</td>
                        <td className="border border-slate-300 p-1 text-slate-700">{app.treatmentType || (isEn ? 'Dental Treatment' : 'علاج أسنان')}{item.notes ? ` (${item.notes})` : ''}</td>
                        <td className="border border-slate-300 p-1 text-center font-bold text-slate-700">{formatPaymentMethod(method)}</td>
                        <td className="border border-slate-300 p-1 text-left font-mono text-slate-700">{(app.price || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                        <td className={`border border-slate-300 p-1 text-left font-mono font-bold ${isUnpaid ? 'text-rose-700' : 'text-emerald-700'}`}>{(paid || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                        <td className="border border-slate-300 p-1 text-left font-mono font-bold text-amber-700">{(remaining || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 7. Shift Notes */}
            {printShiftData.notes && (
              <div className="mb-2 bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-[9px]">
                <span className="font-bold text-slate-800 block mb-0.5">{isEn ? '📝 Shift Notes & Cash Notes:' : '📝 ملاحظات الوردية ومذكرة الخزنة:'}</span>
                <p className="whitespace-pre-line text-slate-600 font-mono leading-relaxed">{printShiftData.notes}</p>
              </div>
            )}

            {/* 8. Official Signatures Footer */}
            <div className="mt-3 pt-2 border-t border-slate-300 flex justify-between items-center text-[9px] text-slate-500 font-bold">
              <span>توقيع مسؤول الكاشير / السكرتارية: .........................</span>
              <span>توقيع طبيب / مدير العيادة: .........................</span>
              <span>طبع بتاريخ: {new Date().toLocaleString('ar-EG')}</span>
            </div>
          </div>
        )}
      </PrintPreviewModal>

      {/* Screen Title Block */}
      <div className="print:hidden flex flex-col xl:flex-row xl:items-center justify-between gap-5 bg-gradient-to-l from-white via-slate-50/50 to-slate-100/30 p-6 rounded-3xl border border-slate-200/80 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500 rounded-full blur-3xl opacity-5 -mr-12 -mt-12 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-5 -ml-12 -mb-12 pointer-events-none"></div>
        
        <div className="flex items-center gap-4 relative z-10">
          <div className="bg-emerald-500/10 p-3.5 rounded-2xl border border-emerald-500/20 shadow-xs text-emerald-600">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">{t('financials.title')}</h1>
          </div>
        </div>

        <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-2xl text-xs gap-1">
          {isTabAllowed('shift_closure') && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab('shift_closure')}
              className={`py-2 px-4 rounded-xl font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'shift_closure' 
                  ? 'bg-white text-slate-800 shadow-sm border-slate-200/40' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              <Clock className="h-4 w-4 text-indigo-600" />
              {isEn ? 'Daily Register Closing' : (t('financials.tabs.dailyClosing') || 'إقفال اليومية والوردية')}
            </motion.button>
          )}
          {isTabAllowed('shift_history') && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab('shift_history')}
              className={`py-2 px-4 rounded-xl font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'shift_history' 
                  ? 'bg-white text-slate-800 shadow-sm border-slate-200/40' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              <Archive className="h-4 w-4 text-amber-600" />
              {isEn ? 'Closing Archives & Logs' : (t('financials.tabs.closingLog') || 'سجل الإقفال التاريخي')}
            </motion.button>
          )}
          {isTabAllowed('revenues') && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setActiveTab('revenues');
                setRevenuesLimit(10);
              }}
              className={`py-2 px-4 rounded-xl font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'revenues' 
                  ? 'bg-white text-slate-800 shadow-sm border-slate-200/40' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              {isEn ? 'Revenue Analytics & Reports' : (t('financials.tabs.revenueReports') || 'التقارير وتحليلات الإيرادات')}
            </motion.button>
          )}
          {isTabAllowed('installments') && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setActiveTab('installments');
                setInstallmentsLimit(6); // Reset limit to 6 when clicked
              }}
              className={`py-2 px-4 rounded-xl font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'installments' 
                  ? 'bg-white text-slate-800 shadow-sm border-slate-200/40' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              <Receipt className="h-4 w-4 text-rose-500" />
              {isEn ? 'Patient Installments & Balances' : (t('financials.tabs.installments') || 'المرضى والأقساط المستحقة')}
            </motion.button>
          )}
          {isTabAllowed('expenses') && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setActiveTab('expenses');
              }}
              className={`py-2 px-4 rounded-xl font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'expenses' 
                  ? 'bg-white text-slate-800 shadow-sm border-slate-200/40' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/40'
              }`}
            >
              <TrendingDown className="h-4 w-4 text-rose-500" />
              {isEn ? 'Clinic Expenses & Purchasing' : (t('financials.tabs.expenses') || 'المصروفات والبنود المقتطعة')}
            </motion.button>
          )}
        </div>
      </div>

      {error && (
        <div className="print:hidden bg-rose-50 border-r-4 border-rose-500 p-4 rounded-xl flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-700 font-bold">{error}</p>
        </div>
      )}


      {/* Main Tab Content */}
      <div className="print:hidden grid grid-cols-1 lg:grid-cols-12 gap-6">



        {/* TAB 2: Shift / Daily Register Closure */}
        {activeTab === 'shift_closure' && (
          <>
            {!activeShift ? (
              // Shift is CLOSED / NOT OPENED YET
              <>
                <div className="lg:col-span-8 space-y-4 animate-fade-in">
                  <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center space-y-6 min-h-[400px]">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 border border-slate-200/60 shadow-inner">
                      <Lock className="h-7 w-7" />
                    </div>
                    
                    <div className="space-y-2 max-w-md">
                      <h2 className="text-lg font-black text-slate-800">{isEn ? 'Cash Register Closed' : 'خزينة الكاشير مغلقة حالياً'}</h2>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {isEn ? (
                          <>Welcome <span className="font-bold text-indigo-700">{operatorName || 'User'}</span>, there is currently no active shift for the clinic. Please activate a new shift by clicking the button below under your name to start receiving daily transactions.</>
                        ) : (
                          <>أهلاً <span className="font-bold text-indigo-700">{operatorName || 'بكم'}</span>، لا توجد وردية نشطة حالياً للعيادة. لضمان المتابعة الدقيقة للحسابات المالية وتجنب أي تداخل في تسليم الخزنة، يرجى تفعيل الوردية الجديدة بالضغط على زر التفعيل باسمك لاستلام العهدة وبدء استقبال مبيعات اليومية.</>
                        )}
                      </p>
                    </div>

                    {/* Live Pre-Shift Receipts & Expenses Summary */}
                    <div className="w-full max-w-xl bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 text-right space-y-3">
                      <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2">
                        <span className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
                          <DollarSign className="h-4 w-4 text-emerald-600" />
                          {isEn ? `Today's Recorded Receipts & Expenses Summary (${selectedShiftDate})` : `ملخص المقبوضات والمدفوعات المسجلة اليوم (${selectedShiftDate}) - بانتظار بدء الوردية`}
                        </span>
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 font-extrabold px-2.5 py-0.5 rounded-md">
                          {isEn ? 'Total Daily Revenue:' : 'إجمالي الإيرادات اليوم:'} {dailyExpectedCash.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                        <div className="bg-white p-2.5 rounded-xl border border-emerald-100/80 flex flex-col justify-between">
                          <span className="text-[10px] text-slate-500 font-bold">{isEn ? 'Cash Collected' : 'كاش محصل اليوم'}</span>
                          <span className="font-mono font-black text-emerald-700 text-xs mt-1">{dailyCashAmount.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-emerald-100/80 flex flex-col justify-between">
                          <span className="text-[10px] text-slate-500 font-bold">{isEn ? 'Electronic Payments' : 'مدفوعات إلكترونية'}</span>
                          <span className="font-mono font-black text-indigo-700 text-xs mt-1">{(Number(dailyExpectedCash) - Number(dailyCashAmount)).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-emerald-100/80 flex flex-col justify-between">
                          <span className="text-[10px] text-slate-500 font-bold">{isEn ? 'Recorded Expenses' : 'مصاريف مسجلة اليوم'}</span>
                          <span className="font-mono font-black text-rose-600 text-xs mt-1">{Number(activeShiftExpensesTotal).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="bg-white p-2.5 rounded-xl border border-emerald-100/80 flex flex-col justify-between">
                          <span className="text-[10px] text-slate-500 font-bold">{isEn ? 'Expected Net Cash' : 'صافي النقدية المتوقعة'}</span>
                          <span className="font-mono font-black text-emerald-800 text-xs mt-1">{(Number(dailyCashAmount) - Number(activeShiftExpensesTotal)).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                      </div>

                      <p className="text-[10px] text-emerald-800 font-medium leading-relaxed bg-white/70 p-2 rounded-lg border border-emerald-100/80">
                        💡 <strong>{isEn ? 'Important Note:' : 'ملاحظة هامة للحسابات:'}</strong> {isEn ? 'All recorded transactions match financial reports and will be automatically assigned to the active shift upon clicking "Start Shift".' : 'جميع المقبوضات أعلاه تتطابق تماماً مع حسابات الطبيب والتقارير المالية، وسيتم إدراجها تلقائياً وبشكل كامل ضمن الوردية فور الضغط على "بدء الوردية".'}
                      </p>
                    </div>

                    <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-150 text-right max-w-lg space-y-3.5">
                      <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 border-b border-slate-200/60 pb-2">
                        <Check className="h-4 w-4 text-emerald-600" />
                        {isEn ? 'Shift System & Register Protection' : 'نظام الورديات والحماية الذكية للدرج'}
                      </h4>
                      <ul className="text-[11px] text-slate-600 space-y-2.5 list-disc list-inside">
                        <li><strong>{isEn ? 'Overlap Prevention:' : 'منع التداخل:'}</strong> {isEn ? 'Prevents opening two active cashier shifts simultaneously to protect register balances.' : 'يمنع النظام فتح جلستين كاشير/ورديتين في نفس الوقت منعاً تاماً لضمان عدم خلط العهدة.'}</li>
                        <li><strong>{isEn ? 'Opening Float:' : 'عهدة البداية:'}</strong> {isEn ? 'Recording opening cash float allows the system to calculate exact expected cash accurately.' : 'تسجيل قيمة كاش البداية يسمح للنظام بحساب النقدية المتوقعة بالمعادلة الرياضية الصحيحة.'}</li>
                        <li><strong>{isEn ? 'Doctor Monitoring:' : 'مراقبة الطبيب:'}</strong> {isEn ? 'Clinic owners and doctors can view live active sales and receipts at any time.' : 'يمكن للمدير أو الطبيب الدخول في أي وقت لمتابعة إجمالي مبيعات ومحصلات الوردية الحالية في بث مباشر.'}</li>
                      </ul>
                    </div>

                    {/* Allow read-only historic lookup */}
                    <div className="border-t border-slate-100 pt-4 w-full max-w-md">
                      <div className="flex items-center justify-between gap-3 bg-indigo-50/40 px-4 py-2.5 rounded-xl border border-indigo-100/40">
                        <span className="text-[10px] font-bold text-indigo-800">{isEn ? 'View Sales for Specific Date (Without Opening Shift)' : 'استعراض مبيعات تاريخ معين (دون فتح وردية)'}</span>
                        <input
                          type="date"
                          value={selectedShiftDate}
                          onChange={(e) => setSelectedShiftDate(e.target.value)}
                          className="px-2 py-1 border border-slate-200 rounded-lg text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-left bg-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right sidebar - Open Shift Form */}
                <div className="lg:col-span-4">
                  <form onSubmit={handleOpenShift} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3">
                      <Unlock className="h-5 w-5 text-indigo-600" />
                      {isEn ? 'Open New Cashier Shift' : 'بدء وردية كاشير جديدة'}
                    </h3>

                    {shiftSuccess && (
                      <div className="bg-emerald-50 border-r-4 border-emerald-500 p-3 rounded-xl flex items-start gap-2.5 animate-fade-in">
                        <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-800 font-semibold leading-relaxed">{shiftSuccess}</p>
                      </div>
                    )}

                    <div className="space-y-3.5">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">{isEn ? 'Shift Operator' : 'اسم المسؤول عن الوردية (حسابك الحالي)'}</label>
                        <div className="relative bg-indigo-50/40 border border-indigo-100 px-3.5 py-2.5 rounded-xl flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 text-sm">👤</span>
                            <span className="text-xs font-black text-indigo-900">{operatorName || (isEn ? 'Clinic Staff' : 'طاقم العيادة')}</span>
                          </div>
                          <span className="text-[9px] bg-indigo-150 text-indigo-700 font-extrabold px-2 py-0.5 rounded-md">{isEn ? 'Active Account' : 'حساب نشط'}</span>
                        </div>
                        <input
                          type="hidden"
                          value={operatorName || (isEn ? 'Clinic Staff' : 'طاقم العيادة')}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">{isEn ? 'Shift Work Date' : 'تاريخ عمل الوردية (يومية الوردية)'}</label>
                        <input
                          type="date"
                          required
                          value={selectedShiftDate}
                          onChange={(e) => setSelectedShiftDate(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold font-mono text-center"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">{isEn ? 'Opening Cash Float' : 'عهدة بداية الدرج (المبلغ النقدي المفتتح به)'}</label>
                        <div className="relative font-mono">
                          <span className="absolute left-3 top-2 text-[10px] text-slate-400 font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                          <input
                            type="number"
                            required
                            inputMode="decimal"
                            value={startCashInput}
                            onChange={(e) => setStartCashInput(e.target.value)}
                            placeholder={isEn ? 'e.g. 500' : 'مثال: 500'}
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold text-center"
                          />
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1 leading-relaxed">{isEn ? 'Cash float amount present in the drawer for change.' : 'المبلغ النقدي المتواجد في درج الخزنة كعهدة فكة لافتتاح الدرج ومطابقة الإغلاق عليها لاحقاً.'}</p>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">{isEn ? 'Opening Notes (Optional)' : 'ملاحظات الافتتاح (اختياري)'}</label>
                        <textarea
                          value={openingNotesInput}
                          onChange={(e) => setOpeningNotesInput(e.target.value)}
                          rows={2}
                          placeholder={isEn ? 'Write any notes or received float...' : 'اكتب أي ملاحظة أو عهدة إضافية مستلمة...'}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs text-right resize-none"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 text-xs font-bold py-3 rounded-xl transition shadow-sm flex items-center justify-center gap-2 cursor-pointer border border-transparent"
                      >
                        <Unlock className="h-4 w-4" />
                        {loading ? (isEn ? 'Activating Shift...' : 'جاري تفعيل الوردية...') : (isEn ? `Start Shift as ${operatorName || 'Staff'}` : `بدء الوردية باسم ${operatorName || 'طاقم العيادة'}`)}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              // Shift IS OPEN / ACTIVE
              <>
                {/* Shift Calculations & Booking List Linked (col-span-8) */}
                <div className="lg:col-span-8 space-y-4 animate-fade-in">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
                    
                    {/* Active Shift Header Banner */}
                    <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-right">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-sm">
                          <Unlock className="h-5 w-5" />
                        </div>
                        <div>
                          <span className="text-xs font-extrabold text-indigo-900 block">{isEn ? 'Current Shift is Active & Open' : 'الوردية الحالية نشطة ومفتوحة'}</span>
                          <p className="text-[10px] text-indigo-700 mt-0.5">
                            {isEn ? 'Operator:' : 'المسؤول:'} <strong>{activeShift.cashierName}</strong> | {isEn ? 'Started:' : 'بدءاً من:'} {new Date(activeShift.openedAt).toLocaleTimeString(isEn ? 'en-US' : 'ar-EG', {hour: '2-digit', minute:'2-digit'})} ({new Date(activeShift.openedAt).toLocaleDateString(isEn ? 'en-US' : 'ar-EG')})
                          </p>
                        </div>
                      </div>
                      <div className="text-left">
                        <span className="text-[10px] bg-indigo-100/80 text-indigo-700 font-bold px-2.5 py-1 rounded-lg">{isEn ? 'Workday:' : 'يوم عمل:'} {activeShift.date}</span>
                      </div>
                    </div>

                    {/* Sequential Breakdown Rectangles Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {/* 1. المحصل كله بكل الطرق */}
                      <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-200/80 text-right space-y-1.5">
                        <span className="text-xs font-black text-emerald-900 block flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                          {isEn ? 'Total Collected (All Methods)' : 'المحصل كله بكل الطرق'}
                        </span>
                        <span className="text-xl font-black text-emerald-700 font-mono block">
                          {dailyExpectedCash.toLocaleString()} <span className="text-xs font-normal text-emerald-500">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>

                      {/* 2. الأقساط الباقية */}
                      <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-200/80 text-right space-y-1.5">
                        <span className="text-xs font-black text-amber-900 block flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
                          {isEn ? 'Installments & Due Balances' : 'الأقساط والمتبقي'}
                        </span>
                        <span className="text-xl font-black text-amber-700 font-mono block">
                          {dailyRemainingCash.toLocaleString()} <span className="text-xs font-normal text-amber-500">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>

                      {/* 3. المصاريف */}
                      <div className="bg-rose-50/50 p-4 rounded-2xl border border-rose-200/80 text-right space-y-1.5">
                        <span className="text-xs font-black text-rose-900 block flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
                          {isEn ? 'Deducted Expenses' : 'المصاريف المخصومة'}
                        </span>
                        <span className="text-xl font-black text-rose-600 font-mono block">
                          {activeShiftExpensesTotal.toLocaleString()} <span className="text-xs font-normal text-rose-400">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>

                      {/* 4. المتوقع كاش بالدرج */}
                      <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-200/80 text-right space-y-1.5">
                        <span className="text-xs font-black text-indigo-900 block flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"></span>
                          {isEn ? 'Expected Cash in Drawer' : 'المتوقع كاش بالدرج'}
                        </span>
                        <span className="text-xl font-black text-indigo-700 font-mono block">
                          {(Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses).toLocaleString()} <span className="text-xs font-normal text-indigo-400">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Clear Breakdown of All Payment Methods */}
                    <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-150 space-y-3">
                      <div className="text-xs font-extrabold text-slate-700 flex items-center justify-between border-b border-slate-200/60 pb-2">
                        <span className="flex items-center gap-1.5">
                          <DollarSign className="h-4 w-4 text-indigo-600" />
                          {isEn ? 'Shift Revenue Details by Payment Method' : 'تفاصيل الإيرادات المحصلة بالوردية حسب طريقة الدفع'}
                        </span>
                        <span className="text-[10px] bg-emerald-100/80 text-emerald-800 px-2.5 py-0.5 rounded-md font-bold">
                          {isEn ? `Total Collected: ${dailyExpectedCash.toLocaleString()} EGP` : `إجمالي المحصل: ${dailyExpectedCash.toLocaleString()} ج.م`}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                        {activeMethodsList.map((method, idx) => {
                          const isLoyalty = normalizePaymentMethod(method) === 'نقاط الولاء';
                          const rev = dynamicRevenues[method] || 0;
                          const exp = dynamicExpenses[method] || 0;
                          const net = rev - exp;
                          const displayMethodName = isEn ? (
                            method === 'كاش' ? 'Cash' :
                            method === 'فيزا' ? 'Visa / Card' :
                            method === 'إنستاباي' ? 'InstaPay' :
                            method === 'محفظة' ? 'E-Wallet' : method
                          ) : method;
                          return (
                            <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-between hover:border-indigo-200 transition duration-150 shadow-2xs">
                              <div className="flex items-center justify-between mb-1 border-b border-slate-100 pb-1">
                                <span className="text-[11px] font-black text-slate-800">
                                  {isLoyalty ? (isEn ? '🎁 Loyalty Points' : '🎁 نقاط الولاء') : displayMethodName}
                                </span>
                                <span className="text-xs">
                                  {isLoyalty ? '🎁' : method === 'كاش' ? '💵' : method === 'فيزا' ? '💳' : method === 'إنستاباي' ? '⚡' : method === 'محفظة' ? '📱' : '💼'}
                                </span>
                              </div>
                              <div className="space-y-1 mt-1 text-[10px]">
                                <div className="flex justify-between text-slate-500">
                                  <span>{isLoyalty ? (isEn ? 'Points Discount:' : 'خصم النقاط:') : (isEn ? 'In:' : 'وارد:')}</span>
                                  <span className="font-mono font-bold text-emerald-600">{(rev).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                                </div>
                                {!isLoyalty && (
                                  <div className="flex justify-between text-slate-500">
                                    <span>{isEn ? 'Expenses:' : 'مصروف:'}</span>
                                    <span className="font-mono font-bold text-rose-600">{(exp).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                                  </div>
                                )}
                                <div className="flex justify-between font-black text-slate-800 border-t border-slate-100 pt-1 mt-1">
                                  <span>{isLoyalty ? (isEn ? 'Settlement:' : 'تسوية الخصم:') : (isEn ? 'Net:' : 'صافي:')}</span>
                                  <span className="font-mono text-indigo-600">{(net).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Interactive Booking List */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-700 flex items-center justify-between border-b border-slate-100 pb-1">
                        <span>{isEn ? 'Current Shift Bookings & Collections List' : 'قائمة حجوزات ومتحصلات الوردية الحالية'}</span>
                        <span className="text-[10px] text-slate-400">{isEn ? `Total collected from patients for linked day (${activeShift.date})` : `مجموع المبالغ المقبوضة من المرضى لليوم المربوط (${activeShift.date})`}</span>
                      </div>

                      {activeShiftPaymentRecords.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 border border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                          <CalendarIcon className="h-6 w-6 mx-auto text-slate-300 mb-1" />
                          <span className="text-[11px] font-bold">{isEn ? 'No collections or bookings registered in this shift yet' : 'لم يتم تحصيل أي مبالغ أو تسجيل حجز في هذه الوردية بعد'}</span>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                          {activeShiftPaymentRecords.slice(0, shiftOperationsLimit).map((payRecord) => {
                            const app = payRecord.app;
                            const paid = payRecord.amount;
                            const remaining = app.remainingAmount !== undefined ? app.remainingAmount : 0;
                            const isUnpaid = (paid || 0) === 0;
                            return (
                              <div
                                key={payRecord.id}
                                className={`p-3 rounded-xl flex items-center justify-between text-xs transition shadow-2xs ${
                                  isUnpaid
                                    ? 'bg-rose-50 border-2 border-rose-300 text-rose-950 hover:border-rose-400'
                                    : 'bg-white border border-slate-150 hover:border-indigo-150'
                                }`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 font-mono ${
                                    isUnpaid ? 'bg-rose-200 text-rose-800' : 'bg-emerald-50 text-emerald-700'
                                  }`}>
                                    {formatTimeTo12Hour(payRecord.time)}
                                  </span>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className={`font-bold ${isUnpaid ? 'text-rose-950 font-extrabold' : 'text-slate-800'}`}>{app.patientName}</span>
                                      {isUnpaid && (
                                        <span className="px-1.5 py-0.5 rounded-md bg-rose-200 text-rose-900 font-extrabold text-[9px] shrink-0 border border-rose-300">
                                          {isEn ? 'Unpaid (0 EGP) ⚠️' : 'لم يدفع (0 ج.م) ⚠️'}
                                        </span>
                                      )}
                                      {/* Payment method tag */}
                                      {(() => {
                                        const m = normalizePaymentMethod(payRecord.paymentMethod);
                                        if (m === 'فيزا') {
                                          return <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold text-[8px] shrink-0">{isEn ? 'Visa 💳' : 'فيزا 💳'}</span>;
                                        } else if (m === 'إنستاباي') {
                                          return <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold text-[8px] shrink-0">{isEn ? 'InstaPay ⚡' : 'إنستاباي ⚡'}</span>;
                                        } else if (m === 'محفظة') {
                                          return <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-bold text-[8px] shrink-0">{isEn ? 'Wallet 📱' : 'محفظة 📱'}</span>;
                                        } else if (m === 'كاش') {
                                          return <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold text-[8px] shrink-0">{isEn ? 'Cash 💵' : 'كاش 💵'}</span>;
                                        } else {
                                          return <span className="px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-700 font-bold text-[8px] shrink-0">{m} 💼</span>;
                                        }
                                      })()}
                                    </div>
                                    <span className={`text-[10px] block mt-0.5 ${isUnpaid ? 'text-rose-700' : 'text-slate-400'}`}>
                                      {app.treatmentType || (isEn ? 'General Treatment' : 'علاج عام')}
                                      {payRecord.notes ? ` • ${payRecord.notes}` : ''}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-4 text-left font-mono">
                                  <div>
                                    <span className="text-[9px] text-slate-400 block font-bold">{isEn ? 'Collected' : 'المحصل بالعملية'}</span>
                                    <span className={`text-xs font-bold ${isUnpaid ? 'text-rose-700 font-black' : 'text-emerald-600'}`}>{(paid || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-slate-400 block font-bold">{isEn ? 'Remaining' : 'المتبقي'}</span>
                                    <span className={`text-xs font-bold ${isUnpaid ? 'text-rose-800 font-black' : 'text-slate-500'}`}>{(remaining || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                                  </div>
                                  <button
                                    onClick={() => handlePrintInvoice(app)}
                                    className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-600 transition shrink-0 border-0 bg-transparent cursor-pointer"
                                    title={isEn ? 'View & Print Invoice' : 'عرض وطباعة فاتورة'}
                                  >
                                    <Printer className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}

                          {activeShiftPaymentRecords.length > shiftOperationsLimit && (
                            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                              <span className="text-[10px] text-slate-500 font-bold">
                                {isEn ? `Showing ${Math.min(shiftOperationsLimit, activeShiftPaymentRecords.length)} of ${activeShiftPaymentRecords.length} transactions` : <>عرض {Math.min(shiftOperationsLimit, activeShiftPaymentRecords.length)} من {activeShiftPaymentRecords.length} حركة</>}
                              </span>
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setShiftOperationsLimit(prev => prev + 5)}
                                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-[10px] transition cursor-pointer"
                                >
                                  {isEn ? '+5 More' : '+5 حركات إضافية'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShiftOperationsLimit(activeShiftPaymentRecords.length)}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-lg text-[10px] transition cursor-pointer"
                                >
                                  {isEn ? `Show All (${activeShiftPaymentRecords.length})` : `عرض الكل (${activeShiftPaymentRecords.length})`}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Shift Closure Drawer matching area (col-span-4) - Closing form */}
                <div className="lg:col-span-4 animate-fade-in">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3">
                      <Scale className="h-5 w-5 text-indigo-600" />
                      {isEn ? 'Drawer Reconciliation & Shift Closure' : 'مطابقة الدرج وإغلاق الوردية'}
                    </h3>

                    {shiftSuccess && (
                      <div className="bg-emerald-50 border-r-4 border-emerald-500 p-3 rounded-xl flex items-start gap-2.5 animate-fade-in">
                        <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-800 font-semibold leading-relaxed">{shiftSuccess}</p>
                      </div>
                    )}

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {isEn ? 'Please count actual cash in drawer and match it against cloud expected values to close shift.' : 'يرجى جرد ومطابقة الكاش الفعلي المتواجد بدرج الخزنة حالياً مع القيمة المتوقعة المسجلة سحابياً بالأسفل لإغلاق الوردية.'}
                    </p>

                    <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-150 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-semibold">{isEn ? 'Opening Cash Float:' : 'عهدة افتتاح البداية:'}</span>
                        <span className="font-bold font-mono text-slate-700">{Number(activeShift.startCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-semibold">{isEn ? 'New Cash Collected:' : 'المحصل كاش جديد:'}</span>
                        <span className="font-bold font-mono text-slate-700">{dailyCashAmount.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                      </div>
                      <div className="flex justify-between text-rose-600">
                        <span className="font-semibold">{isEn ? 'Deducted Cash Expenses:' : 'المصاريف النقدية المخصومة (كاش):'}</span>
                        <span className="font-bold font-mono">-{cashExpenses.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-200/50 pt-2">
                        <span className="text-slate-600 font-bold">{isEn ? 'Expected Cash in Drawer:' : 'المتوقع بالدرج كاش:'}</span>
                        <span className="font-bold font-mono text-emerald-700 text-sm">{(Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                      </div>
                      
                      {actualCashInput && !isNaN(Number(actualCashInput)) && (
                        <div className="flex justify-between border-t border-dashed border-slate-250 pt-2">
                          <span className="text-slate-500">{isEn ? 'Cash Discrepancy:' : 'الفارق بالدرج كاش:'}</span>
                          <span className={`font-black font-mono flex items-center gap-1 ${
                            (Number(actualCashInput) - (Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses)) === 0 
                              ? 'text-emerald-600' 
                              : (Number(actualCashInput) - (Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses)) < 0 
                                ? 'text-rose-600' 
                                : 'text-indigo-600'
                          }`}>
                            {(Number(actualCashInput) - (Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses)) === 0 ? (
                              <>
                                <CheckCircle className="h-3.5 w-3.5" />
                                {isEn ? 'Perfect Match' : 'متطابق تماماً'}
                              </>
                            ) : (
                              `${(Number(actualCashInput) - (Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses)) > 0 ? '+' : ''}${(Number(actualCashInput) - (Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses)).toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}`
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">{isEn ? 'Actual Cash Present in Drawer Now' : 'المبلغ المالي الفعلي المتواجد بالدرج حالياً'}</label>
                        <input
                          type="number"
                          required
                          inputMode="decimal"
                          value={actualCashInput}
                          onChange={(e) => setActualCashInput(e.target.value)}
                          placeholder={isEn ? 'Enter actual cash amount manually...' : 'اكتب قيمة المبلغ بالدرج يدوياً...'}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-bold font-mono text-center bg-indigo-50/20"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">{isEn ? 'Closing Operator' : 'المسؤول عن الإغلاق (مسترد من حسابك حالياً)'}</label>
                        <div className="relative bg-slate-50 border border-slate-200 px-3.5 py-2.5 rounded-xl flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 text-sm">👤</span>
                            <span className="text-xs font-black text-slate-700">{operatorName || closedByInput || (isEn ? 'Clinic Staff' : 'طاقم العيادة')}</span>
                          </div>
                          <span className="text-[9px] bg-indigo-50 text-indigo-700 font-extrabold px-2 py-0.5 rounded-md">{isEn ? 'Active Account' : 'حساب نشط'}</span>
                        </div>
                        <input
                          type="hidden"
                          value={operatorName || closedByInput || (isEn ? 'Clinic Staff' : 'طاقم العيادة')}
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">{isEn ? 'Discrepancy / Closing Notes (Optional)' : 'ملاحظات العجز أو الزيادة (إن وجدت)'}</label>
                        <textarea
                          value={shiftNotes}
                          onChange={(e) => setShiftNotes(e.target.value)}
                          rows={2}
                          placeholder={isEn ? 'e.g. Spent 50 EGP on pharmacy supplies with receipt...' : 'مثال: تم صرف 50 ج.م لشراء مستلزمات نظافة من الصيدلية بموجب إيصال'}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs text-right resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handlePrintShift}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1 cursor-pointer border border-slate-200"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          {isEn ? 'Print Report' : 'طباعة التقرير'}
                        </button>
                        <button
                          type="button"
                          onClick={handleConfirmShiftClosure}
                          disabled={loading}
                          className="bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 text-[10px] font-bold py-2.5 rounded-xl transition shadow-sm flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {loading ? (isEn ? 'Closing...' : 'جاري الإغلاق...') : (isEn ? 'Close Shift & Drawer' : 'إنهاء الوردية والدرج')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* TAB 3: Shift History (سجل الإقفال التاريخي) */}
        {activeTab === 'shift_history' && (
          <div className="lg:col-span-12 space-y-4 animate-fade-in">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-800">{isEn ? 'Closed Shifts Historical Archive' : 'الأرشيف التاريخي لإغلاق الورديات واليومية'}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Displays all shifts manually closed by staff or doctors for review' : 'يعرض كافة الورديات والشيفتات التي تم إقفالها يدوياً بواسطة السكرتارية أو الأطباء للمراجعة'}</p>
              </div>

              {shiftHistory.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  <Archive className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                  <span className="text-xs font-bold">{isEn ? 'No closed shift history records found yet' : 'لا يوجد أي سجلات وردية مغلقة تاريخياً حتى الآن'}</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-150">
                          <th className="p-3 text-right">{isEn ? 'Shift Date' : 'تاريخ اليوم'}</th>
                          <th className="p-3 text-right">{isEn ? 'Saved At' : 'توقيت الحفظ'}</th>
                          <th className="p-3 text-center">{isEn ? 'Completed Appointments' : 'المواعيد المكتملة'}</th>
                          <th className="p-3 text-left">{isEn ? 'Cloud Expected' : 'المتوقع سحابياً'}</th>
                          <th className="p-3 text-left">{isEn ? 'Actual Cash' : 'الفعلي بالدرج'}</th>
                          <th className="p-3 text-left">{isEn ? 'Discrepancy' : 'الفارق (العجز/الزيادة)'}</th>
                          <th className="p-3 text-right">{isEn ? 'Closed By' : 'مغلق بواسطة'}</th>
                          <th className="p-3 text-center">{isEn ? 'Details' : 'تفاصيل'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shiftHistory.slice(0, shiftHistoryLimit).map((shift) => (
                          <tr key={shift.id} className="border-b border-slate-100 hover:bg-slate-50/40">
                            <td className="p-3 font-bold text-slate-800 font-mono">{shift.date}</td>
                            <td className="p-3 text-slate-500 font-mono">{new Date(shift.closedAt).toLocaleTimeString(isEn ? 'en-US' : 'ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })}</td>
                            <td className="p-3 text-center font-bold text-slate-700 font-mono">{shift.completedCount}</td>
                            <td className="p-3 text-left font-mono text-slate-600">{(shift.expectedCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                            <td className="p-3 text-left font-mono font-bold text-slate-800">{(shift.actualCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                            <td className={`p-3 text-left font-mono font-black ${
                              shift.discrepancy === 0 
                                ? 'text-emerald-600' 
                                : shift.discrepancy < 0 
                                  ? 'text-rose-600' 
                                  : 'text-indigo-600'
                            }`}>
                              {shift.discrepancy === 0 ? (isEn ? 'Exact Match' : 'مطابق') : `${shift.discrepancy > 0 ? '+' : ''}${(shift.discrepancy || 0).toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}`}
                            </td>
                            <td className="p-3 text-slate-600 font-bold">{shift.closedBy}</td>
                            <td className="p-3 text-center">
                              <button
                                type="button"
                                onClick={() => setSelectedHistoryShift(shift)}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1.5 rounded-lg transition text-[10px] flex items-center justify-center gap-1 mx-auto cursor-pointer"
                              >
                                <span>🔍</span> {isEn ? 'Shift Details' : 'تفاصيل الوردية'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {shiftHistory.length > shiftHistoryLimit && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="text-xs font-bold text-slate-500">
                        {isEn ? `Showing ${Math.min(shiftHistoryLimit, shiftHistory.length)} of ${shiftHistory.length} closed shifts` : <>يتم عرض <span className="font-mono font-black text-indigo-600">{Math.min(shiftHistoryLimit, shiftHistory.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{shiftHistory.length}</span> وردية مغلقة</>}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShiftHistoryLimit(prev => prev + 5)}
                          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>{isEn ? 'Show 5 More (+5)' : 'عرض 5 إغلاقات إضافية (+5)'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShiftHistoryLimit(shiftHistory.length)}
                          className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                        >
                          {isEn ? `Show All (${shiftHistory.length})` : `عرض الكل (${shiftHistory.length})`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Detailed Historical Shift Modal */}
              {selectedHistoryShift && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex justify-center items-center p-4 z-50 animate-fade-in" dir="rtl">
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto relative text-right">
                    
                    {/* Header */}
                    <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                          <span>📊</span> تقرير الإغلاق المالي التفصيلي
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          ليوم العمل التشغيلي: <span className="font-bold text-slate-600 font-mono">{selectedHistoryShift.date}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedHistoryShift(null)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-right">
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 font-bold block">مغلق بواسطة:</span>
                        <span className="text-xs font-bold text-slate-800 mt-1 block">{selectedHistoryShift.closedBy}</span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 font-bold block">توقيت الإغلاق:</span>
                        <span className="text-[11px] font-bold text-slate-700 mt-1 block font-mono" dir="ltr">
                          {new Date(selectedHistoryShift.closedAt).toLocaleString('ar-EG', {
                            year: 'numeric',
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 col-span-2 sm:col-span-1">
                        <span className="text-[10px] text-slate-400 font-bold block">المواعيد المكتملة:</span>
                        <span className="text-xs font-bold text-slate-800 mt-1 block font-mono">{selectedHistoryShift.completedCount} موعد</span>
                      </div>
                    </div>

                    {/* Cash Drawer Reconciliation Section */}
                    <div className="bg-indigo-50/30 border border-indigo-100/80 p-4 rounded-2xl space-y-2.5 text-right">
                      <h4 className="text-xs font-extrabold text-indigo-950 border-b border-indigo-100/50 pb-1.5 flex items-center gap-1">
                        <span>💵</span> مطابقة الخزينة والنقد الفعلي (Cash Drawer)
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">عهدة افتتاح البداية (Start Cash):</span>
                          <span className="font-bold font-mono text-slate-700">{(selectedHistoryShift.startCash || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">كاش المقبوضات الجديد (Cash Revenue):</span>
                          <span className="font-bold font-mono text-slate-700">{(selectedHistoryShift.cashRevenue || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between text-rose-600">
                          <span>المصاريف المخصومة من الوردية (Expenses):</span>
                          <span className="font-bold font-mono">-{((selectedHistoryShift.expensesTotal !== undefined ? selectedHistoryShift.expensesTotal : selectedHistoryShift.expensesAmount) || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between border-t border-indigo-100/50 pt-2 font-bold">
                          <span className="text-indigo-900">الكاش المتوقع بالدرج (Expected):</span>
                          <span className="font-mono text-indigo-950">{(selectedHistoryShift.expectedCash || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between font-bold">
                          <span className="text-slate-800">الكاش الفعلي المسجل (Actual):</span>
                          <span className="font-mono text-slate-900 font-extrabold text-sm">{(selectedHistoryShift.actualCash || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between border-t border-dashed border-indigo-150 pt-2 font-black">
                          <span className="text-slate-600">فارق العجز أو الزيادة:</span>
                          <span className={`font-mono text-sm flex items-center gap-1 ${
                            (selectedHistoryShift.discrepancy || 0) === 0 
                              ? 'text-emerald-600' 
                              : (selectedHistoryShift.discrepancy || 0) < 0 
                                ? 'text-rose-600' 
                                : 'text-indigo-600'
                          }`}>
                            {(selectedHistoryShift.discrepancy || 0) === 0 ? (
                              'متطابق تماماً (0)'
                            ) : (
                              `${(selectedHistoryShift.discrepancy || 0) > 0 ? 'زيادة بقيمة: +' : 'عجز بقيمة: '}${(selectedHistoryShift.discrepancy || 0).toLocaleString()} ج.م`
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Electronic Income & Installments Breakdown */}
                    <div className="bg-slate-50 border border-slate-150 p-4 rounded-2xl space-y-2.5 text-right">
                      <h4 className="text-xs font-bold text-slate-800 border-b border-slate-200/60 pb-1.5 flex items-center gap-1">
                        <span>💳</span> الإيرادات إلكترونياً والأقساط المتبقية
                      </h4>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">مدفوعات فيزا (Visa):</span>
                          <span className="font-bold font-mono text-slate-800">{(selectedHistoryShift.cardRevenue || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">إنستاباي (Instapay):</span>
                          <span className="font-bold font-mono text-slate-800">{(selectedHistoryShift.instapayRevenue || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">محافظ ذكية (Wallets):</span>
                          <span className="font-bold font-mono text-slate-800">{(selectedHistoryShift.walletRevenue || 0).toLocaleString()} ج.م</span>
                        </div>
                        <div className="flex justify-between bg-amber-50/80 px-2 py-1 rounded-lg border border-amber-200/60 font-bold text-amber-900">
                          <span>الأقساط والمتبقي بالذمة لهذا اليوم:</span>
                          <span className="font-mono text-amber-700">
                            {(
                              selectedHistoryShift.remainingRevenue !== undefined
                                ? selectedHistoryShift.remainingRevenue
                                : appointments.filter(a => isAppointmentInShift(a, selectedHistoryShift) && a.status === 'completed').reduce((sum, app) => sum + (app.remainingAmount !== undefined ? app.remainingAmount : 0), 0)
                            ).toLocaleString()} ج.م
                          </span>
                        </div>
                        <div className="flex justify-between border-r-2 border-emerald-500 pr-2 font-bold col-span-2 mt-1">
                          <span className="text-emerald-700">إجمالي الإيرادات الكلي المحصل (دون خصم أي مصروفات):</span>
                          <span className="font-mono text-emerald-800">{(selectedHistoryShift.totalRevenue || 0).toLocaleString()} ج.م</span>
                        </div>
                      </div>
                    </div>

                    {/* Written Log / Notes */}
                    <div className="space-y-1 text-right">
                      <span className="text-[10px] text-slate-400 font-bold block">مذكرة اليومية وملاحظات التدقيق المكتوبة:</span>
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-[11px] leading-relaxed text-slate-600 font-medium whitespace-pre-wrap max-h-48 overflow-y-auto font-mono text-right" dir="rtl">
                        {selectedHistoryShift.notes || 'لم يتم تدوين أي ملاحظات إضافية لهذه الوردية.'}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          handlePrintHistoryShift(selectedHistoryShift);
                        }}
                        className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition text-xs cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        <Printer className="h-4 w-4" />
                        <span>طباعة تقرير الوردية الشامل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedHistoryShift(null)}
                        className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition text-xs cursor-pointer text-center"
                      >
                        إغلاق
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: Installments (الأقساط والمستحقات) */}
        {activeTab === 'installments' && (
          <div className="lg:col-span-12 space-y-4 animate-fade-in">

            {/* List and Search Panel */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 font-sans">{isEn ? 'Track Patient Outstanding Balances & Installments' : 'متابعة دفعات وأقساط المرضى المستحقة'}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Displays patients with remaining balances from completed clinical sessions' : 'يعرض المرضى الذين لديهم مبالغ متبقية على ذمة جلسات علاجية مكتملة لم تسدد بالكامل'}</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  {/* Period Filter */}
                  <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setInstallmentsFilterPeriod('today');
                        setInstallmentsLimit(5);
                      }}
                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${installmentsFilterPeriod === 'today' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                    >
                      {isEn ? 'Today' : 'اليوم'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInstallmentsFilterPeriod('month');
                        setInstallmentsLimit(5);
                      }}
                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${installmentsFilterPeriod === 'month' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                    >
                      {isEn ? 'This Month' : 'هذا الشهر'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInstallmentsFilterPeriod('all');
                        setInstallmentsLimit(5);
                      }}
                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${installmentsFilterPeriod === 'all' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                    >
                      {isEn ? 'All' : 'الكل'}
                    </button>
                  </div>

                  {/* Search bar */}
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder={isEn ? 'Search patient name or phone...' : 'ابحث باسم المريض أو رقم الهاتف...'}
                      value={installmentsSearch}
                      onChange={(e) => {
                        setInstallmentsSearch(e.target.value);
                        setInstallmentsLimit(5); // Reset limit on search
                      }}
                      className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                    />
                  </div>
                </div>
              </div>

              {filteredInstallmentPatients.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  <Receipt className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                  <span className="text-xs font-bold">{isEn ? 'No patients matching search criteria or having due installments' : 'لا يوجد أي مرضى يطابقون خيارات البحث أو لديهم أقساط مستحقة حالياً'}</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-150">
                          <th className="p-3 text-right">{isEn ? 'Patient' : 'المريض'}</th>
                          <th className="p-3 text-center">{isEn ? 'Total Cost' : 'إجمالي التكلفة'}</th>
                          <th className="p-3 text-center">{isEn ? 'Paid So Far' : 'المدفوع حتى الآن'}</th>
                          <th className="p-3 text-center">{isEn ? 'Due Balance' : 'المتبقي (القسط المستحق)'}</th>
                          <th className="p-3 text-right">{isEn ? 'Treatments / Installments' : 'تفاصيل العلاجات/الأقساط'}</th>
                          <th className="p-3 text-center">{isEn ? 'Actions' : 'الإجراءات'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleInstallmentPatients.map((patient, index) => {
                          return (
                            <tr key={index} className="border-b border-slate-100 hover:bg-slate-50/40">
                              <td className="p-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold">
                                    <User className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <span className="font-bold text-slate-800 block text-xs">{patient.patientName}</span>
                                    <span className="text-xs text-slate-400 font-mono block mt-0.5">{patient.patientPhone || (isEn ? 'No phone' : 'بدون هاتف')}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 text-center font-bold font-mono text-slate-600">
                                {patient.totalPrice.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                              </td>
                              <td className="p-3 text-center font-bold font-mono text-emerald-600">
                                {patient.totalPaid.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                              </td>
                              <td className="p-3 text-center">
                                <span className="px-2.5 py-1 rounded-xl bg-rose-50 text-rose-600 font-black font-mono">
                                  {patient.totalRemaining.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                </span>
                              </td>
                              <td className="p-3 text-right">
                                <div className="space-y-1 max-w-xs">
                                  {patient.appointments.slice(0, 2).map((app, appIdx) => (
                                    <div key={appIdx} className="text-xs text-slate-500 flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
                                      <span className="font-bold text-slate-700 truncate">{app.treatmentType || (isEn ? 'General Treatment' : 'علاج عام')}:</span>
                                      <span className="font-mono text-rose-500 font-semibold">{app.remainingAmount} {isEn ? 'EGP due' : 'ج.م متبقي'}</span>
                                      <span className="text-xs text-slate-400 font-mono">({app.date})</span>
                                    </div>
                                  ))}
                                  {patient.appointments.length > 2 && (
                                    <span className="text-xs text-indigo-500 font-bold block">+{patient.appointments.length - 2} {isEn ? 'more due payments' : 'دفعات أخرى مستحقة'}</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFinancialModalPatient({
                                      id: patient.patientId,
                                      name: patient.patientName,
                                      phone: patient.patientPhone
                                    });
                                  }}
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs transition shadow-xs cursor-pointer flex items-center gap-1 mx-auto"
                                >
                                  <Receipt className="h-3 w-3" />
                                  {isEn ? 'Pay / Statement' : 'سداد دفعة / كشف حساب'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Show More Pagination Bar */}
                  {filteredInstallmentPatients.length > installmentsLimit && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                      <span className="text-xs font-bold text-slate-500">
                        {isEn ? `Showing ${Math.min(installmentsLimit, filteredInstallmentPatients.length)} of ${filteredInstallmentPatients.length} patients with dues` : <>يتم عرض <span className="font-mono font-black text-indigo-600">{Math.min(installmentsLimit, filteredInstallmentPatients.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{filteredInstallmentPatients.length}</span> مريض لديه مستحقات</>}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setInstallmentsLimit(prev => prev + 5)}
                          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>{isEn ? 'Show More' : 'إظهار المزيد'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: Expenses (المصروفات التشغيلية) */}
        {activeTab === 'expenses' && (
          <div className="lg:col-span-12 space-y-6 animate-fade-in text-right">
            
            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-rose-500">{isEn ? 'Daily Expenses (Today)' : 'المصروفات اليومية (اليوم)'}</span>
                  <p className="text-xl font-black text-rose-600 font-mono mt-1">
                    {(() => {
                      const todayStr = (() => {
                        const d = new Date();
                        const pad = (n: number) => String(n).padStart(2, '0');
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                      })();
                      return expenses
                        .filter(e => e.date === todayStr)
                        .reduce((sum, e) => sum + e.amount, 0)
                        .toLocaleString();
                    })()} <span className="text-xs">{isEn ? 'EGP' : 'ج.م'}</span>
                  </p>
                </div>
                <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                  <TrendingDown className="h-6 w-6" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-amber-600">{isEn ? 'Monthly Expenses (This Month)' : 'المصروفات الشهرية (الشهر الحالي)'}</span>
                  <p className="text-xl font-black text-amber-600 font-mono mt-1">
                    {(() => {
                      const d = new Date();
                      const currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      return expenses
                        .filter(e => e.date.substring(0, 7) === currentMonth)
                        .reduce((sum, e) => sum + e.amount, 0)
                        .toLocaleString();
                    })()} <span className="text-xs">{isEn ? 'EGP' : 'ج.م'}</span>
                  </p>
                </div>
                <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                  <Scale className="h-6 w-6" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-indigo-500">{isEn ? 'Total Overall Expenses' : 'إجمالي المصروفات العام'}</span>
                  <p className="text-xl font-black text-indigo-600 font-mono mt-1">
                    {expenses.reduce((sum, e) => sum + e.amount, 0).toLocaleString()} <span className="text-xs">{isEn ? 'EGP' : 'ج.م'}</span>
                  </p>
                </div>
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                  <Receipt className="h-6 w-6" />
                </div>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-500">{isEn ? 'Highest Category' : 'الفئة الأكثر استهلاكاً'}</span>
                  <p className="text-xs font-black text-slate-800 truncate max-w-[150px] mt-1" title={(() => {
                    const categoryTotals: Record<string, number> = {};
                    expenses.forEach(e => {
                      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
                    });
                    let topCat = isEn ? 'None' : 'لا يوجد';
                    let maxVal = 0;
                    Object.entries(categoryTotals).forEach(([cat, val]) => {
                      if (val > maxVal) {
                        maxVal = val;
                        topCat = cat;
                      }
                    });
                    return topCat;
                  })()}>
                    {(() => {
                      const categoryTotals: Record<string, number> = {};
                      expenses.forEach(e => {
                        categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount;
                      });
                      let topCat = isEn ? 'None' : 'لا يوجد';
                      let maxVal = 0;
                      Object.entries(categoryTotals).forEach(([cat, val]) => {
                        if (val > maxVal) {
                          maxVal = val;
                          topCat = cat;
                        }
                      });
                      return topCat === 'لا يوجد' || topCat === 'None' ? (isEn ? 'None' : 'لا يوجد') : `${topCat} (${maxVal.toLocaleString()} ${isEn ? 'EGP' : 'ج.م'})`;
                    })()}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 text-slate-600 rounded-2xl">
                  <AlertCircle className="h-6 w-6" />
                </div>
              </div>
            </div>

            {/* Sub-Layout: Add form & Table list */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Form panel */}
              <div className="lg:col-span-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-3 flex items-center gap-2">
                  <Plus className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-black text-slate-800">{isEn ? 'Record New Expense' : 'تسجيل مصروف جديد'}</h3>
                </div>

                <form onSubmit={handleAddExpense} className="space-y-3.5 text-xs text-right">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Expense Description / Item *' : 'بيان المصروف / البند *'}</label>
                    <input
                      type="text"
                      required
                      placeholder={isEn ? 'e.g. Filling materials, Rent, Electricity bill...' : 'مثال: أدوات ومواد حشوات، إيجار، فاتورة كهرباء...'}
                      value={expenseTitle}
                      onChange={(e) => setExpenseTitle(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-right"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Amount (EGP) *' : 'القيمة المالية (ج.م) *'}</label>
                    <input
                      type="number"
                      required
                      min="0.1"
                      step="any"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-left"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Expense Category *' : 'تصنيف وفئة المصروف *'}</label>
                    <select
                      value={expenseCategory}
                      onChange={(e) => setExpenseCategory(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white text-right"
                    >
                      <option value="مستلزمات طبية">{isEn ? 'Medical Supplies & Clinic' : 'مستلزمات طبية وعيادة'}</option>
                      <option value="مصاريف معامل">{isEn ? 'Lab Expenses' : 'مصروفات معامل ومختبرات'}</option>
                      <option value="صيانة وإصلاحات">{isEn ? 'Maintenance & Repairs' : 'صيانة وإصلاحات الأجهزة'}</option>
                      <option value="رواتب وأجور">{isEn ? 'Salaries & Wages' : 'رواتب وأجور العاملين'}</option>
                      <option value="إيجار وفواتير">{isEn ? 'Rent & Utilities' : 'إيجار وفواتير (كهرباء/مياه/إنترنت)'}</option>
                      <option value="دعاية وتسويق">{isEn ? 'Marketing & Ads' : 'دعاية وتسويق وإعلانات'}</option>
                      <option value="مصاريف إدارية">{isEn ? 'Administrative Expenses' : 'مصروفات إدارية ونثرية'}</option>
                      <option value="أخرى">{isEn ? 'Other Categories' : 'تصنيفات أخرى'}</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Expense Date *' : 'تاريخ الصرف *'}</label>
                    <input
                      type="date"
                      required
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-left"
                    />
                  </div>

                  {/* Two professional custom checkbox cards for funding selection */}
                  <div className="space-y-2 border border-slate-200 bg-slate-50/50 p-3.5 rounded-2xl">
                    <label className="font-extrabold text-slate-700 block text-xs mb-2 flex items-center gap-1">
                      <span>⚙️</span> {isEn ? 'Funding Source Type (Required) *' : 'تحديد نوع ومصدر الصرف (إلزامي) *'}
                    </label>
                    <div className="space-y-2">
                      {/* Checkbox 1: خصم من الوردية */}
                      <div
                        onClick={() => {
                          setExpenseType('shift');
                          if (!expensePaymentMethod) {
                            setExpensePaymentMethod(expenseMethodsList[0] || 'كاش');
                          }
                        }}
                        className={`p-3 rounded-xl border transition-all duration-200 flex items-center justify-between cursor-pointer ${
                          expenseType === 'shift'
                            ? 'bg-indigo-50 border-indigo-500 text-indigo-900 font-bold'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">🏪</span>
                          <div className="text-right">
                            <span className="text-xs font-bold block">{isEn ? 'Deduct from Active Shift Float' : 'خصم من عهدة الوردية المفتوحة'}</span>
                            {activeShift && (
                              <span className="text-xs text-indigo-600 font-medium block">
                                {isEn ? 'Shift Cashier:' : 'وردية الكاشير:'} {activeShift.cashierName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0 ${
                          expenseType === 'shift'
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}>
                          {expenseType === 'shift' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                        </div>
                      </div>

                      {/* Checkbox 2: مال خاص */}
                      <div
                        onClick={() => setExpenseType('personal')}
                        className={`p-3 rounded-xl border transition-all duration-200 flex items-center justify-between cursor-pointer ${
                          expenseType === 'personal'
                            ? 'bg-amber-50 border-amber-500 text-amber-900 font-bold'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">💼</span>
                          <div className="text-right">
                            <span className="text-xs font-bold block">{isEn ? 'Personal Funds / Personal Capital' : 'مال خاص / تمويل شخصي'}</span>
                            <span className="text-xs text-slate-400 block">
                              {isEn ? 'Not deducted from drawer cash or shift balance' : 'لا يتم خصمه من رصيد الخزنة أو الوردية'}
                            </span>
                          </div>
                        </div>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0 ${
                          expenseType === 'personal'
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}>
                          {expenseType === 'personal' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                        </div>
                      </div>

                      {/* Dynamic Payment Method Selection for Open Shift Deductions */}
                      {expenseType === 'shift' && (
                        <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl space-y-1.5 animate-fade-in text-right">
                          <label className="block text-xs font-black text-indigo-950">
                            💳 {isEn ? 'Payment Method for Shift Deduction:' : 'طريقة الدفع للخصم من الوردية:'}
                          </label>
                          <select
                            value={expensePaymentMethod || expenseMethodsList[0] || 'كاش'}
                            onChange={(e) => setExpensePaymentMethod(e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-900 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-right"
                          >
                            {expenseMethodsList.map((method, idx) => (
                              <option key={idx} value={method}>{method}</option>
                            ))}
                          </select>
                          <p className="text-[10px] text-indigo-700 font-medium leading-relaxed mt-1">
                            💡 {isEn ? 'This expense will be deducted specifically from the chosen payment method and will not affect cash drawer if paid electronically.' : `يتم ربط هذا المصروف وخصمه حصرياً من طريقة الدفع المحددة (${expensePaymentMethod || expenseMethodsList[0] || 'كاش'})، وفي حال الصرف إلكترونياً لا يؤثر على الخزنة النقدية الكاش بالدرج.`}
                          </p>
                        </div>
                      )}
                    </div>
                    {!expenseType && (
                      <p className="text-xs text-rose-500 font-bold mt-2 text-center animate-pulse">
                        ⚠️ {isEn ? 'Please select funding source to record expense' : 'يجب تحديد مصدر الصرف لتسجيل البند'}
                      </p>
                    )}
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    {loading ? (isEn ? 'Saving...' : 'جاري الحفظ...') : (isEn ? 'Record Expense' : 'تسجيل وحفظ المصروف')}
                  </motion.button>
                </form>
              </div>

              {/* Table panel */}
              <div className="lg:col-span-8 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-sm font-black text-slate-800">{isEn ? 'Logged Expenses Register' : 'سجل المصروفات الموثقة'}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Browse all logged expense items and invoices with filtering' : 'استعرض كافة بنود الصرف والفواتير المسجلة مع إمكانية الفلترة'}</p>
                  </div>

                  {/* Filters block */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Period filters */}
                    <div className="bg-slate-100 p-1 rounded-xl flex gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setExpenseFilterPeriod('today');
                          setExpensesLimit(6);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${expenseFilterPeriod === 'today' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                      >
                        {isEn ? 'Today' : 'اليوم'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExpenseFilterPeriod('month');
                          setExpensesLimit(6);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${expenseFilterPeriod === 'month' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                      >
                        {isEn ? 'This Month' : 'هذا الشهر'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExpenseFilterPeriod('custom_day');
                          setExpensesLimit(6);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${expenseFilterPeriod === 'custom_day' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                      >
                        {isEn ? 'Specific Day' : 'يوم محدد'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExpenseFilterPeriod('custom_range');
                          setExpensesLimit(6);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${expenseFilterPeriod === 'custom_range' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                      >
                        {isEn ? 'Custom Range' : 'فترة مخصصة'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExpenseFilterPeriod('all');
                          setExpensesLimit(6);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${expenseFilterPeriod === 'all' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500'}`}
                      >
                        {isEn ? 'All' : 'الكل'}
                      </button>
                    </div>

                    {/* Category Filter */}
                    <select
                      value={expenseFilterCategory}
                      onChange={(e) => {
                        setExpenseFilterCategory(e.target.value);
                        setExpensesLimit(6);
                      }}
                      className="px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs font-bold bg-slate-50 text-right text-slate-800"
                    >
                      <option value="all">{isEn ? 'All Categories' : 'كل الفئات'}</option>
                      <option value="مستلزمات طبية">{isEn ? 'Medical Supplies & Clinic' : 'مستلزمات طبية وعيادة'}</option>
                      <option value="مصاريف معامل">{isEn ? 'Lab Expenses' : 'مصاريف معامل ومختبرات'}</option>
                      <option value="صيانة وإصلاحات">{isEn ? 'Maintenance & Repairs' : 'صيانة وإصلاحات'}</option>
                      <option value="رواتب وأجور">{isEn ? 'Salaries & Wages' : 'رواتب وأجور'}</option>
                      <option value="إيجار وفواتير">{isEn ? 'Rent & Utilities' : 'إيجار وفواتير'}</option>
                      <option value="دعاية وتسويق">{isEn ? 'Marketing & Ads' : 'دعاية وتسويق'}</option>
                      <option value="مصاريف إدارية">{isEn ? 'Administrative Expenses' : 'مصاريف إدارية'}</option>
                      <option value="أخرى">{isEn ? 'Other' : 'أخرى'}</option>
                    </select>
                  </div>
                </div>

                {/* Custom Date / Range selectors */}
                {(expenseFilterPeriod === 'custom_day' || expenseFilterPeriod === 'custom_range') && (
                  <div className="flex flex-wrap items-center justify-start gap-4 bg-slate-50 p-3.5 rounded-2xl border border-slate-150 text-xs font-bold text-right">
                    {expenseFilterPeriod === 'custom_day' && (
                      <div className="space-y-1">
                        <span className="text-xs text-slate-500 block">{isEn ? 'Select Specific Day:' : 'اختر اليوم المحدد:'}</span>
                        <input
                          type="date"
                          value={expenseFilterSpecificDate}
                          onChange={(e) => setExpenseFilterSpecificDate(e.target.value)}
                          className="px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none text-left bg-white text-slate-800"
                        />
                      </div>
                    )}
                    {expenseFilterPeriod === 'custom_range' && (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="space-y-1">
                          <span className="text-xs text-slate-500 block">{isEn ? 'From Date:' : 'من تاريخ:'}</span>
                          <input
                            type="date"
                            value={expenseFilterStartDate}
                            onChange={(e) => setExpenseFilterStartDate(e.target.value)}
                            className="px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none text-left bg-white text-slate-800"
                          />
                        </div>
                        <span className="text-slate-400 mt-4 font-normal">{isEn ? 'to' : 'إلى'}</span>
                        <div className="space-y-1">
                          <span className="text-xs text-slate-500 block">{isEn ? 'To Date:' : 'حتى تاريخ:'}</span>
                          <input
                            type="date"
                            value={expenseFilterEndDate}
                            onChange={(e) => setExpenseFilterEndDate(e.target.value)}
                            className="px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none text-left bg-white text-slate-800"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Search field */}
                <div className="relative">
                  <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder={isEn ? 'Search expense description or notes...' : 'ابحث في وصف المصروف أو الملاحظات...'}
                    value={expenseSearch}
                    onChange={(e) => {
                      setExpenseSearch(e.target.value);
                      setExpensesLimit(6);
                    }}
                    className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-right text-slate-800"
                  />
                </div>

                {/* Expenses Table */}
                {(() => {
                  const filtered = expenses.filter(e => {
                    const matchesSearch = e.title.toLowerCase().includes(expenseSearch.toLowerCase()) || 
                                          (e.notes && e.notes.toLowerCase().includes(expenseSearch.toLowerCase()));
                    
                    const matchesCategory = expenseFilterCategory === 'all' || e.category === expenseFilterCategory;
                    
                    let matchesPeriod = true;
                    if (expenseFilterPeriod === 'today') {
                      const todayStr = (() => {
                        const d = new Date();
                        const pad = (n: number) => String(n).padStart(2, '0');
                        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                      })();
                      matchesPeriod = e.date === todayStr;
                    } else if (expenseFilterPeriod === 'month') {
                      const currentMonth = (() => {
                        const d = new Date();
                        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      })();
                      matchesPeriod = e.date.substring(0, 7) === currentMonth;
                    } else if (expenseFilterPeriod === 'custom_day') {
                      matchesPeriod = e.date === expenseFilterSpecificDate;
                    } else if (expenseFilterPeriod === 'custom_range') {
                      const start = expenseFilterStartDate;
                      const end = expenseFilterEndDate;
                      if (start && end) {
                        matchesPeriod = e.date >= start && e.date <= end;
                      } else if (start) {
                        matchesPeriod = e.date >= start;
                      } else if (end) {
                        matchesPeriod = e.date <= end;
                      }
                    }
                    
                    return matchesSearch && matchesCategory && matchesPeriod;
                  });

                  const filteredTotal = filtered.reduce((sum, e) => sum + e.amount, 0);

                  return (
                    <div className="space-y-4">
                      {/* Show active filter total */}
                      <div className="bg-slate-50/80 px-4 py-2.5 rounded-2xl border border-slate-100 flex items-center justify-between text-xs font-bold text-slate-700">
                        <span>{isEn ? 'Total Filtered Expenses:' : 'إجمالي المصروفات المفلترة:'}</span>
                        <span className="font-mono text-rose-600 font-black text-sm">{filteredTotal.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                      </div>

                      {filtered.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <TrendingDown className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-xs font-bold text-slate-500">{isEn ? 'No expense records found matching selected filters' : 'لا توجد مصروفات مسجلة تطابق الفلاتر المحددة'}</p>
                        </div>
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-2xl border border-slate-100">
                            <table className="w-full text-right border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-50 text-slate-600 border-b border-slate-100 font-bold">
                                  <th className="p-3">{isEn ? 'Date' : 'التاريخ'}</th>
                                  <th className="p-3">{isEn ? 'Description' : 'بيان المصروف'}</th>
                                  <th className="p-3 text-center">{isEn ? 'Category' : 'الفئة'}</th>
                                  <th className="p-3 text-left">{isEn ? 'Amount' : 'القيمة المالية'}</th>
                                  <th className="p-3">{isEn ? 'Source / Notes' : 'ملاحظات'}</th>
                                  <th className="p-3 text-center">{isEn ? 'Actions' : 'الإجراءات'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filtered.slice(0, expensesLimit).map((item, idx) => (
                                  <tr key={item.id || idx} className="hover:bg-slate-50/50 border-b border-slate-100 transition duration-150">
                                    <td className="p-3 font-mono font-bold text-slate-500">{item.date}</td>
                                    <td className="p-3 font-black text-slate-800">{item.title}</td>
                                    <td className="p-3 text-center">
                                      <span className={`px-2.5 py-1 rounded-full font-bold text-xs ${
                                        item.category === 'مستلزمات طبية' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                        item.category === 'مصاريف معامل' ? 'bg-pink-50 text-pink-700 border border-pink-100' :
                                        item.category === 'رواتب وأجور' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' :
                                        item.category === 'إيجار وفواتير' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                                        item.category === 'صيانة وإصلاحات' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                        item.category === 'دعاية وتسويق' ? 'bg-sky-50 text-sky-700 border border-sky-100' :
                                        'bg-slate-100 text-slate-700 border border-slate-200'
                                      }`}>
                                        {item.category}
                                      </span>
                                    </td>
                                    <td className={`p-3 text-left font-black font-mono ${item.amount < 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                      {item.amount.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                    </td>
                                    <td className="p-3">
                                      <div className="flex flex-col gap-1 text-right">
                                        {item.type === 'shift' ? (
                                          <div className="flex flex-col gap-1">
                                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-extrabold text-xs w-fit border border-indigo-100">
                                              <span>🏪</span> {isEn ? 'Shift Deduction' : 'خصم من الوردية'}
                                            </span>
                                            {item.paymentMethod && (
                                              <span className="inline-flex items-center gap-1 bg-teal-50 text-teal-700 px-2.5 py-0.5 rounded-md font-black text-xs w-fit border border-teal-150">
                                                💳 {item.paymentMethod}
                                              </span>
                                            )}
                                          </div>
                                        ) : item.type === 'personal' ? (
                                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md font-extrabold text-xs w-fit border border-amber-100">
                                            <span>💼</span> {isEn ? 'Personal Funds' : 'مال خاص'}
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-600 px-2 py-0.5 rounded-md font-bold text-xs w-fit border border-slate-200">
                                            {item.notes || (isEn ? 'Not specified' : 'غير محدد')}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="p-3 text-center">
                                      {!isStaff && (
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteExpense(item)}
                                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                          title={isEn ? 'Delete Expense' : 'حذف المصروف'}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {filtered.length > expensesLimit && (
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                              <span className="text-xs font-bold text-slate-500">
                                {isEn ? `Showing ${Math.min(expensesLimit, filtered.length)} of ${filtered.length} expense items` : <>يتم عرض <span className="font-mono font-black text-indigo-600">{Math.min(expensesLimit, filtered.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{filtered.length}</span> حركة مصروف</>}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setExpensesLimit(prev => prev + 5)}
                                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  <span>{isEn ? 'Show 5 More (+5)' : 'عرض 5 مصروفات إضافية (+5)'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setExpensesLimit(filtered.length)}
                                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                                >
                                  {isEn ? `Show All (${filtered.length})` : `عرض الكل (${filtered.length})`}
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>

            </div>
          </div>
        )}

        {/* TAB 5: Revenues (تقارير وتحليلات الإيرادات) */}
        {activeTab === 'revenues' && (
          <div className="lg:col-span-12 space-y-6 animate-fade-in text-right">
            
            {/* Filter and Period Selector Card */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-slate-800">{isEn ? 'Revenue Reports & Analytics' : 'تقارير وتحليلات الإيرادات'}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Track income, cash flow, and receipt distribution by collection channels and period' : 'تتبع المداخيل، تدفقات السيولة وتوزيع المقبوضات حسب قنوات التحصيل والوقت'}</p>
                </div>
                
                {/* Horizontal Filter Selector */}
                <div className="flex bg-slate-100 p-1 rounded-xl text-xs gap-1 self-start md:self-auto">
                  <button
                    type="button"
                    onClick={() => { setRevenueFilterMode('daily'); setRevenuesLimit(10); }}
                    className={`py-1.5 px-3 rounded-lg font-bold transition ${
                      revenueFilterMode === 'daily'
                        ? 'bg-white text-slate-800 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    📅 {isEn ? 'Daily' : 'يومي'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRevenueFilterMode('weekly'); setRevenuesLimit(10); }}
                    className={`py-1.5 px-3 rounded-lg font-bold transition ${
                      revenueFilterMode === 'weekly'
                        ? 'bg-white text-slate-800 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    📊 {isEn ? 'Weekly' : 'أسبوعي'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRevenueFilterMode('monthly'); setRevenuesLimit(10); }}
                    className={`py-1.5 px-3 rounded-lg font-bold transition ${
                      revenueFilterMode === 'monthly'
                        ? 'bg-white text-slate-800 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    📆 {isEn ? 'Monthly' : 'شهري'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRevenueFilterMode('custom'); setRevenuesLimit(10); }}
                    className={`py-1.5 px-3 rounded-lg font-bold transition ${
                      revenueFilterMode === 'custom'
                        ? 'bg-white text-slate-800 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    🗓️ {isEn ? 'Custom Period' : 'فترة محددة'}
                  </button>
                </div>
              </div>

              {/* Conditional Inputs Row */}
              <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                {revenueFilterMode === 'daily' && (
                  <div className="md:col-span-1">
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Select Day:' : 'اختر اليوم:'}</label>
                    <input
                      type="date"
                      value={revenueDailyDate}
                      onChange={(e) => setRevenueDailyDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                )}

                {revenueFilterMode === 'weekly' && (
                  <div className="md:col-span-2 flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Select Day in Week:' : 'اختر يوماً في الأسبوع:'}</label>
                      <input
                        type="date"
                        value={revenueWeeklyDate}
                        onChange={(e) => setRevenueWeeklyDate(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div className="flex-1 bg-amber-50/50 border border-amber-200/60 rounded-2xl p-3 flex flex-col justify-center">
                      <span className="text-xs font-bold text-amber-800">{isEn ? 'Calculated Week Bounds:' : 'نطاق الأسبوع المحتسب:'}</span>
                      <span className="text-xs font-black text-amber-900 mt-1">
                        {isEn ? `From ${getWeekBounds(revenueWeeklyDate).startDateStr} to ${getWeekBounds(revenueWeeklyDate).endDateStr}` : <>من {formatArabicDate(getWeekBounds(revenueWeeklyDate).startDateStr)} <br /> إلى {formatArabicDate(getWeekBounds(revenueWeeklyDate).endDateStr)}</>}
                      </span>
                    </div>
                  </div>
                )}

                {revenueFilterMode === 'monthly' && (
                  <div className="md:col-span-2 flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Select Month:' : 'اختر الشهر:'}</label>
                      <input
                        type="month"
                        value={revenueMonthlyVal}
                        onChange={(e) => setRevenueMonthlyVal(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-amber-500 text-slate-800"
                      />
                    </div>
                    <div className="flex-1 bg-amber-50/50 border border-amber-200/60 rounded-2xl p-3 flex flex-col justify-center text-right">
                      <span className="text-xs font-bold text-amber-800">{isEn ? 'Selected Month:' : 'الشهر المحدد:'}</span>
                      <span className="text-xs font-black text-amber-900 mt-1">
                        {isEn ? revenueMonthlyVal : formatArabicMonth(revenueMonthlyVal)}
                      </span>
                    </div>
                  </div>
                )}

                {revenueFilterMode === 'custom' && (
                  <div className="md:col-span-3 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'From Date:' : 'من تاريخ:'}</label>
                      <input
                        type="date"
                        value={revenueStartDate}
                        onChange={(e) => setRevenueStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'To Date:' : 'إلى تاريخ:'}</label>
                      <input
                        type="date"
                        value={revenueEndDate}
                        onChange={(e) => setRevenueEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Toggle Row for Gross Revenue vs Net Profit */}
            <div className="flex flex-col md:flex-row bg-slate-50 border border-slate-200/60 p-4 rounded-3xl items-center justify-between gap-4">
              <div className="flex flex-col text-right">
                <span className="text-xs font-extrabold text-slate-800">📊 {isEn ? 'Choose Analytics Display Mode:' : 'اختر طريقة عرض التحليلات والتقارير المالية:'}</span>
                <p className="text-[11px] text-slate-500 mt-0.5">{isEn ? 'Toggle immediately between gross revenues and net profit after deducting expenses.' : 'يمكنك التنقل فوراً بين عرض إجمالي الإيرادات أو صافي الأرباح مخصوماً منها المصروفات.'}</p>
              </div>
              
              <div className="flex bg-white border border-slate-200/80 p-1 rounded-2xl gap-1.5 w-full md:w-auto shrink-0 justify-center">
                <button
                  type="button"
                  onClick={() => setRevenueReportType('gross')}
                  className={`flex-1 md:flex-initial py-2 px-4 rounded-xl font-black text-xs transition duration-200 flex items-center justify-center gap-1.5 cursor-pointer ${
                    revenueReportType === 'gross'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  📈 {isEn ? 'Gross Revenue (Pre-deduction)' : 'إجمالي الإيرادات (قبل الخصم)'}
                </button>
                <button
                  type="button"
                  onClick={() => setRevenueReportType('net')}
                  className={`flex-1 md:flex-initial py-2 px-4 rounded-xl font-black text-xs transition duration-200 flex items-center justify-center gap-1.5 cursor-pointer ${
                    revenueReportType === 'net'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  💰 {isEn ? 'Net Profit (After Expenses)' : 'صافي الأرباح (بعد خصم المصاريف)'}
                </button>
              </div>
            </div>

            {/* KPIs Block */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* KPI 1 - Dynamic Main Metric */}
              {revenueReportType === 'gross' ? (
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">💰 {isEn ? 'Total Period Gross Revenue' : 'إجمالي إيرادات الفترة'}</span>
                    <p className="text-2xl font-black text-indigo-600 font-mono mt-1">
                      {totalPeriodRevenue.toLocaleString()} <span className="text-xs font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                    </p>
                    <span className="text-xs text-slate-400 block mt-1">{isEn ? 'Shows total revenues without deducting expenses' : 'تظهر كل الإيرادات بدون خصم المصاريف'}</span>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-indigo-50 flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-indigo-600" />
                  </div>
                </div>
              ) : (
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">📉 {isEn ? 'Period Net Profit' : 'صافي الأرباح للفترة'}</span>
                    <p className="text-2xl font-black text-emerald-600 font-mono mt-1">
                      {(totalPeriodRevenue - totalPeriodExpenses).toLocaleString()} <span className="text-xs font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                    </p>
                    <span className="text-xs text-slate-400 block mt-1">{isEn ? 'Full period expenses have been deducted' : 'تم خصم المصروفات الكلية للفترة بالكامل'}</span>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-emerald-600" />
                  </div>
                </div>
              )}

              {/* KPI 2 - Period Expenses */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-rose-500">💸 {isEn ? 'Total Period Expenses' : 'إجمالي المصروفات للفترة'}</span>
                  <p className="text-2xl font-black text-rose-600 font-mono mt-1">
                    {totalPeriodExpenses.toLocaleString()} <span className="text-xs font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                  </p>
                  <span className="text-xs text-slate-400 block mt-1">{isEn ? 'Total outgoing expenses during the period' : 'إجمالي كافة المصاريف الخارجة خلال الفترة'}</span>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-rose-50 flex items-center justify-center">
                  <TrendingDown className="h-6 w-6 text-rose-600" />
                </div>
              </div>

              {/* KPI 3 - Visits Count */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-amber-500">👥 {isEn ? 'Paid Appointments / Visits' : 'عدد الحجوزات/الزيارات المسددة'}</span>
                  <p className="text-2xl font-black text-amber-600 font-mono mt-1">
                    {filteredRevenueAppointments.length} <span className="text-xs font-bold">{isEn ? 'Visits' : 'زيارة'}</span>
                  </p>
                  <span className="text-xs text-slate-400 block mt-1">{isEn ? 'Total completed appointments in period' : 'إجمالي الحجوزات المكتملة بالفترة'}</span>
                </div>
                <div className="h-12 w-12 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-amber-600" />
                </div>
              </div>
            </div>

            {/* Payment Methods share and charts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Payment Methods Share Card */}
              <div className="lg:col-span-5 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                <h3 className="text-sm font-black text-slate-800 mb-1">
                  {revenueReportType === 'gross' 
                    ? (isEn ? '💳 Collection Channels & Payment Methods' : '💳 قنوات التحصيل وطرق الدفع')
                    : (isEn ? '💳 Net Profit by Payment Channel' : '💳 صافي الأرباح حسب قنوات التحصيل')}
                </h3>
                <p className="text-xs text-slate-400 mb-4">
                  {revenueReportType === 'gross' 
                    ? (isEn ? 'Analysis of collected amounts distributed across clinic payment methods' : 'تحليل المبالغ المحصلة موزعة على طرق الدفع النشطة بالعيادة')
                    : (isEn ? 'Analysis of net amounts (Revenue minus Expenses) per payment channel' : 'تحليل صافي المبالغ (الإيرادات مخصوماً منها المصاريف) لكل قناة دفع')}
                </p>
                
                <div className="space-y-4 flex-1 flex flex-col justify-center">
                  {activeMethodsList.map((method, idx) => {
                    const revAmt = revenueMethodBreakdown[method] || 0;
                    const expAmt = expenseMethodBreakdown[method] || 0;
                    const amt = revenueReportType === 'gross' ? revAmt : revAmt - expAmt;
                    
                    const totalToUse = revenueReportType === 'gross' 
                      ? totalPeriodRevenue 
                      : (totalPeriodRevenue - totalPeriodExpenses);
                    
                    const pct = totalToUse > 0 ? (amt / totalToUse) * 100 : 0;
                    
                    let colorClass = 'bg-emerald-500';
                    let textClass = 'text-emerald-700';
                    let bgLight = 'bg-emerald-50/50';
                    
                    if (method === 'فيزا' || method === 'card') {
                      colorClass = 'bg-blue-500';
                      textClass = 'text-blue-700';
                      bgLight = 'bg-blue-50/50';
                    } else if (method === 'إنستاباي' || method === 'instapay') {
                      colorClass = 'bg-indigo-500';
                      textClass = 'text-indigo-700';
                      bgLight = 'bg-indigo-50/50';
                    } else if (method === 'محفظة' || method === 'wallet') {
                      colorClass = 'bg-amber-500';
                      textClass = 'text-amber-700';
                      bgLight = 'bg-amber-50/50';
                    } else if (idx > 3) {
                      colorClass = 'bg-purple-500';
                      textClass = 'text-purple-700';
                      bgLight = 'bg-purple-50/50';
                    }

                    const displayMethod = isEn ? (
                      method === 'كاش' ? 'Cash' :
                      method === 'فيزا' ? 'Visa / Card' :
                      method === 'إنستاباي' ? 'InstaPay' :
                      method === 'محفظة' ? 'E-Wallet' : method
                    ) : method;

                    return (
                      <div key={idx} className={`p-3 rounded-2xl border border-slate-100 ${bgLight}`}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-bold text-slate-700 flex items-center gap-1">
                            {method === 'كاش' ? '💵' : method === 'فيزا' ? '💳' : method === 'إنستاباي' ? '⚡' : method === 'محفظة' ? '📱' : '💼'}
                            {displayMethod}
                          </span>
                          <span className="font-mono font-extrabold text-slate-800">
                            {amt.toLocaleString()} {isEn ? 'EGP' : 'ج.م'} {pct > 0 ? `(${pct.toFixed(1)}%)` : ''}
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500 mb-2 gap-1" dir={isEn ? 'ltr' : 'rtl'}>
                          <span>{isEn ? 'In:' : 'وارد:'} <span className="font-mono font-bold text-emerald-600">{revAmt.toLocaleString()}</span> {isEn ? 'EGP' : 'ج.م'}</span>
                          <span>{isEn ? 'Out:' : 'مصروف:'} <span className="font-mono font-bold text-rose-500">{expAmt.toLocaleString()}</span> {isEn ? 'EGP' : 'ج.م'}</span>
                          <span>{isEn ? 'Net:' : 'صافي:'} <span className="font-mono font-bold text-slate-800">{(revAmt - expAmt).toLocaleString()}</span> {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        {/* Progress Bar */}
                        <div className="w-full bg-slate-200/60 h-2 rounded-full overflow-hidden">
                          <div className={`h-full ${colorClass} rounded-full transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Detailed Transactions List */}
              <div className="lg:col-span-7 bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-black text-slate-800">📋 {isEn ? 'Detailed Receipt Register' : 'سجل المقبوضات التفصيلي'}</h3>
                  <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full font-bold text-slate-500">
                    {filteredRevenueAppointments.length} {isEn ? 'records' : 'حركة'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-4">{isEn ? 'All financial transactions received and confirmed during the selected period' : 'كافة الحركات المالية المستلمة والمؤكدة خلال الفترة المحددة'}</p>

                {filteredRevenueAppointments.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
                    <span className="text-2xl">🔍</span>
                    <p className="text-xs font-bold text-slate-400 mt-2">{isEn ? 'No revenues recorded during the selected period' : 'لا توجد أي إيرادات مسجلة خلال الفترة المحددة'}</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-between">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-right text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-slate-500 font-bold">
                            <th className="pb-2">{isEn ? 'Date' : 'التاريخ'}</th>
                            <th className="pb-2">{isEn ? 'Patient' : 'المريض'}</th>
                            <th className="pb-2">{isEn ? 'Treatment' : 'العلاج'}</th>
                            <th className="pb-2">{isEn ? 'Payment Method' : 'طريقة الدفع'}</th>
                            <th className="pb-2 text-left">{isEn ? 'Collected' : 'المحصل'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredRevenueAppointments.slice(0, revenuesLimit).map((app, idx) => {
                            const amt = app.paidAmount !== undefined ? app.paidAmount : app.price;
                            const method = formatPaymentMethod(app.paymentMethod);
                            return (
                              <tr key={idx} className="hover:bg-slate-50/50">
                                <td className="py-2.5 text-slate-500 font-mono text-xs">{app.date}</td>
                                <td className="py-2.5 font-bold text-slate-800">{app.patientName}</td>
                                <td className="py-2.5 text-slate-500 text-xs truncate max-w-[120px]">{app.treatmentType || (isEn ? 'Examination' : 'كشف واستشارة')}</td>
                                <td className="py-2.5">
                                  {method === 'فيزا' ? (
                                    <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 font-bold text-xs">{isEn ? 'Visa 💳' : 'فيزا 💳'}</span>
                                  ) : method === 'إنستاباي' ? (
                                    <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-bold text-xs">{isEn ? 'InstaPay ⚡' : 'إنستاباي ⚡'}</span>
                                  ) : method === 'محفظة' ? (
                                    <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-bold text-xs">{isEn ? 'Wallet 📱' : 'محفظة 📱'}</span>
                                  ) : method === 'كاش' ? (
                                    <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-bold text-xs">{isEn ? 'Cash 💵' : 'كاش 💵'}</span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded-md bg-slate-50 text-slate-700 font-bold text-xs">{method} 💼</span>
                                  )}
                                </td>
                                <td className="py-2.5 text-left font-bold text-slate-800 font-mono">{amt.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {filteredRevenueAppointments.length > revenuesLimit && (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200 mt-2">
                        <span className="text-xs font-bold text-slate-500">
                          {isEn ? `Showing ${Math.min(revenuesLimit, filteredRevenueAppointments.length)} of ${filteredRevenueAppointments.length} transactions` : <>يتم عرض <span className="font-mono font-black text-indigo-600">{Math.min(revenuesLimit, filteredRevenueAppointments.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{filteredRevenueAppointments.length}</span> حركة مالية</>}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRevenuesLimit(prev => prev + 5)}
                            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>{isEn ? 'Show 5 More (+5)' : 'عرض 5 حركات إضافية (+5)'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRevenuesLimit(filteredRevenueAppointments.length)}
                            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                          >
                            {isEn ? `Show All (${filteredRevenueAppointments.length})` : `عرض الكل (${filteredRevenueAppointments.length})`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

      </div>

      {financialModalPatient && (
        <PatientFinancialsModal
          isOpen={!!financialModalPatient}
          onClose={() => {
            setFinancialModalPatient(null);
            fetchAppointments();
          }}
          clinicId={clinic.id}
          patientId={financialModalPatient.id}
          patientName={financialModalPatient.name}
          patientPhone={financialModalPatient.phone}
          initialAppointmentId={financialModalPatient.appointmentId}
          autoShowPayment={true}
          paymentMethods={clinic.paymentMethods}
          activeShiftDate={activeShiftDate || selectedShiftDate || getEgyptTodayStr()}
          activeShiftId={activeShift?.id}
          activeShift={activeShift}
        />
      )}
    </div>
  );
}
