import { getClinicPaymentMethods, getPaymentReportMethods, paymentMethodLabel, paymentMethodForReport, paymentMethodMapAmount } from '../utils/paymentMethods';
import OfflineCommands from './OfflineCommands';
import LegacySettlement from './LegacySettlement';
import ReturnsLog from './ReturnsLog';
import { financeCommand } from '../dbClient';
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
  const [activeTab, setActiveTab] = useState<'shift_closure' | 'shift_history' | 'installments' | 'expenses' | 'revenues' | 'returns'>('shift_closure');
  
  const allowedFeatures = clinic.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];

  const isTabAllowed = (tabId: 'shift_closure' | 'shift_history' | 'revenues' | 'installments' | 'expenses' | 'returns') => {
    const map: Record<string, string> = {
      shift_closure: 'financials_daily_closing',
      shift_history: 'financials_closing_log',
      revenues: 'financials_reports',
      installments: 'financials_patients_installments',
      expenses: 'financials_expenses',
      returns: 'financials_reports'
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
    const tabsList: ('shift_closure' | 'shift_history' | 'revenues' | 'installments' | 'expenses' | 'returns')[] = [
      'shift_closure',
      'shift_history',
      'revenues',
      'installments',
      'expenses',
      'returns'
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
    // Financial reports load their own complete, fresh list; never replace it with a calendar week.
  }, [sharedAppointments]);

  // Expenses state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseSummary,setExpenseSummary]=useState<any>(null);
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
  const [financialModalAutoPay, setFinancialModalAutoPay] = useState<boolean>(true);
  
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
    return expenses.filter(e=>e.type==='shift'&&e.shiftId===currentShift.id);
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

  const [invoiceReceipts,setInvoiceReceipts]=useState<any[]>([]);
  const [financialReceipts,setFinancialReceipts] = useState<any[]>([]);
  useEffect(()=>{let live=true;if(printInvoiceData)financeCommand(clinic.id,{action:'view',scope:'patient',patientId:printInvoiceData.patientId,patientPhone:printInvoiceData.patientPhone,patientName:printInvoiceData.patientName}).then(result=>{if(live)setInvoiceReceipts(result.receipts||[]);}).catch(e=>setError(e.message));return()=>{live=false;};},[printInvoiceData?.id]);

  const financialView=React.useMemo(()=>{
    if(activeTab==='revenues'){
      if(revenueFilterMode==='daily')return {scope:'revenues',from:revenueDailyDate,to:revenueDailyDate};
      if(revenueFilterMode==='weekly'){const r=getWeekBounds(revenueWeeklyDate);return {scope:'revenues',from:r.startDateStr,to:r.endDateStr};}
      if(revenueFilterMode==='monthly')return {scope:'revenues',from:revenueMonthlyVal+'-01',to:revenueMonthlyVal+'-31'};
      return {scope:'revenues',from:revenueStartDate,to:revenueEndDate};
    }
    if(activeTab==='installments')return {scope:'installments',from:installmentsFilterPeriod==='today'?getTodayStr():installmentsFilterPeriod==='month'?getTodayMonthStr()+'-01':'',to:installmentsFilterPeriod==='today'?getTodayStr():installmentsFilterPeriod==='month'?getTodayMonthStr()+'-31':''};
    if(activeTab==='expenses'){
      let from='',to='';
      if(expenseFilterPeriod==='today')from=to=getTodayStr();
      if(expenseFilterPeriod==='month'){from=getTodayMonthStr()+'-01';to=getTodayMonthStr()+'-31';}
      if(expenseFilterPeriod==='custom_day')from=to=expenseFilterSpecificDate;
      if(expenseFilterPeriod==='custom_range'){from=expenseFilterStartDate;to=expenseFilterEndDate;}
      return {scope:'expenses',from,to};
    }
    if(activeTab==='shift_history'||activeTab==='returns')return {scope:'history'};
    return {scope:'shift',shiftId:currentShift.id,date:currentShift.date};
  },[activeTab,revenueFilterMode,revenueDailyDate,revenueWeeklyDate,revenueMonthlyVal,revenueStartDate,revenueEndDate,installmentsFilterPeriod,expenseFilterPeriod,expenseFilterSpecificDate,expenseFilterStartDate,expenseFilterEndDate,currentShift.id,currentShift.date]);
  const financialViewRef=React.useRef(financialView);financialViewRef.current=financialView;
  const viewRequestSerial=React.useRef(0);
  const fetchAppointments = async (silent = false) => {
    const serial=++viewRequestSerial.current;
    if(!silent)setLoading(true);setError(null);
    try {
      const ledger=await financeCommand(clinic.id,{action:'view',...financialViewRef.current});
      if(serial!==viewRequestSerial.current)return;
      setFinancialReceipts(ledger.receipts||[]);setExpenses(ledger.expenses||[]);setExpenseSummary(ledger.expenseSummary||null);
      const snap=(ledger.appointments||[]).map((data:any)=>({id:data.id,data:()=>data}));
      const list: Appointment[] = [];
      snap?.forEach((docSnap: any) => {
        const data = docSnap.data();
        list.push({
          ...data,
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
          remainingRevenue: data.remainingRevenue,
          snapshot: data.snapshot,
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

  const fetchExpenses=async()=>{await fetchAppointments(true);};

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
      const activeMethods = getClinicPaymentMethods(clinic.paymentMethods);
      const resolvedPaymentMethod = expenseType === 'shift' ? (expensePaymentMethod || activeMethods[0] || '') : null;

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
      ...(financialView.scope==='history'?[fetchShiftHistory()]:[])
    ]);

    let syncRefreshTimer:ReturnType<typeof setTimeout>|undefined;
    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};
      
      const relevantTables = ['shifts', 'appointments', 'records', 'patients', 'closings', 'billing', 'expenses'];
      if (!table || relevantTables.includes(table)) {
        console.log(`[ClinicFinancials] Instant financial/shift sync triggered for table: ${table}`);
        viewRequestSerial.current++;
        if(syncRefreshTimer)clearTimeout(syncRefreshTimer);
        syncRefreshTimer=setTimeout(()=>{void Promise.allSettled([...(financialViewRef.current.scope==='history'?[fetchShiftHistory()]:[]),fetchAppointments(true)]);},80);
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => {if(syncRefreshTimer)clearTimeout(syncRefreshTimer);viewRequestSerial.current++;window.removeEventListener('clinic-sync', handleSync);};
  }, [clinic.id,financialView]);

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
  const handleRecordPaymentSubmit=async(e:React.FormEvent)=>{e.preventDefault();if(!selectedApp)return;setLoading(true);try{await financeCommand(clinic.id,{action:'collect',appointmentId:selectedApp.id,amount:Number(paymentAmount),paymentMethod:selectedApp.paymentMethod||getClinicPaymentMethods(clinic.paymentMethods)[0]||'',reason:paymentNotes});await fetchAppointments();setIsRecordingPayment(false);}catch(e:any){setError(e.message);}finally{setLoading(false);}};

  // Open a new cashier shift (بدء وردية كاشير جديدة)
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();setLoading(true);setError(null);
    try { await financeCommand(clinic.id,{action:'open',startCash:Number(startCashInput||0),date:selectedShiftDate,notes:openingNotesInput});setStartCashInput('');setOpeningNotesInput('');await onRefreshActiveShift?.();setShiftSuccess(isEn?'Shift opened':'تم فتح الوردية');}
    catch(e:any){setError(e.message);}finally{setLoading(false);}
  };
  const handleConfirmShiftClosure = async () => {
    if(!activeShift)return;
    if(!actualCashInput.trim()) {dialogs.alert(isEn?'Enter counted drawer cash':'أدخل النقد الفعلي بعد عد الدرج',{severity:'warning'});return;}
    const yes=await dialogs.confirm(isEn?'Close this shift using server-confirmed receipts and your counted cash?':'إقفال الوردية بالإيصالات المؤكدة على السيرفر والعد الفعلي للدرج؟',{severity:'warning'});if(!yes)return;
    setLoading(true);setError(null);
    try {await financeCommand(clinic.id,{action:'close',shiftId:activeShift.id,actualCash:Number(actualCashInput),notes:shiftNotes});setActualCashInput('');await onRefreshActiveShift?.();await fetchShiftHistory();setShiftSuccess(isEn?'Shift closed and snapshot saved':'تم إقفال الوردية وحفظ لقطة ثابتة');}
    catch(e:any){setError(e.message);}finally{setLoading(false);}
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
  const activeMethodsList = React.useMemo(() => getClinicPaymentMethods(clinic.paymentMethods), [clinic.paymentMethods]);

  // Expense Payment Methods list
  const expenseMethodsList = React.useMemo(() => {
    return activeMethodsList;
  }, [activeMethodsList]);

  useEffect(() => {
    if (!expenseMethodsList.includes(expensePaymentMethod)) setExpensePaymentMethod(expenseMethodsList[0] || '');
  }, [expenseMethodsList]);

  const formatPaymentMethod = React.useCallback((method?: string): string => {
    return paymentMethodForReport(method,clinic.paymentMethods);
  }, [clinic.paymentMethods]);

  // Revenues filter calculations
  const filteredPeriodReceipts = React.useMemo(()=>financialReceipts.filter(r=>{
    const date=r.collectionDate||r.date||'';
    if(revenueFilterMode==='daily')return date===revenueDailyDate;
    if(revenueFilterMode==='weekly'){const {startDateStr,endDateStr}=getWeekBounds(revenueWeeklyDate);return date>=startDateStr&&date<=endDateStr;}
    if(revenueFilterMode==='monthly')return date.startsWith(revenueMonthlyVal);
    return (!revenueStartDate||date>=revenueStartDate)&&(!revenueEndDate||date<=revenueEndDate);
  }),[financialReceipts,revenueFilterMode,revenueDailyDate,revenueWeeklyDate,revenueMonthlyVal,revenueStartDate,revenueEndDate]);
  const filteredRevenueAppointments=filteredPeriodReceipts.map(r=>({id:r.id,patientName:r.patientName,price:r.amount,paidAmount:r.kind==='refund'?-r.amount:r.amount,paymentMethod:r.paymentMethod,treatmentType:(r.kind==='refund'?(isEn?'Refund: ':'استرداد: '):'')+(r.receiptNumber||r.id),time:r.createdAt?new Date(r.createdAt).toLocaleTimeString('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'',date:r.collectionDate||r.date}));
  const revenueMethodBreakdown=React.useMemo(()=>{
    const out:Record<string,number>={};activeMethodsList.forEach(m=>out[m]=0);
    for(const r of filteredPeriodReceipts){const m=paymentMethodForReport(r.paymentMethod,clinic.paymentMethods);if(m==='نقاط الولاء')continue;out[m]=(out[m]||0)+(r.kind==='refund'?-1:1)*Number(r.amount||0);}
    return out;
  },[filteredPeriodReceipts,activeMethodsList]);

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
      const channel = paymentMethodForReport(exp.paymentMethod,clinic.paymentMethods);
      if (Number(exp.amount)) breakdown[channel] = (breakdown[channel] || 0) + exp.amount;
    });

    return breakdown;
  }, [expenseMethodsList, expenses, revenueFilterMode, revenueDailyDate, revenueWeeklyDate, revenueMonthlyVal, revenueStartDate, revenueEndDate, normalizePaymentMethod]);

  // Compute revenues by method for active shift (filtering payments by shiftId or shift time window)
  const dynamicRevenues=React.useMemo(()=>{
    const out:Record<string,number>={};activeMethodsList.forEach(m=>out[m]=0);
    for(const r of financialReceipts){if(r.shiftId!==currentShift.id)continue;const m=paymentMethodForReport(r.paymentMethod,clinic.paymentMethods);if(m==='نقاط الولاء')continue;out[m]=(out[m]||0)+(r.kind==='refund'?-1:1)*Number(r.amount||0);}
    return out;
  },[financialReceipts,currentShift,activeMethodsList]);

  // Compute shift expenses by method for active shift day
  const dynamicExpenses = React.useMemo(() => {
    const expenseMap: Record<string, number> = {};
    expenseMethodsList.forEach(m => {
      expenseMap[m] = 0;
    });

    activeShiftExpenses.forEach(e => {
      const channel = paymentMethodForReport(e.paymentMethod,clinic.paymentMethods);
      if (Number(e.amount)) expenseMap[channel] = (expenseMap[channel] || 0) + e.amount;
    });

    return expenseMap;
  }, [expenseMethodsList, activeShiftExpenses, normalizePaymentMethod]);

  const shiftReportMethods = getPaymentReportMethods(clinic.paymentMethods, dynamicRevenues, dynamicExpenses);
  const periodReportMethods = getPaymentReportMethods(clinic.paymentMethods, revenueMethodBreakdown, expenseMethodBreakdown);

  // Individual payment transactions collected in the active shift
  const activeShiftPaymentRecords=React.useMemo(()=>financialReceipts.filter(r=>r.shiftId===currentShift.id).map(r=>({id:r.id,app:appointments.find(a=>a.id===r.appointmentId)||{patientName:r.patientName,price:0,remainingAmount:0},amount:r.kind==='refund'?-r.amount:r.amount,paymentMethod:r.paymentMethod,date:r.collectionDate||r.date,time:r.createdAt?new Date(r.createdAt).toLocaleTimeString('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'',notes:r.receiptNumber||r.notes})),[financialReceipts,currentShift,appointments]);

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

  const handleQuickNurseCollect=async(app:Appointment)=>{setLoading(true);try{await financeCommand(clinic.id,{action:'collect',appointmentId:app.id,amount:Number(app.remainingAmount||0),paymentMethod:app.paymentMethod||getClinicPaymentMethods(clinic.paymentMethods)[0]||''});await fetchAppointments();}catch(e:any){setError(e.message);}finally{setLoading(false);}};

  // Print Invoice trigger
  const handlePrintInvoice = (app: Appointment) => {
    setPrintInvoiceData(app);
  };

  // Print Shift trigger (Active Shift)
  const handlePrintShift = () => {
    const startCash = activeShift ? (Number(activeShift.startCash) || 0) : 0;
    const cashExpenses = dynamicExpenses['كاش'] || 0;
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
      activeMethodsList: shiftReportMethods
    });
  };

  useEffect(()=>{let live=true;if(selectedHistoryShift&&!selectedHistoryShift.snapshot)financeCommand(clinic.id,{action:'view',scope:'legacy_history'}).then(result=>{if(live){setAppointments(result.appointments||[]);setExpenses(result.expenses||[]);}}).catch(e=>setError(e.message));return()=>{live=false;};},[selectedHistoryShift?.id]);

  // Print Shift trigger (Historical Archive Shift)
  const handlePrintHistoryShift = async (shift: any) => {
    if(shift.snapshot) {
      const x=shift.snapshot;
      setPrintShiftData({...x,date:shift.date,openedAt:shift.openedAt,closedAt:shift.closedAt,cashierName:shift.cashierName,closedBy:shift.closedBy,startCash:shift.startCash,actual:shift.actualCash,expected:shift.expectedCash,discrepancy:shift.discrepancy,notes:shift.notes,revenuesMap:x.dynamicRevenues,expensesMap:x.dynamicExpenses,activeMethodsList:getPaymentReportMethods(clinic.paymentMethods,x.dynamicRevenues,x.dynamicExpenses),expensesList:x.expenses,paymentRecords:x.receipts.map((r:any)=>({id:r.id,app:x.appointments.find((a:any)=>a.id===r.appointmentId)||{patientName:r.patientName,price:0,remainingAmount:0},amount:r.kind==='refund'?-r.amount:r.amount,paymentMethod:r.paymentMethod,time:new Date(r.createdAt||r.date).toLocaleTimeString('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}),notes:r.notes}))});
      return;
    }
    let appointments:Appointment[]=[],expenses:Expense[]=[];
    try {const legacy=await financeCommand(clinic.id,{action:'view',scope:'legacy_history'});appointments=legacy.appointments||[];expenses=legacy.expenses||[];}catch(e:any){setError(e.message);return;}
    dialogs.alert(isEn?'Legacy archive has no immutable snapshot. Details may reflect later edits.':'هذه وردية قديمة بلا لقطة إقفال ثابتة. تفاصيلها قد تعكس تعديلات لاحقة.',{severity:'warning'});

    const revMap = shift.dynamicRevenues || {
      'كاش': shift.cashRevenue || 0,
      'فيزا': shift.cardRevenue || 0,
      'إنستاباي': shift.instapayRevenue || 0,
      'محفظة': shift.walletRevenue || 0
    };
    const expMap = shift.dynamicExpenses || {
      'كاش': shift.cashExpenses !== undefined ? shift.cashExpenses : (shift.expensesTotal || 0)
    };
    const activeMethods = getPaymentReportMethods(clinic.paymentMethods, revMap, expMap);

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
            paymentMethod: paymentMethodForReport(pay.paymentMethod || app.paymentMethod,clinic.paymentMethods),
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
    const cashExp = shift.cashExpenses !== undefined ? shift.cashExpenses : (expMap['كاش'] || 0);
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
        language={isEn ? 'en' : 'ar'}
        isOpen={!!printInvoiceData}
        onClose={() => setPrintInvoiceData(null)}
        title={isEn ? 'Treatment & Financial Invoice' : 'فاتورة علاج ومتابعة مالية'}
      >
        {printInvoiceData && (
          <div className="bg-white text-slate-900 leading-relaxed text-start" dir={isEn ? 'ltr' : 'rtl'}>
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
              <div>
                <h1 className="text-2xl font-black text-slate-900">{(isEn ? clinic.nameEn : clinic.nameAr) || clinic.name}</h1>
                <p className="text-sm text-slate-600 mt-1">{(isEn ? clinic.doctorSpecialtyEn : clinic.doctorSpecialtyAr) || (isEn ? 'Dentistry, orthodontics and implants' : 'طب وجراحة الأسنان وعلاجات التقويم والزراعة')}</p>
                <p className="text-xs text-slate-500 mt-0.5">{isEn ? 'Doctor:' : 'الدكتور:'} {(isEn ? clinic.doctorNameEn || clinic.doctorName : clinic.doctorName) || (isEn ? 'Specialist' : 'طبيب متخصص')}</p>
                {clinic.doctorPhone && <p className="text-xs text-slate-500">{isEn ? 'Phone:' : 'هاتف:'} {clinic.doctorPhone}{clinic.additionalPhones && clinic.additionalPhones.length > 0 ? ` - ${clinic.additionalPhones.filter(Boolean).join(' - ')}` : ''}</p>}
                {clinic.address && <p className="text-xs text-slate-500">{isEn ? 'Address:' : 'العنوان:'} {clinic.address}</p>}
              </div>
              {clinic.logoUrl && clinic.logoUrl.trim() !== '' ? (
                <img src={clinic.logoUrl} alt="Logo" className="w-32 h-24 object-contain object-left shrink-0" />
              ) : (
                <div className="w-16 h-16 bg-slate-100 rounded-xl flex items-center justify-center border-2 border-slate-300 font-bold text-slate-400">CMS</div>
              )}
            </div>

            <div className="text-center my-6">
              <h2 className="text-xl font-black tracking-wide border-y border-slate-300 py-2.5">{isEn ? 'Treatment & Financial Invoice' : 'فاتورة علاج ومتابعة مالية'}</h2>
              <p className="text-xs text-slate-400 mt-1">{isEn ? 'Invoice printed:' : 'تاريخ طباعة الفاتورة:'} {new Date().toLocaleString(isEn ? 'en-GB' : 'ar-EG')}</p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-y-3 gap-x-6 text-sm mb-6">
              <div>
                <span className="font-bold text-slate-600">{isEn ? 'Patient name:' : 'اسم المريض:'}</span>{' '}
                <span className="font-black text-slate-800">{printInvoiceData.patientName}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600">{isEn ? 'Phone number:' : 'رقم الهاتف:'}</span>{' '}
                <span className="font-mono text-slate-800">{printInvoiceData.patientPhone || (isEn ? 'Not recorded' : 'غير مسجل')}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600">{isEn ? 'Appointment date:' : 'تاريخ الموعد:'}</span>{' '}
                <span className="font-mono text-slate-800">{printInvoiceData.date}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600">{isEn ? 'Appointment time:' : 'توقيت الجلسة:'}</span>{' '}
                <span className="font-mono text-slate-800">{(isEn ? formatTimeTo12Hour(printInvoiceData.time).replace(/ص$/, 'AM').replace(/م$/, 'PM') : formatTimeTo12Hour(printInvoiceData.time))}</span>
              </div>
            </div>

            <div className="mb-6">
              <table className="w-full border-collapse border border-slate-300 text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-800">
                    <th className="border border-slate-300 p-3 text-start">{isEn ? 'Procedure / Treatment' : 'نوع الإجراء / العلاج الطبي'}</th>
                    <th className="border border-slate-300 p-3 text-center">{isEn ? 'Status' : 'الحالة'}</th>
                    <th className="border border-slate-300 p-3 text-end">{isEn ? 'Total cost (EGP)' : 'التكلفة الكلية (ج.م)'}</th>
                  </tr>
                </thead>
                <tbody>
                  {resolveProcedureBreakdown(printInvoiceData).map((proc, pIdx) => (
                    <tr key={pIdx}>
                      <td className="border border-slate-300 p-3 font-bold">
                        {proc.name} {proc.tooth ? `(${getToothInfo(proc.tooth).fullText})` : ''}
                      </td>
                      <td className="border border-slate-300 p-3 text-center">
                        {printInvoiceData.status === 'completed' ? (isEn ? 'Completed' : 'تم تقديم الخدمة') : (isEn ? 'Scheduled' : 'موعد مجدول')}
                      </td>
                      <td className="border border-slate-300 p-3 text-end font-mono font-bold">{proc.price.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="w-80 ms-auto space-y-2 border-t border-slate-300 pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 font-bold">{isEn ? 'Total treatment cost:' : 'إجمالي تكلفة العلاج:'}</span>
                <span className="font-bold font-mono text-slate-800">{printInvoiceData.price.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
              </div>
              <div className="flex justify-between text-emerald-700 bg-emerald-50/50 p-1 px-2 rounded font-bold">
                <span>{isEn ? 'Paid to date:' : 'إجمالي المسدد حتى الآن:'}</span>
                <span className="font-black font-mono">{(printInvoiceData.paidAmount !== undefined ? printInvoiceData.paidAmount : printInvoiceData.price).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
              </div>
              <div className="flex justify-between text-amber-700 bg-amber-50/50 p-1 px-2 rounded font-bold border-t border-dashed border-amber-200">
                <span>{isEn ? 'Remaining balance:' : 'المتبقي في الجلسات القادمة:'}</span>
                <span className="font-black font-mono">{(printInvoiceData.remainingAmount !== undefined ? printInvoiceData.remainingAmount : 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
              </div>
            </div>

            <div className="border rounded-xl p-3 space-y-2 text-xs"><p className="font-bold">{isEn ? 'Confirmed receipts (Cairo collection time)' : 'الإيصالات المؤكدة (وقت التحصيل بتوقيت القاهرة)'}</p>{invoiceReceipts.filter(r=>r.appointmentId===printInvoiceData.id).map(r=><div key={r.id} className="border-t pt-2"><p className="break-all">{r.receiptNumber||r.id} • {r.kind==='refund'?(isEn?'Refund':'استرداد'):(isEn?'Collection':'تحصيل')} • {r.kind==='refund'?'-':''}{r.amount} {isEn ? 'EGP' : 'ج.م'}</p><p>{r.createdAt?new Date(r.createdAt).toLocaleString(isEn ? 'en-GB' : 'ar-EG',{timeZone:'Africa/Cairo'}):r.collectionDate} • {r.actorName||(isEn?'Legacy record':'سجل قديم')} • {r.actorRole||''}</p></div>)}</div>
            {printInvoiceData.notes && (
              <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <span className="font-bold text-slate-700 block mb-1">{isEn ? 'Notes and payment history:' : 'ملاحظات وسجل الدفعات:'}</span>
                <p className="whitespace-pre-line text-slate-600 leading-relaxed">{printInvoiceData.notes}</p>
              </div>
            )}

            <div className="mt-16 text-center border-t border-slate-200 pt-6 flex justify-between items-center text-xs text-slate-400">
              <span>{isEn ? 'Accounts / Reception signature: .........................' : 'توقيع الحسابات / السكرتارية: .........................'}</span>
              <span>{isEn ? 'Clinic doctor signature: .........................' : 'توقيع طبيب العيادة الشريك: .........................'}</span>
              <span>{isEn ? 'Clinic Management System' : 'نظام إدارة العيادات السحابي الموحد'}</span>
            </div>
          </div>
        )}
      </PrintPreviewModal>

      {/* Printable Shift Closure Report Modal */}
      <PrintPreviewModal
        language={isEn ? 'en' : 'ar'}
        isOpen={!!printShiftData}
        onClose={() => setPrintShiftData(null)}
        title={isEn ? 'Full Shift Closing Report' : 'تقرير إغلاق الوردية الشامل (الشيفت واليومية المالية)'}
      >
        {printShiftData && (
          <div className="bg-white text-slate-900 leading-normal text-start text-xs p-1 font-sans" dir={isEn ? 'ltr' : 'rtl'}>
            
            {/* 1. Header Section */}
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-2 mb-2.5">
              <div className="space-y-0.5">
                <h1 className="text-lg font-black text-slate-900">{(isEn ? clinic.nameEn : clinic.nameAr) || clinic.name}</h1>
                <p className="text-[10px] text-slate-600 font-bold">
                  {isEn ? 'Dr.' : 'د.'} {(isEn ? clinic.doctorNameEn || clinic.doctorName : clinic.doctorName) || (isEn ? 'Specialist' : 'طبيب متخصص')} {(isEn ? clinic.doctorSpecialtyEn : clinic.doctorSpecialtyAr) ? `• ${isEn ? clinic.doctorSpecialtyEn : clinic.doctorSpecialtyAr}` : ''}
                </p>
                {clinic.doctorPhone && (
                  <p className="text-[9px] text-slate-500 font-mono">
                    {isEn ? 'Phone:' : 'هاتف:'} {clinic.doctorPhone}{clinic.additionalPhones && clinic.additionalPhones.length > 0 ? ` - ${clinic.additionalPhones.filter(Boolean).join(' - ')}` : ''}
                  </p>
                )}
                {clinic.address && <p className="text-[9px] text-slate-500">{isEn ? 'Address:' : 'العنوان:'} {clinic.address}</p>}
              </div>

              <div className="text-end space-y-0.5">
                <div className="inline-block bg-slate-900 text-white font-black text-[11px] px-2.5 py-0.5 rounded">
                  {isEn ? 'Shift Closing & Reconciliation Report' : 'تقرير إغلاق ومطابقة الوردية'}
                </div>
                <p className="text-[10px] text-slate-700 font-bold block mt-1">{isEn ? 'Business date:' : 'تاريخ اليومية:'} <span className="font-mono text-xs">{printShiftData.date}</span></p>
                <p className="text-[9px] text-slate-500 block">{isEn ? 'Closed at:' : 'توقيت الإغلاق:'} {printShiftData.closedAt ? new Date(printShiftData.closedAt).toLocaleString(isEn ? 'en-GB' : 'ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }) : new Date().toLocaleTimeString(isEn ? 'en-GB' : 'ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                <p className="text-[9px] text-slate-600 font-bold block">{isEn ? 'Cashier / Operator:' : 'الكاشير / المسؤول:'} {printShiftData.cashierName || printShiftData.closedBy || (isEn ? 'Clinic staff' : 'طاقم العيادة')}</p>
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
                    <th className="border border-slate-300 p-1 text-start">{isEn ? 'Payment Method' : 'طريقة الدفع'}</th>
                    <th className="border border-slate-300 p-1">{isEn ? 'Total In (Collected)' : 'إجمالي الوارد (المقبوض)'}</th>
                    <th className="border border-slate-300 p-1">{isEn ? 'Total Expenses (Deducted)' : 'إجمالي المصاريف (المخصومة)'}</th>
                    <th className="border border-slate-300 p-1">{isEn ? 'Net Collected' : 'الصافي المحصل'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(printShiftData.activeMethodsList || activeMethodsList).map((method, idx) => {
                    const rev = printShiftData.revenuesMap ? paymentMethodMapAmount(printShiftData.revenuesMap,method) : (
                      method === 'كاش' ? (printShiftData.cashRevenue || printShiftData.cashAmount || 0) :
                      method === 'فيزا' ? (printShiftData.cardRevenue || printShiftData.cardAmount || 0) :
                      method === 'إنستاباي' ? (printShiftData.instapayRevenue || printShiftData.instapayAmount || 0) :
                      method === 'محفظة' ? (printShiftData.walletRevenue || printShiftData.walletAmount || 0) : 0
                    );
                    const exp = printShiftData.expensesMap ? paymentMethodMapAmount(printShiftData.expensesMap,method) : (
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
                      <tr key={idx} data-testid="print-method-row" data-payment-method={method} data-revenue={rev} data-expense={exp} className={method === 'كاش' ? 'bg-amber-50/40 font-bold' : ''}>
                        <td className="border border-slate-300 p-1 text-start font-bold text-slate-800">
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
                    <td className="border border-slate-300 p-1 text-start">{isEn ? 'Overall Shift Total' : 'الإجمالي الكلي للوردية'}</td>
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
                  <span className="font-mono font-bold text-rose-600">-{((printShiftData.cashExpenses !== undefined ? printShiftData.cashExpenses : 0) || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
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
                      <th className="border border-slate-300 p-1 text-start">{isEn ? 'Expense Description' : 'بيان المصروف'}</th>
                      <th className="border border-slate-300 p-1 text-center">{isEn ? 'Category' : 'الفئة'}</th>
                      <th className="border border-slate-300 p-1 text-center">{isEn ? 'Deduction Method' : 'طريقة الخصم'}</th>
                      <th className="border border-slate-300 p-1 text-end">{isEn ? 'Amount' : 'المبلغ'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printShiftData.expensesList.map((exp: any, idx: number) => (
                      <tr key={exp.id || idx}>
                        <td className="border border-slate-300 p-1 font-bold text-slate-800">{exp.title}</td>
                        <td className="border border-slate-300 p-1 text-center text-slate-600">{exp.category || (isEn ? 'General' : 'عام')}</td>
                        <td className="border border-slate-300 p-1 text-center font-bold text-slate-700">{paymentMethodLabel(exp.paymentMethod,isEn)}</td>
                        <td className="border border-slate-300 p-1 text-end font-mono font-bold text-rose-700">-{exp.amount.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
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
                    <th className="border border-slate-300 p-1 text-start">{isEn ? 'Time' : 'الوقت'}</th>
                    <th className="border border-slate-300 p-1 text-start">{isEn ? 'Patient Name' : 'اسم المريض'}</th>
                    <th className="border border-slate-300 p-1 text-start">{isEn ? 'Treatment / Procedure' : 'نوع العلاج / الإجراء'}</th>
                    <th className="border border-slate-300 p-1 text-center">{isEn ? 'Payment Method' : 'طريقة الدفع'}</th>
                    <th className="border border-slate-300 p-1 text-end">{isEn ? 'Total Cost' : 'التكلفة الإجمالية'}</th>
                    <th className="border border-slate-300 p-1 text-end">{isEn ? 'Collected in Shift' : 'المحصل بالوردية'}</th>
                    <th className="border border-slate-300 p-1 text-end">{isEn ? 'Remaining (Credit)' : 'المتبقي (آجل)'}</th>
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
                        <td className="border border-slate-300 p-1 font-mono text-slate-600">{(isEn ? formatTimeTo12Hour(timeVal).replace(/ص$/, 'AM').replace(/م$/, 'PM') : formatTimeTo12Hour(timeVal))}</td>
                        <td className="border border-slate-300 p-1 font-bold text-slate-800">{app.patientName} {isUnpaid ? (isEn ? '⚠️ (Unpaid)' : '⚠️ (لم يدفع)') : ''}</td>
                        <td className="border border-slate-300 p-1 text-slate-700">{app.treatmentType || (isEn ? 'Dental Treatment' : 'علاج أسنان')}{item.notes ? ` (${item.notes})` : ''}</td>
                        <td className="border border-slate-300 p-1 text-center font-bold text-slate-700">{paymentMethodLabel(formatPaymentMethod(method),isEn)}</td>
                        <td className="border border-slate-300 p-1 text-end font-mono text-slate-700">{(app.price || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                        <td className={`border border-slate-300 p-1 text-end font-mono font-bold ${isUnpaid ? 'text-rose-700' : 'text-emerald-700'}`}>{(paid || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
                        <td className="border border-slate-300 p-1 text-end font-mono font-bold text-amber-700">{(remaining || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</td>
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
              <span>{isEn ? 'Cashier / Reception signature: .........................' : 'توقيع مسؤول الكاشير / السكرتارية: .........................'}</span>
              <span>{isEn ? 'Doctor / Clinic manager signature: .........................' : 'توقيع طبيب / مدير العيادة: .........................'}</span>
              <span>{isEn ? 'Printed:' : 'طبع بتاريخ:'} {new Date().toLocaleString(isEn ? 'en-GB' : 'ar-EG')}</span>
            </div>
          </div>
        )}
      </PrintPreviewModal>

      {/* Screen Title Block */}
      <div className="print:hidden flex flex-col justify-between gap-5 bg-[#272E40] p-6 rounded-3xl border border-slate-200/80 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500 rounded-full blur-3xl opacity-5 -mr-12 -mt-12 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-5 -ml-12 -mb-12 pointer-events-none"></div>
        
        <div className="flex items-center gap-4 relative z-10">
          <div className="bg-emerald-500/10 p-3.5 rounded-2xl border border-emerald-500/20 shadow-xs text-emerald-600">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">{t('financials.title')}</h1>
          </div>
        </div>

        <div className="flex flex-wrap p-1.5 rounded-2xl text-xs gap-2">
          {isTabAllowed('shift_closure') && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab('shift_closure')}
              className={`py-2 px-4 rounded-full font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'shift_closure' 
                  ? 'bg-emerald-500 text-white shadow-sm border-emerald-500'
                  : 'border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
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
              className={`py-2 px-4 rounded-full font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'shift_history' 
                  ? 'bg-emerald-500 text-white shadow-sm border-emerald-500'
                  : 'border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
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
              className={`py-2 px-4 rounded-full font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'revenues' 
                  ? 'bg-emerald-500 text-white shadow-sm border-emerald-500'
                  : 'border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
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
              className={`py-2 px-4 rounded-full font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'installments' 
                  ? 'bg-emerald-500 text-white shadow-sm border-emerald-500'
                  : 'border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
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
              className={`py-2 px-4 rounded-full font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer border ${
                activeTab === 'expenses' 
                  ? 'bg-emerald-500 text-white shadow-sm border-emerald-500'
                  : 'border-white/10 bg-white/10 text-slate-200 hover:bg-white/20'
              }`}
            >
              <TrendingDown className="h-4 w-4 text-rose-500" />
              {isEn ? 'Clinic Expenses & Purchasing' : (t('financials.tabs.expenses') || 'المصروفات والبنود المقتطعة')}
            </motion.button>
          )}
          {isTabAllowed('returns') && <button type="button" onClick={()=>setActiveTab('returns')} className={`py-2 px-4 rounded-xl font-bold border ${activeTab==='returns'?'bg-emerald-500 text-white border-emerald-500':'border-white/10 bg-white/10 text-slate-200'}`}>{isEn?'Returns Log':'سجل المرتجعات'}</button>}

        </div>
      </div>

      {activeTab==='returns' && <ReturnsLog clinicId={clinic.id} isEn={!!isEn} />}

      {activeShift?.needsSettlement&&<div role="alert" className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs font-bold text-amber-800">{isEn?'This drawer needs manual settlement. No shift was automatically closed and no balance was reset.':'هذا الدرج محتاج تسوية يدوية. لم تُقفل أي وردية تلقائيًا ولم يتم تصفير أي رصيد.'}{activeShift.conflictingShifts>1&&(isEn?' Conflicting open shifts: collections are blocked until settlement.':' توجد ورديات مفتوحة متعارضة: التحصيل موقوف لحين التسوية.')}</div>}
      {activeTab==='shift_closure'&&<OfflineCommands isEn={!!isEn} shiftId={activeShift?.id||'unassigned'}/>}
      {activeTab==='shift_closure'&&activeShift&&<LegacySettlement clinicId={clinic.id} shift={activeShift} isEn={!!isEn}/>}
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
                          <span className="font-mono font-black text-emerald-800 text-xs mt-1">{(Number(dailyCashAmount) - Number(cashExpenses)).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
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
                <div className="lg:col-span-12 space-y-5 animate-fade-in">
                  {/* Active shift status strip */}
                  <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-2xl px-4 py-2.5 text-xs font-bold flex items-center gap-2 flex-wrap">
                    <span className="w-2 h-2 rounded-full bg-blue-600 inline-block shrink-0"></span>
                    <span>{isEn ? 'Current shift is open' : 'الوردية الحالية مفتوحة'}</span>
                    <span className="text-blue-300">•</span>
                    <span>{activeShift.cashierName}</span>
                    <span className="text-blue-300">•</span>
                    <span>{new Date(activeShift.openedAt).toLocaleDateString(isEn ? 'en-US' : 'ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} {isEn ? 'from' : 'من'} {new Date(activeShift.openedAt).toLocaleTimeString(isEn ? 'en-US' : 'ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Expected cash green card */}
                    <div className="lg:col-span-5 bg-gradient-to-br from-emerald-600 to-teal-700 text-white rounded-3xl p-6 flex flex-col justify-between gap-6 shadow-lg shadow-emerald-500/20">
                      <div className="space-y-2">
                        <span className="text-sm font-bold text-emerald-50/90">{isEn ? 'Expected cash in drawer now' : 'المتوقع كاش في الدرج دلوقتي'}</span>
                        <div className="text-4xl font-black font-mono tracking-tight">
                          {(Number(activeShift.startCash || 0) + dailyCashAmount - cashExpenses).toLocaleString()} <span className="text-lg font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <p className="text-[11px] text-emerald-50/80 font-medium leading-relaxed">
                          {isEn ? 'Count the cash present in the drawer and record it below to close the shift.' : 'عدّ الفلوس اللي في الدرج وسجّلها تحت عشان تقفل الوردية'}
                        </p>
                        <button
                          type="button"
                          onClick={() => document.getElementById('shift-closure-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                          className="bg-white text-emerald-700 hover:bg-emerald-50 text-xs font-black px-4 py-2.5 rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                        >
                          <Check className="h-4 w-4" />
                          {isEn ? 'Count Drawer & Close Shift' : 'عدّ الدرج وإقفال الوردية'}
                        </button>
                      </div>
                    </div>

                    {/* 2x2 stats */}
                    <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-2">
                        <span className="text-xs font-bold text-slate-500 block">{isEn ? 'Total Collected (All Methods)' : 'المحصل كله بكل الطرق'}</span>
                        <span className="text-2xl font-black text-emerald-600 font-mono block">
                          {dailyExpectedCash.toLocaleString()} <span className="text-sm font-bold text-slate-400">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>
                      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-2">
                        <span className="text-xs font-bold text-slate-500 block">{isEn ? 'Installments & Due Balances' : 'الأقساط والمتبقي على المرضى'}</span>
                        <span className="text-2xl font-black text-amber-600 font-mono block">
                          {dailyRemainingCash.toLocaleString()} <span className="text-sm font-bold text-slate-400">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>
                      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-2">
                        <span className="text-xs font-bold text-slate-500 block">{isEn ? 'Deducted Expenses' : 'المصاريف المخصومة'}</span>
                        <span className="text-2xl font-black text-rose-600 font-mono block">
                          {activeShiftExpensesTotal.toLocaleString()} <span className="text-sm font-bold text-slate-400">{isEn ? 'EGP' : 'ج.م'}</span>
                        </span>
                      </div>
                      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-2">
                        <span className="text-xs font-bold text-slate-500 block">{isEn ? "Today's Operations Count" : 'عدد العمليات النهاردة'}</span>
                        <span className="text-2xl font-black text-blue-600 font-mono block">
                          {activeShiftPaymentRecords.length} <span className="text-sm font-bold text-slate-400">{isEn ? 'operations' : 'عملية'}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Collections by payment method with bars */}
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-2">
                    <div className="flex items-center justify-between pb-2">
                      <h3 className="text-sm font-black text-slate-800">{isEn ? "Today's Collections by Payment Method" : 'المحصل النهاردة حسب طريقة الدفع'}</h3>
                      <span className="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full">
                        {isEn ? 'Total:' : 'إجمالي:'} {dailyExpectedCash.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                      </span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {shiftReportMethods.map((method, idx) => {
                        const isLoyalty = normalizePaymentMethod(method) === 'نقاط الولاء';
                        const rev = dynamicRevenues[method] || 0;
                        const exp = dynamicExpenses[method] || 0;
                        const net = rev - exp;
                        const maxRev = Math.max(1, ...shiftReportMethods.map(m => dynamicRevenues[m] || 0));
                        const displayMethodName = isEn ? (
                          method === 'كاش' ? 'Cash' :
                          method === 'فيزا' ? 'Visa / Card' :
                          method === 'إنستاباي' ? 'InstaPay' :
                          method === 'محفظة' ? 'E-Wallet' : method
                        ) : method;
                        return (
                          <div key={idx} data-testid="shift-method-row" data-payment-method={method} data-revenue={rev} data-expense={exp} className="flex items-center gap-4 py-3">
                            <span className="w-20 shrink-0 text-xs font-bold text-slate-800">
                              {isLoyalty ? (isEn ? 'Loyalty Points' : 'نقاط الولاء') : displayMethodName}
                            </span>
                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-l from-emerald-500 to-teal-500 rounded-full transition-all" style={{ width: `${Math.round((rev / maxRev) * 100)}%` }} />
                            </div>
                            <div className="w-36 shrink-0 text-end">
                              <span className="text-xs font-black text-slate-800 font-mono">{rev.toLocaleString()} {isEn ? 'EGP' : 'ج.م'} <span className="font-bold text-slate-400">{isLoyalty ? (isEn ? 'discount' : 'خصم') : (isEn ? 'in' : 'وارد')}</span></span>
                              {exp > 0 && (
                                <span className="block text-[10px] text-slate-400 font-bold">{isEn ? 'Exp:' : 'مصروف:'} {exp.toLocaleString()} • {isEn ? 'Net:' : 'صافي:'} {net.toLocaleString()}</span>
                              )}
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

                {/* Shift Closure Drawer matching area (col-span-4) - Closing form */}
                <div id="shift-closure-form" className="animate-fade-in scroll-mt-24">
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
                </div>
              </>
            )}
          </>
        )}

        {/* TAB 3: Shift History (سجل الإقفال التاريخي) */}
        {activeTab === 'shift_history' && (
          <div className="lg:col-span-12 space-y-4 animate-fade-in">
            {(() => {
              const nowMonth = new Date();
              const monthKey = `${nowMonth.getFullYear()}-${String(nowMonth.getMonth() + 1).padStart(2, '0')}`;
              const monthShifts = shiftHistory.filter(s => (s.date || '').startsWith(monthKey));
              const monthRevenue = monthShifts.reduce((sum, s) => sum + (Number(s.totalRevenue) || 0), 0);
              const deficitShifts = monthShifts.filter(s => Number(s.discrepancy) < 0);
              const deficitSum = deficitShifts.reduce((sum, s) => sum + (Number(s.discrepancy) || 0), 0);
              const fmtTime = (iso?: string) => {
                if (!iso) return '—';
                const d = new Date(iso);
                return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString(isEn ? 'en-US' : 'ar-EG', { hour: '2-digit', minute: '2-digit' });
              };
              const fmtDay = (dateStr: string) => {
                const d = new Date(dateStr + 'T00:00:00');
                if (isNaN(d.getTime())) return { day: dateStr, rest: '' };
                return {
                  day: String(d.getDate()),
                  rest: d.toLocaleDateString(isEn ? 'en-US' : 'ar-EG', { weekday: 'long' }) + (isEn ? ', ' : ' • ') + d.toLocaleDateString(isEn ? 'en-US' : 'ar-EG', { month: 'long', year: 'numeric' })
                };
              };
              return (
                <>
                  {/* Month summary cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-2">
                      <span className="text-xs font-bold text-slate-500 block">{isEn ? 'Closed shifts this month' : 'ورديات مقفلة هذا الشهر'}</span>
                      <span className="text-2xl font-black text-slate-800 font-mono block">
                        {monthShifts.length} <span className="text-sm font-bold text-slate-400">{isEn ? 'shifts' : 'وردية'}</span>
                      </span>
                    </div>
                    <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-2">
                      <span className="text-xs font-bold text-slate-500 block">{isEn ? "Month's total collections" : 'إجمالي محصل الشهر'}</span>
                      <span className="text-2xl font-black text-emerald-600 font-mono block">
                        {monthRevenue.toLocaleString()} <span className="text-sm font-bold text-slate-400">{isEn ? 'EGP' : 'ج.م'}</span>
                      </span>
                    </div>
                    <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-2">
                      <span className="text-xs font-bold text-slate-500 block">{isEn ? 'Drawer discrepancies' : 'فروقات الدرج'}</span>
                      {deficitShifts.length === 0 ? (
                        <span className="text-lg font-black text-emerald-600 block">{isEn ? 'No discrepancies' : 'لا توجد فروقات'}</span>
                      ) : (
                        <span className="text-lg font-black text-rose-600 block">
                          {isEn
                            ? `${deficitShifts.length} shift${deficitShifts.length > 1 ? 's' : ''} short by ${Math.abs(deficitSum).toLocaleString()} EGP`
                            : `${deficitShifts.length === 1 ? 'وردية واحدة' : `${deficitShifts.length} ورديات`} بعجز ${deficitSum.toLocaleString()} ج.م`}
                        </span>
                      )}
                    </div>
                  </div>

                  {shiftHistory.length === 0 ? (
                    <div className="p-10 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-white/60">
                      <Archive className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                      <span className="text-xs font-bold text-slate-400">{isEn ? 'No closed shift records yet' : 'لا توجد سجلات وردية مغلقة حتى الآن'}</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {shiftHistory.slice(0, shiftHistoryLimit).map((shift) => {
                        const d = fmtDay(shift.date);
                        const disc = Number(shift.discrepancy) || 0;
                        return (
                          <div key={shift.id} className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4 shadow-2xs">
                            {/* Date + cashier */}
                            <div className="flex items-center gap-4 min-w-0 lg:w-72 shrink-0">
                              <div className="text-center shrink-0 w-14">
                                <div className="text-2xl font-black text-slate-900 font-mono leading-none">{d.day}</div>
                                <div className="text-[10px] text-slate-400 font-bold mt-1">{d.rest}</div>
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-black text-slate-900 truncate">{shift.cashierName || shift.closedBy}</div>
                                <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                                  {isEn ? 'from' : 'من'} {fmtTime(shift.openedAt)} {isEn ? 'to' : 'إلى'} {fmtTime(shift.closedAt)} • {shift.completedCount} {isEn ? 'collected operations' : 'عمليات محصلة'}
                                  {shift.notes ? ` • ${isEn ? 'note recorded' : 'ملاحظة مسجلة'}` : ''}
                                </div>
                              </div>
                            </div>

                            {/* Numbers */}
                            <div className="flex items-center gap-5 sm:gap-7 flex-1 justify-center">
                              <div className="text-center">
                                <span className="text-[10px] text-slate-400 font-bold block">{isEn ? 'Collected' : 'المحصل'}</span>
                                <span className="text-sm font-black text-emerald-600 font-mono">{(Number(shift.totalRevenue) || 0).toLocaleString()}</span>
                              </div>
                              <div className="text-center">
                                <span className="text-[10px] text-slate-400 font-bold block">{isEn ? 'Expected in drawer' : 'المتوقع بالدرج'}</span>
                                <span className="text-sm font-black text-slate-700 font-mono">{(shift.expectedCash || 0).toLocaleString()}</span>
                              </div>
                              <div className="text-center">
                                <span className="text-[10px] text-slate-400 font-bold block">{isEn ? 'Actual' : 'الفعلي'}</span>
                                <span className={`text-sm font-black font-mono ${disc < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{(shift.actualCash || 0).toLocaleString()}</span>
                              </div>
                              <div>
                                {disc === 0 ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
                                    <Check className="h-3 w-3" /> {isEn ? 'Match' : 'مطابق'}
                                  </span>
                                ) : disc < 0 ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-100 px-2.5 py-1 rounded-full">
                                    {isEn ? 'Short' : 'عجز'} {disc.toLocaleString()}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                                    {isEn ? 'Surplus' : 'زيادة'} +{disc.toLocaleString()}
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setSelectedHistoryShift(shift)}
                              className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs transition shrink-0 cursor-pointer"
                            >
                              {isEn ? 'View Report' : 'عرض التقرير'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {shiftHistory.length > shiftHistoryLimit && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-slate-200">
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
                </>
              );
            })()}

              {/* Detailed Historical Shift Modal */}
              {selectedHistoryShift && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex justify-center items-center p-4 z-50 animate-fade-in" dir={isEn ? 'ltr' : 'rtl'}>
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto relative text-start">
                    
                    {/* Header */}
                    <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                          <span>📊</span> {isEn ? 'Detailed Financial Closing Report' : 'تقرير الإغلاق المالي التفصيلي'}
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {isEn ? 'Business date:' : 'ليوم العمل التشغيلي:'} <span className="font-bold text-slate-600 font-mono">{selectedHistoryShift.date}</span>
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-start">
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 font-bold block">{isEn ? 'Closed by:' : 'مغلق بواسطة:'}</span>
                        <span className="text-xs font-bold text-slate-800 mt-1 block">{selectedHistoryShift.closedBy}</span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <span className="text-[10px] text-slate-400 font-bold block">{isEn ? 'Closed at:' : 'توقيت الإغلاق:'}</span>
                        <span className="text-[11px] font-bold text-slate-700 mt-1 block font-mono" dir="ltr">
                          {new Date(selectedHistoryShift.closedAt).toLocaleString(isEn ? 'en-GB' : 'ar-EG', {
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
                        <span className="text-[10px] text-slate-400 font-bold block">{isEn ? 'Completed appointments:' : 'المواعيد المكتملة:'}</span>
                        <span className="text-xs font-bold text-slate-800 mt-1 block font-mono">{selectedHistoryShift.completedCount} {isEn ? 'appointments' : 'موعد'}</span>
                      </div>
                    </div>

                    {/* Cash Drawer Reconciliation Section */}
                    <div className="bg-indigo-50/30 border border-indigo-100/80 p-4 rounded-2xl space-y-2.5 text-start">
                      <h4 className="text-xs font-extrabold text-indigo-950 border-b border-indigo-100/50 pb-1.5 flex items-center gap-1">
                        <span>💵</span> {isEn ? 'Cash Drawer Reconciliation' : 'مطابقة الخزينة والنقد الفعلي (Cash Drawer)'}
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">{isEn ? 'Opening float:' : 'عهدة افتتاح البداية (Start Cash):'}</span>
                          <span className="font-bold font-mono text-slate-700">{(selectedHistoryShift.startCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{isEn ? 'Cash receipts:' : 'كاش المقبوضات الجديد (Cash Revenue):'}</span>
                          <span className="font-bold font-mono text-slate-700">{(selectedHistoryShift.cashRevenue || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="flex justify-between text-rose-600">
                          <span>{isEn ? 'Cash expenses only:' : 'مصاريف الكاش فقط:'}</span>
                          <span className="font-bold font-mono">-{((selectedHistoryShift.cashExpenses !== undefined ? selectedHistoryShift.cashExpenses : 0) || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="flex justify-between border-t border-indigo-100/50 pt-2 font-bold">
                          <span className="text-indigo-900">{isEn ? 'Expected drawer cash:' : 'الكاش المتوقع بالدرج (Expected):'}</span>
                          <span className="font-mono text-indigo-950">{(selectedHistoryShift.expectedCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                          <span className="text-slate-800">{isEn ? 'Actual drawer cash:' : 'الكاش الفعلي المسجل (Actual):'}</span>
                          <span className="font-mono text-slate-900 font-extrabold text-sm">{(selectedHistoryShift.actualCash || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                        <div className="flex justify-between border-t border-dashed border-indigo-150 pt-2 font-black">
                          <span className="text-slate-600">{isEn ? 'Surplus / Deficit:' : 'فارق العجز أو الزيادة:'}</span>
                          <span className={`font-mono text-sm flex items-center gap-1 ${
                            (selectedHistoryShift.discrepancy || 0) === 0 
                              ? 'text-emerald-600' 
                              : (selectedHistoryShift.discrepancy || 0) < 0 
                                ? 'text-rose-600' 
                                : 'text-indigo-600'
                          }`}>
                            {(selectedHistoryShift.discrepancy || 0) === 0 ? (
                              (isEn ? 'Exact match (0)' : 'متطابق تماماً (0)')
                            ) : (
                              `${(selectedHistoryShift.discrepancy || 0) > 0 ? (isEn ? 'Surplus: +' : 'زيادة بقيمة: +') : (isEn ? 'Deficit: ' : 'عجز بقيمة: ')}${(selectedHistoryShift.discrepancy || 0).toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}`
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Electronic Income & Installments Breakdown */}
                    <div className="bg-slate-50 border border-slate-150 p-4 rounded-2xl space-y-2.5 text-start">
                      <h4 className="text-xs font-bold text-slate-800 border-b border-slate-200/60 pb-1.5 flex items-center gap-1">
                        <span>💳</span> {isEn ? 'Payment channels and remaining installments' : 'طرق الدفع والأقساط المتبقية'}
                      </h4>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                        {getPaymentReportMethods(clinic.paymentMethods, selectedHistoryShift.snapshot?.dynamicRevenues || selectedHistoryShift.dynamicRevenues || {}, selectedHistoryShift.snapshot?.dynamicExpenses || selectedHistoryShift.dynamicExpenses || {}).map(method => {
                          const revenue = selectedHistoryShift.snapshot?.dynamicRevenues || selectedHistoryShift.dynamicRevenues ? paymentMethodMapAmount(selectedHistoryShift.snapshot?.dynamicRevenues || selectedHistoryShift.dynamicRevenues,method) : ({'كاش':selectedHistoryShift.cashRevenue,'فيزا':selectedHistoryShift.cardRevenue,'إنستاباي':selectedHistoryShift.instapayRevenue,'محفظة':selectedHistoryShift.walletRevenue}[method] || 0);
                          const expense = paymentMethodMapAmount(selectedHistoryShift.snapshot?.dynamicExpenses || selectedHistoryShift.dynamicExpenses,method);
                          return <div key={method} data-testid="history-method-row" data-payment-method={method} className="flex justify-between gap-2"><span className="text-slate-500">{paymentMethodLabel(method,isEn)}</span><span className="font-bold font-mono text-slate-800">{revenue.toLocaleString()} / -{expense.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span></div>;
                        })}
                        <div className="flex justify-between bg-amber-50/80 px-2 py-1 rounded-lg border border-amber-200/60 font-bold text-amber-900">
                          <span>{isEn ? 'Outstanding installments for this day:' : 'الأقساط والمتبقي بالذمة لهذا اليوم:'}</span>
                          <span className="font-mono text-amber-700">
                            {(
                              selectedHistoryShift.remainingRevenue !== undefined
                                ? selectedHistoryShift.remainingRevenue
                                : appointments.filter(a => isAppointmentInShift(a, selectedHistoryShift) && a.status === 'completed').reduce((sum, app) => sum + (app.remainingAmount !== undefined ? app.remainingAmount : 0), 0)
                            ).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                          </span>
                        </div>
                        <div className="flex justify-between border-s-2 border-emerald-500 ps-2 font-bold col-span-2 mt-1">
                          <span className="text-emerald-700">{isEn ? 'Total collections (before expenses):' : 'إجمالي الإيرادات الكلي المحصل (دون خصم أي مصروفات):'}</span>
                          <span className="font-mono text-emerald-800">{(selectedHistoryShift.totalRevenue || 0).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Written Log / Notes */}
                    <div className="space-y-1 text-start">
                      <span className="text-[10px] text-slate-400 font-bold block">{isEn ? 'Shift notes and audit log:' : 'مذكرة اليومية وملاحظات التدقيق المكتوبة:'}</span>
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-[11px] leading-relaxed text-slate-600 font-medium whitespace-pre-wrap max-h-48 overflow-y-auto font-mono text-start" dir={isEn ? 'ltr' : 'rtl'}>
                        {selectedHistoryShift.notes || (isEn ? 'No additional notes for this shift.' : 'لم يتم تدوين أي ملاحظات إضافية لهذه الوردية.')}
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
                        <span>{isEn ? 'Print Full Shift Report' : 'طباعة تقرير الوردية الشامل'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedHistoryShift(null)}
                        className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition text-xs cursor-pointer text-center"
                      >
                        {isEn ? 'Close' : 'إغلاق'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
          </div>
        )}

        {/* TAB 4: Installments (الأقساط والمستحقات) */}
        {activeTab === 'installments' && (
          <div className="lg:col-span-12 space-y-5 animate-fade-in">

            {/* Stat cards */}
            {(() => {
              const totalRemainingAll = filteredInstallmentPatients.reduce((s, p) => s + p.totalRemaining, 0);
              const biggest = filteredInstallmentPatients.length > 0 ? filteredInstallmentPatients[0] : null;
              const oldestApp = biggest && biggest.appointments.length > 0
                ? [...biggest.appointments].sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0]
                : null;
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 bg-orange-600 text-white p-6 rounded-3xl shadow-sm">
                    <span className="text-xs font-bold text-orange-100">{isEn ? 'Total Outstanding Balances on Patients' : 'إجمالي المتبقي على المرضى'}</span>
                    <p className="text-4xl font-black font-mono mt-2">
                      {totalRemainingAll.toLocaleString()} <span className="text-sm font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                    </p>
                    <span className="text-xs text-orange-100/90 block mt-2">
                      {isEn
                        ? `${filteredInstallmentPatients.length} patients with due installments for completed treatment sessions`
                        : `${filteredInstallmentPatients.length} مرضى عليهم أقساط مستحقة لجلسات علاجية مكتملة`}
                    </span>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-500">{isEn ? 'Largest Due Installment' : 'أقرب وأكبر قسط مستحق'}</span>
                    {biggest ? (
                      <>
                        <p className="text-2xl font-black text-slate-800 mt-2">
                          {biggest.patientName} · <span className="font-mono">{biggest.totalRemaining.toLocaleString()}</span> <span className="text-sm font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                        </p>
                        <span className="text-xs text-slate-400 block mt-2">
                          {oldestApp ? (
                            isEn
                              ? `Since ${oldestApp.date} · ${oldestApp.treatmentType || 'General Treatment'}`
                              : `منذ ${formatArabicDate(oldestApp.date)} · ${oldestApp.treatmentType || 'علاج عام'}`
                          ) : ''}
                        </span>
                      </>
                    ) : (
                      <p className="text-sm font-bold text-slate-400 mt-3">{isEn ? 'No due installments' : 'لا توجد أقساط مستحقة'}</p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Filter row: period pills + search */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex bg-white border border-slate-200 p-1 rounded-full text-xs gap-1 shadow-sm">
                {([
                  { id: 'today', ar: 'اليوم', en: 'Today' },
                  { id: 'month', ar: 'هذا الشهر', en: 'This Month' },
                  { id: 'all', ar: 'الكل', en: 'All' }
                ] as const).map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setInstallmentsFilterPeriod(p.id); setInstallmentsLimit(5); }}
                    className={`py-1.5 px-4 rounded-full font-bold transition cursor-pointer ${
                      installmentsFilterPeriod === p.id
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {isEn ? p.en : p.ar}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={isEn ? 'Search patient name or phone...' : 'ابحث باسم المريض أو رقم الهاتف...'}
                  value={installmentsSearch}
                  onChange={(e) => {
                    setInstallmentsSearch(e.target.value);
                    setInstallmentsLimit(5);
                  }}
                  className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold bg-white shadow-sm"
                />
              </div>
            </div>

            {/* Patient installment cards */}
            {filteredInstallmentPatients.length === 0 ? (
              <div className="bg-white p-12 rounded-3xl border border-slate-200 shadow-sm text-center text-slate-400">
                <Receipt className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                <span className="text-xs font-bold">{isEn ? 'No patients matching search criteria or having due installments' : 'لا يوجد أي مرضى يطابقون خيارات البحث أو لديهم أقساط مستحقة حالياً'}</span>
              </div>
            ) : (
              <div className="space-y-4">
                {visibleInstallmentPatients.map((patient, index) => {
                  const paidPct = patient.totalPrice > 0 ? Math.round((patient.totalPaid / patient.totalPrice) * 100) : 0;
                  const firstApp = patient.appointments[0];
                  return (
                    <div key={index} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="font-black text-slate-800 text-sm block">{patient.patientName}</span>
                          <span className="text-xs text-slate-400 font-mono block mt-0.5" dir="ltr">{patient.patientPhone || (isEn ? 'No phone' : 'بدون هاتف')}</span>
                        </div>
                        <div className="text-end shrink-0">
                          <span className="text-[11px] text-slate-400 block">{isEn ? 'Due Balance (Installment Due)' : 'المتبقي (القسط المستحق)'}</span>
                          <span className="text-xl font-black text-orange-600 font-mono">
                            {patient.totalRemaining.toLocaleString()} <span className="text-xs font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                          </span>
                        </div>
                      </div>

                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, paidPct))}%` }} />
                      </div>

                      <div className="text-xs font-bold text-slate-600">
                        {isEn ? 'Total Cost' : 'إجمالي التكلفة'} <span className="font-mono text-slate-800">{patient.totalPrice.toLocaleString()}</span> {isEn ? 'EGP' : 'ج.م'}
                        <span className="mx-2 text-slate-300">·</span>
                        {isEn ? 'Paid so far' : 'المدفوع حتى الآن'} <span className="font-mono text-emerald-600">{patient.totalPaid.toLocaleString()}</span> {isEn ? 'EGP' : 'ج.م'} <span className="font-mono text-slate-500">({paidPct}%)</span>
                      </div>

                      {firstApp && (
                        <div className="bg-slate-50 rounded-xl px-3.5 py-2.5 text-xs text-slate-500">
                          <span className="font-bold text-slate-600">{firstApp.treatmentType || (isEn ? 'General Treatment' : 'علاج عام')}</span>
                          {firstApp.date ? (isEn ? ` · ${firstApp.date}` : ` · ${formatArabicDate(firstApp.date)}`) : ''}
                          {patient.appointments.length > 1 && (
                            <span className="text-orange-500 font-bold"> +{patient.appointments.length - 1}</span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setFinancialModalAutoPay(true);
                            setFinancialModalPatient({
                              id: patient.patientId,
                              name: patient.patientName,
                              phone: patient.patientPhone
                            });
                          }}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer"
                        >
                          {isEn ? 'Pay Installment' : 'سداد دفعة'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFinancialModalAutoPay(false);
                            setFinancialModalPatient({
                              id: patient.patientId,
                              name: patient.patientName,
                              phone: patient.patientPhone
                            });
                          }}
                          className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                        >
                          {isEn ? 'Account Statement' : 'كشف حساب'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Show More Pagination Bar */}
                {filteredInstallmentPatients.length > installmentsLimit && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-500">
                      {isEn ? `Showing ${Math.min(installmentsLimit, filteredInstallmentPatients.length)} of ${filteredInstallmentPatients.length} patients with dues` : <>يتم عرض <span className="font-mono font-black text-orange-600">{Math.min(installmentsLimit, filteredInstallmentPatients.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{filteredInstallmentPatients.length}</span> مريض لديه مستحقات</>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setInstallmentsLimit(prev => prev + 5)}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>{isEn ? 'Show More' : 'إظهار المزيد'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: Expenses (المصروفات التشغيلية) */}
        {activeTab === 'expenses' && (
          <div className="lg:col-span-12 space-y-5 animate-fade-in">

            {/* Summary Cards */}
            {(() => {
              const d = new Date();
              const pad = (n: number) => String(n).padStart(2, '0');
              const todayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
              const currentMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
              const todayTotal = expenseSummary?.todayTotal ?? expenses.filter(e => e.date === todayStr).reduce((s, e) => s + e.amount, 0);
              const monthTotal = expenseSummary?.monthTotal ?? expenses.filter(e => e.date && e.date.substring(0, 7) === currentMonth).reduce((s, e) => s + e.amount, 0);
              const allTotal = expenseSummary?.allTotal ?? expenses.reduce((s, e) => s + e.amount, 0);
              const categoryTotals: Record<string, number> = expenseSummary?.categoryTotals || {};
              if(!expenseSummary)expenses.forEach(e => { categoryTotals[e.category] = (categoryTotals[e.category] || 0) + e.amount; });
              let topCat = '';
              let maxVal = 0;
              Object.entries(categoryTotals).forEach(([cat, val]) => { if (val > maxVal) { maxVal = val; topCat = cat; } });
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-sm">
                    <span className="text-xs font-bold text-slate-300">{isEn ? 'Total Overall Expenses' : 'إجمالي المصروفات العام'}</span>
                    <p className="text-4xl font-black font-mono mt-2">
                      {allTotal.toLocaleString()} <span className="text-sm font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                    </p>
                    <span className="text-xs text-slate-400 block mt-2">{isEn ? 'All documented expense items since start of operation' : 'كل بنود الصرف الموثقة منذ بداية التشغيل'}</span>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-500">{isEn ? "Today's Expenses" : 'مصروفات اليوم'}</span>
                    <p className="text-3xl font-black text-slate-800 font-mono mt-2">
                      {todayTotal.toLocaleString()} <span className="text-sm font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                    </p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-500">{isEn ? 'This Month Expenses' : 'مصروفات الشهر الحالي'}</span>
                    <p className="text-3xl font-black text-rose-600 font-mono mt-2">
                      {monthTotal.toLocaleString()} <span className="text-sm font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                    </p>
                  </div>

                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <span className="text-xs font-bold text-slate-500">{isEn ? 'Top Spending Category' : 'الفئة الأكثر استهلاكاً'}</span>
                    <p className="text-xl font-black text-slate-800 mt-2 truncate" title={topCat}>
                      {topCat || (isEn ? 'None' : 'لا يوجد')}
                    </p>
                    <span className="text-xs text-slate-400 font-mono block mt-1">{topCat ? `${maxVal.toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}` : ''}</span>
                  </div>
                </div>
              );
            })()}

            {/* Sub-Layout: Add form & register */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

              {/* Form panel */}
              <div className="lg:col-span-5 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800">{isEn ? 'Record New Expense' : 'تسجيل مصروف جديد'}</h3>

                <form onSubmit={handleAddExpense} className="space-y-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Expense Description / Item *' : 'بيان المصروف / البند *'}</label>
                    <input
                      type="text"
                      required
                      placeholder={isEn ? 'e.g. Filling materials, Rent, Electricity bill...' : 'مثال: أدوات ومواد حشوات، إيجار، فاتورة كهرباء...'}
                      value={expenseTitle}
                      onChange={(e) => setExpenseTitle(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold bg-slate-50/60"
                    />
                  </div>

                  <div className="space-y-1.5">
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
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-bold text-left bg-slate-50/60"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Expense Category *' : 'تصنيف وفئة المصروف *'}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { v: 'مستلزمات طبية', ar: 'مستلزمات طبية وعيادة', en: 'Medical Supplies & Clinic' },
                        { v: 'مصاريف معامل', ar: 'مصاريف معامل', en: 'Lab Expenses' },
                        { v: 'إيجار وفواتير', ar: 'إيجار وفواتير', en: 'Rent & Utilities' },
                        { v: 'صيانة وإصلاحات', ar: 'صيانة وإصلاحات', en: 'Maintenance & Repairs' },
                        { v: 'رواتب وأجور', ar: 'رواتب وأجور', en: 'Salaries & Wages' },
                        { v: 'دعاية وتسويق', ar: 'دعاية وتسويق', en: 'Marketing & Ads' },
                        { v: 'مصاريف إدارية', ar: 'مصاريف إدارية', en: 'Administrative' },
                        { v: 'أخرى', ar: 'أخرى', en: 'Other' }
                      ] as const).map(c => (
                        <button
                          key={c.v}
                          type="button"
                          onClick={() => setExpenseCategory(c.v)}
                          className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition cursor-pointer border ${
                            expenseCategory === c.v
                              ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                              : 'bg-slate-100 border-transparent text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {isEn ? c.en : c.ar}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Expense Date *' : 'تاريخ الصرف *'}</label>
                    <input
                      type="date"
                      required
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-bold text-left bg-slate-50/60"
                    />
                  </div>

                  {/* Funding source selection */}
                  <div className="space-y-2">
                    <label className="font-bold text-slate-600 block">{isEn ? 'Funding Source (Required) *' : 'مصدر الصرف (إلزامي) *'}</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div
                        onClick={() => {
                          setExpenseType('shift');
                          if (!expensePaymentMethod) {
                            setExpensePaymentMethod(expenseMethodsList[0] || '');
                          }
                        }}
                        className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                          expenseType === 'shift'
                            ? 'bg-emerald-50/60 border-emerald-500'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-xs font-black text-slate-800 block">{isEn ? 'From Active Shift' : 'من حسابات الوردية المفتوحة'}</span>
                        <span className="text-[11px] text-slate-400 block mt-1">
                          {activeShift
                            ? (isEn ? `Recorded against the selected channel: ${activeShift.cashierName}` : `يُخصم من طريقة الدفع المحددة بوردية: ${activeShift.cashierName}`)
                            : (isEn ? 'Only cash expenses change the cash drawer' : 'مصروفات الكاش فقط تؤثر على الدرج')}
                        </span>
                      </div>

                      <div
                        onClick={() => setExpenseType('personal')}
                        className={`p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                          expenseType === 'personal'
                            ? 'bg-emerald-50/60 border-emerald-500'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-xs font-black text-slate-800 block">{isEn ? 'Personal Funds / Self-Funded' : 'مال خاص / تمويل شخصي'}</span>
                        <span className="text-[11px] text-slate-400 block mt-1">{isEn ? 'Not deducted from drawer or shift' : 'لا يُخصم من الخزنة أو الوردية'}</span>
                      </div>
                    </div>

                    {expenseType === 'shift' && (
                      <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl space-y-1.5 animate-fade-in">
                        <label className="block text-xs font-black text-emerald-950">
                          💳 {isEn ? 'Payment Method for Shift Deduction:' : 'طريقة الدفع للخصم من الوردية:'}
                        </label>
                        <select
                          data-testid="expense-payment-method"
                          value={expensePaymentMethod || expenseMethodsList[0] || ''}
                          onChange={(e) => setExpensePaymentMethod(e.target.value)}
                          className="w-full px-2.5 py-1.5 border border-emerald-200 rounded-lg text-xs font-bold text-emerald-900 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        >
                          {expenseMethodsList.length === 0 && <option value="">{isEn ? 'Add a method in Settings' : 'أضف طريقة دفع من الإعدادات'}</option>}
                          {expenseMethodsList.map((method, idx) => (
                            <option key={idx} value={method}>{paymentMethodLabel(method,isEn)}</option>
                          ))}
                        </select>
                        <p className="text-[10px] text-emerald-700 font-medium leading-relaxed">
                          💡 {isEn ? 'This expense is deducted specifically from the chosen payment method and does not affect the cash drawer if paid electronically.' : `يتم ربط هذا المصروف وخصمه حصرياً من طريقة الدفع المحددة (${expensePaymentMethod || expenseMethodsList[0] || ''})، وفي حال الصرف إلكترونياً لا يؤثر على الخزنة النقدية الكاش بالدرج.`}
                        </p>
                      </div>
                    )}
                    {!expenseType && (
                      <p className="text-xs text-rose-500 font-bold text-center animate-pulse">
                        ⚠️ {isEn ? 'Please select funding source to record expense' : 'يجب تحديد مصدر الصرف لتسجيل البند'}
                      </p>
                    )}
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl transition shadow-xs cursor-pointer text-sm"
                  >
                    {loading ? (isEn ? 'Saving...' : 'جاري الحفظ...') : (isEn ? 'Record Expense' : 'تسجيل وحفظ المصروف')}
                  </motion.button>
                </form>
              </div>

              {/* Register panel */}
              <div className="lg:col-span-7 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800">{isEn ? 'Logged Expenses Register' : 'سجل المصروفات الموثقة'}</h3>

                {/* Period pills */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex bg-slate-100 p-1 rounded-full text-xs gap-1 flex-wrap">
                    {([
                      { id: 'today', ar: 'اليوم', en: 'Today' },
                      { id: 'month', ar: 'هذا الشهر', en: 'This Month' },
                      { id: 'custom_day', ar: 'يوم محدد', en: 'Specific Day' },
                      { id: 'custom_range', ar: 'فترة مخصصة', en: 'Custom Range' },
                      { id: 'all', ar: 'الكل', en: 'All' }
                    ] as const).map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setExpenseFilterPeriod(p.id); setExpensesLimit(6); }}
                        className={`py-1.5 px-3.5 rounded-full font-bold transition cursor-pointer ${
                          expenseFilterPeriod === p.id
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {isEn ? p.en : p.ar}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category + search row */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={expenseFilterCategory}
                    onChange={(e) => {
                      setExpenseFilterCategory(e.target.value);
                      setExpensesLimit(6);
                    }}
                    className="px-3 py-2 border border-slate-200 rounded-full text-xs font-bold bg-slate-50 text-slate-800 cursor-pointer"
                  >
                    <option value="all">{isEn ? 'All Categories' : 'كل الفئات'} ▾</option>
                    <option value="مستلزمات طبية">{isEn ? 'Medical Supplies & Clinic' : 'مستلزمات طبية وعيادة'}</option>
                    <option value="مصاريف معامل">{isEn ? 'Lab Expenses' : 'مصاريف معامل'}</option>
                    <option value="صيانة وإصلاحات">{isEn ? 'Maintenance & Repairs' : 'صيانة وإصلاحات'}</option>
                    <option value="رواتب وأجور">{isEn ? 'Salaries & Wages' : 'رواتب وأجور'}</option>
                    <option value="إيجار وفواتير">{isEn ? 'Rent & Utilities' : 'إيجار وفواتير'}</option>
                    <option value="دعاية وتسويق">{isEn ? 'Marketing & Ads' : 'دعاية وتسويق'}</option>
                    <option value="مصاريف إدارية">{isEn ? 'Administrative Expenses' : 'مصاريف إدارية'}</option>
                    <option value="أخرى">{isEn ? 'Other' : 'أخرى'}</option>
                  </select>

                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder={isEn ? 'Search expense description or notes...' : 'ابحث في وصف المصروف أو الملاحظات...'}
                      value={expenseSearch}
                      onChange={(e) => {
                        setExpenseSearch(e.target.value);
                        setExpensesLimit(6);
                      }}
                      className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-full text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-slate-800 bg-slate-50/60"
                    />
                  </div>
                </div>

                {/* Custom Date / Range selectors */}
                {(expenseFilterPeriod === 'custom_day' || expenseFilterPeriod === 'custom_range') && (
                  <div className="flex flex-wrap items-center justify-start gap-4 bg-slate-50 p-3.5 rounded-2xl border border-slate-150 text-xs font-bold">
                    {expenseFilterPeriod === 'custom_day' && (
                      <div className="space-y-1">
                        <span className="text-xs text-slate-500 block">{isEn ? 'Select Specific Day:' : 'اختر اليوم المحدد:'}</span>
                        <input
                          type="date"
                          value={expenseFilterSpecificDate}
                          onChange={(e) => setExpenseFilterSpecificDate(e.target.value)}
                          className="px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500 outline-none text-left bg-white text-slate-800"
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
                            className="px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500 outline-none text-left bg-white text-slate-800"
                          />
                        </div>
                        <span className="text-slate-400 mt-4 font-normal">{isEn ? 'to' : 'إلى'}</span>
                        <div className="space-y-1">
                          <span className="text-xs text-slate-500 block">{isEn ? 'To Date:' : 'حتى تاريخ:'}</span>
                          <input
                            type="date"
                            value={expenseFilterEndDate}
                            onChange={(e) => setExpenseFilterEndDate(e.target.value)}
                            className="px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-emerald-500 outline-none text-left bg-white text-slate-800"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Expenses list */}
                {(() => {
                  const filtered = expenses.filter(e => {
                    const matchesSearch = e.title.toLowerCase().includes(expenseSearch.toLowerCase()) ||
                                          (e.notes && e.notes.toLowerCase().includes(expenseSearch.toLowerCase()));
                    const matchesCategory = expenseFilterCategory === 'all' || e.category === expenseFilterCategory;
                    let matchesPeriod = true;
                    if (expenseFilterPeriod === 'today') {
                      const d = new Date();
                      const pad = (n: number) => String(n).padStart(2, '0');
                      matchesPeriod = e.date === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                    } else if (expenseFilterPeriod === 'month') {
                      const d = new Date();
                      matchesPeriod = e.date.substring(0, 7) === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
                    <div className="space-y-3">
                      {filtered.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <TrendingDown className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                          <p className="text-xs font-bold text-slate-500">{isEn ? 'No expense records found matching selected filters' : 'لا توجد مصروفات مسجلة تطابق الفلاتر المحددة'}</p>
                        </div>
                      ) : (
                        <>
                          <div className="divide-y divide-slate-100">
                            {filtered.slice(0, expensesLimit).map((item, idx) => (
                              <div key={item.id || idx} className="py-3 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <span className="font-black text-slate-800 text-sm block">{item.title}</span>
                                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                    <span className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                                      item.category === 'مستلزمات طبية' ? 'bg-blue-50 text-blue-700' :
                                      item.category === 'مصاريف معامل' ? 'bg-orange-50 text-orange-700' :
                                      item.category === 'رواتب وأجور' ? 'bg-indigo-50 text-indigo-700' :
                                      item.category === 'إيجار وفواتير' ? 'bg-rose-50 text-rose-700' :
                                      item.category === 'صيانة وإصلاحات' ? 'bg-amber-50 text-amber-700' :
                                      item.category === 'دعاية وتسويق' ? 'bg-sky-50 text-sky-700' :
                                      'bg-slate-100 text-slate-700'
                                    }`}>
                                      {item.category}
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      {isEn ? item.date : formatArabicDate(item.date)}
                                      {' · '}
                                      {item.type === 'shift'
                                        ? (isEn ? `Deducted from shift float${activeShift ? ` · ${activeShift.cashierName}` : ''}` : `خُصم من عهدة الوردية${activeShift ? ` · ${activeShift.cashierName}` : ''}`)
                                        : item.type === 'personal'
                                          ? (isEn ? 'Personal funds' : 'مال خاص / تمويل شخصي')
                                          : (item.notes || (isEn ? 'Not specified' : 'غير محدد'))}
                                      {item.type === 'shift' && item.paymentMethod ? ` · ${item.paymentMethod}` : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`font-black font-mono text-sm ${item.amount < 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {item.amount < 0 ? '' : '-'}{Math.abs(item.amount).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                  </span>
                                  {!isStaff && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteExpense(item)}
                                      className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                      title={isEn ? 'Delete Expense' : 'حذف المصروف'}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Filtered total footer */}
                          <div className="bg-slate-50 px-4 py-3 rounded-2xl border border-slate-100 flex items-center justify-between text-xs font-bold text-slate-700">
                            <span>{isEn ? 'Total Filtered Expenses' : 'إجمالي المصروفات المفلترة'}</span>
                            <span className="font-mono text-rose-600 font-black text-sm">{filteredTotal.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                          </div>

                          {filtered.length > expensesLimit && (
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                              <span className="text-xs font-bold text-slate-500">
                                {isEn ? `Showing ${Math.min(expensesLimit, filtered.length)} of ${filtered.length} expense items` : <>يتم عرض <span className="font-mono font-black text-emerald-600">{Math.min(expensesLimit, filtered.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{filtered.length}</span> حركة مصروف</>}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setExpensesLimit(prev => prev + 5)}
                                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
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
          <div className="lg:col-span-12 space-y-5 animate-fade-in">

            {/* Period pills + range chip + gross/net toggle */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-white border border-slate-200 p-1 rounded-full text-xs gap-1 shadow-sm">
                  {([
                    { id: 'daily', ar: 'يومي', en: 'Daily' },
                    { id: 'weekly', ar: 'أسبوعي', en: 'Weekly' },
                    { id: 'monthly', ar: 'شهري', en: 'Monthly' },
                    { id: 'custom', ar: 'فترة محددة', en: 'Custom' }
                  ] as const).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setRevenueFilterMode(p.id); setRevenuesLimit(10); }}
                      className={`py-1.5 px-4 rounded-full font-bold transition cursor-pointer ${
                        revenueFilterMode === p.id
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {isEn ? p.en : p.ar}
                    </button>
                  ))}
                </div>
                <span className="bg-white border border-slate-200 rounded-full px-3.5 py-1.5 text-xs font-bold text-slate-600 shadow-sm flex items-center gap-1.5">
                  📅 <span dir={isEn ? 'ltr' : 'rtl'}>{(() => {
                    const shortD = (ds: string) => {
                      if (!ds) return '';
                      try {
                        const d = new Date(ds + 'T00:00:00');
                        return isEn
                          ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
                      } catch { return ds; }
                    };
                    const yearOf = (ds: string) => (ds || '').slice(0, 4);
                    if (revenueFilterMode === 'daily') return `${shortD(revenueDailyDate)} ${yearOf(revenueDailyDate)}`;
                    if (revenueFilterMode === 'weekly') {
                      const b = getWeekBounds(revenueWeeklyDate);
                      return `${shortD(b.startDateStr)} – ${shortD(b.endDateStr)} ${yearOf(b.endDateStr)}`;
                    }
                    if (revenueFilterMode === 'monthly') {
                      try {
                        const [y, m] = revenueMonthlyVal.split('-');
                        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
                        return isEn
                          ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                          : d.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
                      } catch { return revenueMonthlyVal; }
                    }
                    return `${shortD(revenueStartDate)} – ${shortD(revenueEndDate)} ${yearOf(revenueEndDate)}`;
                  })()}</span>
                </span>
              </div>

              <div className="flex bg-white border border-slate-200 p-1 rounded-full text-xs gap-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setRevenueReportType('gross')}
                  className={`py-1.5 px-4 rounded-full font-bold transition cursor-pointer ${
                    revenueReportType === 'gross'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {isEn ? 'Gross Revenue' : 'إجمالي الإيرادات'}
                </button>
                <button
                  type="button"
                  onClick={() => setRevenueReportType('net')}
                  className={`py-1.5 px-4 rounded-full font-bold transition cursor-pointer ${
                    revenueReportType === 'net'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {isEn ? 'Net Profit After Expenses' : 'صافي الأرباح بعد المصاريف'}
                </button>
              </div>
            </div>

            {/* Compact date inputs for the selected period mode */}
            <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3.5 py-2 shadow-sm w-fit">
              {revenueFilterMode === 'daily' && (
                <>
                  <label className="text-xs font-bold text-slate-500">{isEn ? 'Day:' : 'اليوم:'}</label>
                  <input
                    type="date"
                    value={revenueDailyDate}
                    onChange={(e) => setRevenueDailyDate(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                </>
              )}
              {revenueFilterMode === 'weekly' && (
                <>
                  <label className="text-xs font-bold text-slate-500">{isEn ? 'Any day in the week:' : 'أي يوم في الأسبوع:'}</label>
                  <input
                    type="date"
                    value={revenueWeeklyDate}
                    onChange={(e) => setRevenueWeeklyDate(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                </>
              )}
              {revenueFilterMode === 'monthly' && (
                <>
                  <label className="text-xs font-bold text-slate-500">{isEn ? 'Month:' : 'الشهر:'}</label>
                  <input
                    type="month"
                    value={revenueMonthlyVal}
                    onChange={(e) => setRevenueMonthlyVal(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-emerald-500 text-slate-800"
                  />
                </>
              )}
              {revenueFilterMode === 'custom' && (
                <>
                  <label className="text-xs font-bold text-slate-500">{isEn ? 'From:' : 'من:'}</label>
                  <input
                    type="date"
                    value={revenueStartDate}
                    onChange={(e) => setRevenueStartDate(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                  <label className="text-xs font-bold text-slate-500">{isEn ? 'To:' : 'إلى:'}</label>
                  <input
                    type="date"
                    value={revenueEndDate}
                    onChange={(e) => setRevenueEndDate(e.target.value)}
                    className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-slate-50 font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                </>
              )}
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-emerald-600 text-white p-6 rounded-3xl shadow-sm">
                <span className="text-xs font-bold text-emerald-100">
                  {revenueReportType === 'gross'
                    ? (isEn ? 'Total Period Revenue' : 'إجمالي إيرادات الفترة')
                    : (isEn ? 'Period Net Profit' : 'صافي الربح للفترة')}
                </span>
                <p className="text-4xl font-black font-mono mt-2">
                  {(revenueReportType === 'gross' ? totalPeriodRevenue : totalPeriodRevenue - totalPeriodExpenses).toLocaleString()}
                  <span className="text-sm font-bold"> {isEn ? 'EGP' : 'ج.م'}</span>
                </p>
                <span className="text-xs text-emerald-100/90 block mt-2">
                  {revenueReportType === 'gross'
                    ? (isEn
                        ? `Before expenses · Net profit after deduction ${(totalPeriodRevenue - totalPeriodExpenses).toLocaleString()} EGP`
                        : `قبل خصم المصاريف · صافي الربح بعد الخصم ${(totalPeriodRevenue - totalPeriodExpenses).toLocaleString()} ج.م`)
                    : (isEn
                        ? `After expenses · Gross revenue before deduction ${totalPeriodRevenue.toLocaleString()} EGP`
                        : `بعد خصم المصاريف · إجمالي الإيرادات قبل الخصم ${totalPeriodRevenue.toLocaleString()} ج.م`)}
                </span>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <span className="text-xs font-bold text-slate-500">{isEn ? 'Total Period Expenses' : 'إجمالي المصروفات للفترة'}</span>
                <p className="text-3xl font-black text-rose-600 font-mono mt-2">
                  {totalPeriodExpenses.toLocaleString()} <span className="text-sm font-bold">{isEn ? 'EGP' : 'ج.م'}</span>
                </p>
                <span className="text-xs text-slate-400 block mt-2">{isEn ? 'All outgoing expenses during the period' : 'كافة المصاريف الخارجة خلال الفترة'}</span>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <span className="text-xs font-bold text-slate-500">{isEn ? 'Paid Appointments / Visits' : 'الحجوزات / الزيارات المسددة'}</span>
                <p className="text-3xl font-black text-blue-600 font-mono mt-2">
                  {filteredRevenueAppointments.length} <span className="text-sm font-bold">{isEn ? 'visits' : 'زيارة'}</span>
                </p>
                <span className="text-xs text-slate-400 block mt-2">{isEn ? 'Completed appointments in the period' : 'الحجوزات المكتملة بالفترة'}</span>
              </div>
            </div>

            {/* Collection channels - full width */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-black text-slate-800">{isEn ? 'Collection Channels & Payment Methods' : 'قنوات التحصيل وطرق الدفع'}</h3>
              <p className="text-xs text-slate-400 mt-0.5 mb-5">{isEn ? 'Collected amounts distributed across active payment methods · in / out / net' : 'توزيع المبالغ المحصلة على طرق الدفع النشطة · وارد / مصروف / صافي'}</p>

              <div className="space-y-5">
                {(() => {
                  const channelRows = periodReportMethods.map((method) => {
                    const revAmt = revenueMethodBreakdown[method] || 0;
                    const expAmt = expenseMethodBreakdown[method] || 0;
                    const amt = revenueReportType === 'gross' ? revAmt : revAmt - expAmt;
                    return { method, revAmt, expAmt, amt };
                  });
                  const maxAmt = Math.max(1, ...channelRows.map(c => Math.max(0, c.amt)));
                  return channelRows.map(({ method, revAmt, expAmt, amt }, idx) => {
                    const pct = Math.max(0, Math.min(100, (Math.max(0, amt) / maxAmt) * 100));
                    const displayMethod = isEn ? (
                      method === 'كاش' ? 'Cash' :
                      method === 'فيزا' ? 'Visa' :
                      method === 'إنستاباي' ? 'InstaPay' :
                      method === 'محفظة' ? 'E-Wallet' : method
                    ) : method;
                    return (
                      <div key={idx} data-testid="period-method-row" data-payment-method={method} data-revenue={revAmt} data-expense={expAmt} className="flex items-center gap-4">
                        <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5 shrink-0 min-w-[72px]">
                          {displayMethod}
                          {method === 'فيزا' ? '💳' : method === 'إنستاباي' ? '⚡' : method === 'محفظة' ? '📱' : method === 'كاش' ? '💵' : ''}
                        </span>
                        <div className="flex-1 bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-end shrink-0">
                          <span className="font-mono font-black text-slate-800 text-sm block">{amt.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {isEn
                              ? `Out ${expAmt.toLocaleString()} · Net ${(revAmt - expAmt).toLocaleString()}`
                              : `مصروف ${expAmt.toLocaleString()} · صافي ${(revAmt - expAmt).toLocaleString()}`}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Detailed receipts register - full width */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800">{isEn ? 'Detailed Receipts Register' : 'سجل المقبوضات التفصيلي'}</h3>
                <span className="text-xs bg-slate-100 px-2.5 py-0.5 rounded-full font-bold text-slate-500">
                  {filteredRevenueAppointments.length} {isEn ? 'records' : 'حركة'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 mb-3">{isEn ? 'All financial transactions received and confirmed during the selected period' : 'كافة الحركات المالية المستلمة والمؤكدة خلال الفترة المحددة'}</p>

              {filteredRevenueAppointments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <span className="text-2xl">🔍</span>
                  <p className="text-xs font-bold text-slate-400 mt-2">{isEn ? 'No revenues recorded during the selected period' : 'لا توجد أي إيرادات مسجلة خلال الفترة المحددة'}</p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-slate-100">
                    {filteredRevenueAppointments.slice(0, revenuesLimit).map((app, idx) => {
                      const amt = app.paidAmount !== undefined ? app.paidAmount : app.price;
                      const method = formatPaymentMethod(app.paymentMethod);
                      const isPartial = app.price > 0 && amt < app.price;
                      const timeLbl = (() => {
                        if (!app.time) return '';
                        const [hh, mm] = app.time.split(':').map(Number);
                        if (isNaN(hh)) return app.time;
                        const h12 = hh % 12 === 0 ? 12 : hh % 12;
                        const suffix = isEn ? (hh < 12 ? 'AM' : 'PM') : (hh < 12 ? 'ص' : 'م');
                        return `${h12}:${String(mm || 0).padStart(2, '0')} ${suffix}`;
                      })();
                      const methodEn = method === 'كاش' ? 'Cash' : method === 'فيزا' ? 'Visa' : method === 'إنستاباي' ? 'InstaPay' : method === 'محفظة' ? 'E-Wallet' : method;
                      return (
                        <div key={idx} className="flex items-center gap-3 py-3">
                          <span className="text-xs text-slate-400 font-mono shrink-0 w-16">{timeLbl}</span>
                          <span className="font-bold text-slate-800 text-sm shrink-0">{app.patientName}</span>
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px] shrink-0">{isEn ? methodEn : method}</span>
                          <span className="flex-1 text-xs text-slate-500 truncate">
                            {app.treatmentType || (isEn ? 'Examination' : 'كشف واستشارة')}
                            {isPartial
                              ? (isEn ? ' · Partial payment' : ' · سداد جزئي')
                              : (isEn ? ' · Full payment' : ' · سداد كامل')}
                          </span>
                          <span className="font-mono font-black text-slate-800 text-sm shrink-0">{amt.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
                        </div>
                      );
                    })}
                  </div>

                  {filteredRevenueAppointments.length > revenuesLimit && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200 mt-3">
                      <span className="text-xs font-bold text-slate-500">
                        {isEn ? `Showing ${Math.min(revenuesLimit, filteredRevenueAppointments.length)} of ${filteredRevenueAppointments.length} transactions` : <>يتم عرض <span className="font-mono font-black text-emerald-600">{Math.min(revenuesLimit, filteredRevenueAppointments.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{filteredRevenueAppointments.length}</span> حركة مالية</>}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRevenuesLimit(prev => prev + 5)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
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
                </>
              )}
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
          autoShowPayment={financialModalAutoPay}
          paymentMethods={clinic.paymentMethods}
          activeShiftDate={activeShiftDate || selectedShiftDate || getEgyptTodayStr()}
          activeShiftId={activeShift?.id}
          activeShift={activeShift}
        />
      )}
    </div>
  );
}
