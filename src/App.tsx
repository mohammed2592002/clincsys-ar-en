import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { db, OperationType, handleDbError, getDocsSmart as getDocs, collection, addDoc, updateDoc, deleteDoc, doc, query, where, setDoc, clearQueryCache, clearTableCache } from './dbClient';
import { Clinic, StaffMember, Appointment } from './types';
import { getEgyptTodayStr, normalizeDateStr } from './utils/timeUtils';
import { useDialogs } from './components/DialogContext';
import LoginScreen from './components/LoginScreen';
import WelcomeLoader from './components/WelcomeLoader';
import LanguageSwitcher from './components/LanguageSwitcher';

// Resilient dynamic component importer with offline fallback and error handling
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((error) => {
      console.warn('[LazyLoad] Dynamic import failed (possibly offline):', error);
      const FallbackComponent: React.FC<any> = () => (
        <div className="flex flex-col items-center justify-center p-8 bg-white border border-rose-200 rounded-3xl shadow-xs my-6 text-center space-y-4 max-w-lg mx-auto" dir="rtl">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-black text-xl">
            ⚠️
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-800 mb-1">تعذر تحميل الشاشة في وضع الأوفلاين</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              لم يتم تخزين ملفات هذه الشاشة مؤقتاً قبل انقطاع الاتصال. يرجى الاتصال بالإنترنت وفتح التطبيق مرة واحدة لحفظ جميع شاشات النظام للعمل بدون إنترنت.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>إعادة التحميل</span>
            <span>🔄</span>
          </button>
        </div>
      );
      return { default: FallbackComponent as unknown as T };
    })
  );
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state: { hasError: boolean } = { hasError: false };

  constructor(props: { children: React.ReactNode }) {
    super(props);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Render error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-white border border-rose-200 rounded-3xl shadow-xs my-10 text-center space-y-4 max-w-lg mx-auto" dir="rtl">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-black text-xl">
            ⚠️
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-800 mb-1">حدث خطأ غير متوقع أثناء الفتح</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              يرجى إعادة تحميل الصفحة. عند توفر اتصال بالإنترنت قم بفتح كافة شاشات العيادة مرة واحدة لتحديث الذاكرة المؤقتة.
            </p>
          </div>
          <button
            onClick={() => {
              (this as any).setState({ hasError: false });
              window.location.reload();
            }}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
          >
            <span>إعادة التشغيل</span>
            <span>🔄</span>
          </button>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// Dynamic code splitting for heavy sub-dashboards with offline retry support
const PatientsManager = lazyWithRetry(() => import('./components/PatientsManager'));
const InteractiveCalendar = lazyWithRetry(() => import('./components/InteractiveCalendar'));
const PatientMedicalFile = lazyWithRetry(() => import('./components/PatientMedicalFile'));
const PrescriptionGenerator = lazyWithRetry(() => import('./components/PrescriptionGenerator'));
const ClinicFinancials = lazyWithRetry(() => import('./components/ClinicFinancials'));
const LabTrackingView = lazyWithRetry(() => import('./components/LabTrackingView'));
const SuperAdminDashboard = lazyWithRetry(() => import('./components/SuperAdminDashboard'));
const ClinicSettings = lazyWithRetry(() => import('./components/ClinicSettings'));
import DailyBackupReminderBanner from './components/DailyBackupReminderBanner';
import DatabaseNoticeModal from './components/DatabaseNoticeModal';
import { 
  fetchNetworkTime, 
  getRealDate, 
  isClinicExpired, 
  formatDateTime,
  formatRemainingTime
} from './utils/timeUtils';
import { safeStorage } from './utils/storage';
import { resizeImageToWidth190 } from './utils';

import { 
  Users, 
  Plus, 
  Trash2, 
  Edit, 
  LogOut, 
  Activity, 
  Lock, 
  Mail, 
  Building2, 
  ShieldCheck, 
  Key, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  Eye, 
  EyeOff, 
  LayoutDashboard,
  Power,
  Calendar,
  FileText,
  FileSpreadsheet,
  TrendingUp,
  Settings,
  Receipt,
  UserCheck,
  Briefcase,
  FileImage,
  UserPlus,
  Shield,
  KeyRound,
  Edit2,
  X,
  Database,
  Download,
  Upload,
  HardDrive,
  Beaker,
  Sparkles,
  Info,
  HelpCircle,
  Megaphone
} from 'lucide-react';

type SessionState = 
  | { type: 'logged_out' }
  | { type: 'admin' }
  | { type: 'clinic'; clinicId: string; clinicName: string }
  | { type: 'clinic_staff'; clinicId: string; clinicName: string; staffName?: string; staffRole?: string; allowedTabs?: string[] };

export default function App() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [session, setSession] = useState<SessionState>({ type: 'logged_out' });
  const currentClinicId = (session.type === 'clinic' || session.type === 'clinic_staff') ? session.clinicId : '';
  const currentClinicName = (session.type === 'clinic' || session.type === 'clinic_staff') ? session.clinicName : '';
  const [loadingSession, setLoadingSession] = useState(true);
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);

  // System-wide broadcast alerts state
  const [activeBroadcast, setActiveBroadcast] = useState<{ id: string; content: string; bgColor?: string; textColor?: string } | null>(null);
  const [dismissedBroadcastId, setDismissedBroadcastId] = useState<string | null>(null);

  useEffect(() => {
    if (session.type === 'logged_out') {
      setActiveBroadcast(null);
      return;
    }
    
    const fetchActiveBroadcast = async (retries = 1) => {
      try {
        const res = await fetch('/api/broadcasts/active');
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await res.json();
            if (data && data.id) {
              const isDismissed = localStorage.getItem('dismissed_broadcast_' + data.id) === 'true';
              if (isDismissed) {
                setDismissedBroadcastId(data.id);
              } else {
                setDismissedBroadcastId(null);
              }
            }
            setActiveBroadcast(data);
          }
        } else if (res.status === 404 || res.status === 204) {
          setActiveBroadcast(null);
        }
      } catch (err) {
        if (retries > 0) {
          setTimeout(() => fetchActiveBroadcast(retries - 1), 1000);
        } else {
          console.warn('Error fetching broadcast announcement:', err);
        }
      }
    };
    
    fetchActiveBroadcast();
    const interval = setInterval(fetchActiveBroadcast, 3000); // Fast 3s polling for real-time announcements without manual refresh
    return () => clearInterval(interval);
  }, [session.type]);

  // Preload all component bundles in background so they are ready in Service Worker cache for offline use
  useEffect(() => {
    if (session.type !== 'logged_out') {
      const preloadModules = () => {
        import('./components/PatientsManager').catch(() => {});
        import('./components/InteractiveCalendar').catch(() => {});
        import('./components/PatientMedicalFile').catch(() => {});
        import('./components/PrescriptionGenerator').catch(() => {});
        import('./components/ClinicFinancials').catch(() => {});
        import('./components/LabTrackingView').catch(() => {});
        import('./components/ClinicSettings').catch(() => {});
      };

      if (typeof window !== 'undefined') {
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(preloadModules, { timeout: 3000 });
        } else {
          setTimeout(preloadModules, 1000);
        }
      }
    }
  }, [session.type]);

  // Login Form States
  const [loginRole, setLoginRole] = useState<'manager' | 'staff'>('manager');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showWelcomeLoader, setShowWelcomeLoader] = useState(false);

  // Nav Tabs
  const [clinicActiveTab, setClinicActiveTab] = useState<'patients' | 'calendar' | 'medical_files' | 'prescriptions' | 'analytics' | 'settings' | 'financials' | 'laboratory'>('patients');
  const [selectedPatientIdForFile, setSelectedPatientIdForFile] = useState<string>('');
  const [prescriptionInitialPatientId, setPrescriptionInitialPatientId] = useState<string>('');
  const [medicalFileInitialTab, setMedicalFileInitialTab] = useState<'visits' | 'prescriptions' | 'financials' | null>(null);
  const [adminActiveTab, setAdminActiveTab] = useState<'clinics' | 'renewals'>('clinics');

  const [currentClinicData, setCurrentClinicData] = useState<Clinic | null>(null);
  const [staffPinInput, setStaffPinInput] = useState('1234');
  const [nowTick, setNowTick] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const [sharedAppointments, setSharedAppointments] = useState<Appointment[]>([]);
  const sharedAppointmentsRef = useRef<Appointment[]>([]);
  useEffect(() => {
    sharedAppointmentsRef.current = sharedAppointments;
  }, [sharedAppointments]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [loadingActiveShift, setLoadingActiveShift] = useState(false);

  const getTodayDateString = () => {
    return getEgyptTodayStr();
  };

  const getEgyptWeekBounds = (targetDateStr?: string) => {
    const baseStr = (targetDateStr && targetDateStr !== 'all') ? targetDateStr : getEgyptTodayStr();
    const parts = baseStr.split('-').map(Number);
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayOfWeek = dateObj.getDay(); // 0:Sun, 1:Mon, 2:Tue, 3:Wed, 4:Thu, 5:Fri, 6:Sat
    const diffToSaturday = dayOfWeek === 6 ? 0 : -(dayOfWeek + 1);
    const sat = new Date(dateObj);
    sat.setDate(dateObj.getDate() + diffToSaturday);
    const fri = new Date(sat);
    fri.setDate(sat.getDate() + 6);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startDate = `${sat.getFullYear()}-${pad(sat.getMonth() + 1)}-${pad(sat.getDate())}`;
    const endDate = `${fri.getFullYear()}-${pad(fri.getMonth() + 1)}-${pad(fri.getDate())}`;
    return { startDate, endDate };
  };

  const fetchSharedAppointments = async (silent: boolean | any = false, targetDate?: string, force = false) => {
    if (!currentClinicId) return;
    
    const isSilent = typeof silent === 'boolean' ? silent : false;
    
    if (!isSilent) setLoadingAppointments(true);
    try {
      const ref = collection(db, 'clinics', currentClinicId, 'appointments');
      let q;
      let rangeStartDate = '';
      let rangeEndDate = '';

      if (targetDate === 'all') {
        q = ref;
      } else {
        const bounds = getEgyptWeekBounds(targetDate);
        rangeStartDate = bounds.startDate;
        rangeEndDate = bounds.endDate;
        q = query(ref, where('date', '>=', rangeStartDate), where('date', '<=', rangeEndDate));
      }

      const snap = await getDocs(q, force);
      const list: Appointment[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const rawDate = data.date || data.appointmentDate || '';
        const normDate = normalizeDateStr(rawDate) || rawDate;
        list.push({
          id: docSnap.id,
          patientId: data.patientId || '',
          patientName: data.patientName || '',
          patientPhone: data.patientPhone || '',
          date: normDate,
          time: data.time || '10:00',
          treatmentType: data.treatmentType || '',
          price: Number(data.price) || 0,
          notes: data.notes || '',
          status: data.status || 'scheduled',
          paidAmount: data.paidAmount !== undefined ? Number(data.paidAmount) : undefined,
          remainingAmount: data.remainingAmount !== undefined ? Number(data.remainingAmount) : undefined,
          invoiceStatus: data.invoiceStatus || (data.remainingAmount === 0 ? 'paid' : (data.paidAmount ? 'installment' : 'draft')),
          financialNote: data.financialNote || '',
          paymentMethod: data.paymentMethod || undefined,
          toothNumber: data.toothNumber !== undefined ? Number(data.toothNumber) : undefined,
          procedures: data.procedures || [],
          shiftId: data.shiftId || undefined,
          payments: data.payments || []
        });
      });
      
      // Automatically find and merge any multiple non-cancelled appointments for the same patient on the same day.
      // This enforces that each patient has exactly one non-cancelled appointment card per day.
      const patientGroups: Record<string, Appointment[]> = {};
      list.forEach((app) => {
        if (app.patientId && app.status !== 'cancelled') {
          const groupKey = `${app.patientId}_${app.date}`;
          if (!patientGroups[groupKey]) {
            patientGroups[groupKey] = [];
          }
          patientGroups[groupKey].push(app);
        }
      });

      const mergedList: Appointment[] = [...list];

      for (const groupKey of Object.keys(patientGroups)) {
        const group = patientGroups[groupKey];
        if (group.length > 1) {
          console.log(`[Deduplication] Found ${group.length} duplicate appointments for group ${groupKey}. Merging...`);
          
          // Sort to prioritize keeping the primary one (completed/installment/paid, or having procedures, or earlier time)
          group.sort((a, b) => {
            const statusOrder = { completed: 3, installment: 2, paid: 1, waiting: 0, scheduled: -1 } as any;
            const aOrder = statusOrder[a.status] !== undefined ? statusOrder[a.status] : -2;
            const bOrder = statusOrder[b.status] !== undefined ? statusOrder[b.status] : -2;
            if (bOrder !== aOrder) return bOrder - aOrder;
            
            const aProcs = a.procedures?.length || 0;
            const bProcs = b.procedures?.length || 0;
            if (bProcs !== aProcs) return bProcs - aProcs;
            
            return a.time.localeCompare(b.time); // prefer earlier time
          });

          const primary = { ...group[0] };
          const duplicates = group.slice(1);

          // Accumulate from duplicates into primary
          let combinedTreatment = primary.treatmentType || '';
          let combinedPrice = Number(primary.price) || 0;
          let combinedPaid = Number(primary.paidAmount) || 0;
          let combinedNotes = primary.notes || '';
          const combinedProcedures = primary.procedures ? [...primary.procedures] : [];
          const combinedPayments = primary.payments ? [...primary.payments] : [];

          // If primary has paidAmount > 0 but payments array is empty, reconstruct its initial payment
          if (combinedPayments.length === 0 && combinedPaid > 0) {
            combinedPayments.push({
              id: 'pay_init_' + primary.id,
              amount: combinedPaid,
              paymentMethod: primary.paymentMethod || 'كاش',
              date: primary.date || getEgyptTodayStr(),
              createdAt: new Date().toISOString(),
              notes: 'الدفعة الأولى',
              type: 'initial'
            });
          }

          // If primary didn't have procedures but had a treatmentType, build initial procedure
          if (combinedProcedures.length === 0 && combinedTreatment) {
            combinedProcedures.push({
              name: combinedTreatment,
              price: combinedPrice,
              tooth: primary.toothNumber || null
            });
          }

          for (const dup of duplicates) {
            // Merge treatmentType
            if (dup.treatmentType) {
              if (combinedTreatment) {
                if (!combinedTreatment.includes(dup.treatmentType)) {
                  combinedTreatment = `${combinedTreatment} + ${dup.treatmentType}`;
                }
              } else {
                combinedTreatment = dup.treatmentType;
              }
            }

            // Merge price and paid amount
            combinedPrice += Number(dup.price) || 0;
            combinedPaid += Number(dup.paidAmount) || 0;

            // Merge notes
            if (dup.notes) {
              combinedNotes = combinedNotes ? `${combinedNotes}\n${dup.notes}` : dup.notes;
            }

            // Merge procedures list
            const dupProcs = dup.procedures && dup.procedures.length > 0
              ? dup.procedures
              : dup.treatmentType ? [{ name: dup.treatmentType, price: Number(dup.price) || 0, tooth: dup.toothNumber || null }] : [];

            for (const p of dupProcs) {
              const isDup = combinedProcedures.some(cp => cp.name === p.name && cp.price === p.price && cp.tooth === (p.tooth || null));
              if (!isDup) {
                combinedProcedures.push({
                  name: p.name,
                  price: Number(p.price) || 0,
                  tooth: p.tooth || null
                });
              }
            }

            // Merge payments list
            if (dup.payments && dup.payments.length > 0) {
              for (const pay of dup.payments) {
                const isDup = combinedPayments.some(cp => cp.id === pay.id);
                if (!isDup) {
                  combinedPayments.push(pay);
                }
              }
            } else if (Number(dup.paidAmount) > 0) {
              combinedPayments.push({
                id: 'pay_dup_' + dup.id,
                amount: Number(dup.paidAmount),
                paymentMethod: dup.paymentMethod || 'كاش',
                date: dup.date || getEgyptTodayStr(),
                createdAt: new Date().toISOString(),
                notes: 'دفعة من موعد مدمج',
                type: 'initial'
              });
            }

            // Delete duplicate appointment from DB
            try {
              const dupRef = doc(db, 'clinics', currentClinicId, 'appointments', dup.id);
              await deleteDoc(dupRef);
              console.log(`[Deduplication] Deleted duplicate appointment ID: ${dup.id}`);
            } catch (err) {
              console.error(`[Deduplication] Failed to delete duplicate app ${dup.id}:`, err);
            }

            // Update patient records that pointed to duplicate appointment ID to point to primary ID
            try {
              const recordsRef = collection(db, 'clinics', currentClinicId, 'patients', primary.patientId, 'records');
              const rSnap = await getDocs(query(recordsRef, where('appointmentId', '==', dup.id)));
              for (const rDoc of rSnap.docs) {
                const rRef = doc(db, 'clinics', currentClinicId, 'patients', primary.patientId, 'records', rDoc.id);
                await updateDoc(rRef, { appointmentId: primary.id });
                console.log(`[Deduplication] Updated record ${rDoc.id} to link to primary appointment ${primary.id}`);
              }
            } catch (err) {
              console.error(`[Deduplication] Failed to link duplicate app records:`, err);
            }
          }

          // Recalculate remainingAmount and status
          const combinedRem = Math.max(0, combinedPrice - combinedPaid);
          let invStatus = primary.invoiceStatus;
          if (combinedPrice > 0) {
            if (combinedRem <= 0 && combinedPaid >= combinedPrice) invStatus = 'paid';
            else if (combinedPaid > 0) invStatus = 'installment';
            else invStatus = 'pending_payment';
          }

          const updatedPrimaryData = {
            ...primary,
            treatmentType: combinedTreatment,
            price: combinedPrice,
            paidAmount: combinedPaid,
            remainingAmount: combinedRem,
            invoiceStatus: invStatus,
            notes: combinedNotes,
            procedures: combinedProcedures,
            payments: combinedPayments,
            status: (primary.status === 'scheduled' || primary.status === 'waiting' ? primary.status : 'completed') as any
          };

          // Save updated primary appointment to DB
          try {
            const primaryRef = doc(db, 'clinics', currentClinicId, 'appointments', primary.id);
            await setDoc(primaryRef, updatedPrimaryData);
            console.log(`[Deduplication] Successfully merged duplicates into primary appointment ID: ${primary.id}`);
          } catch (err) {
            console.error(`[Deduplication] Failed to update primary appointment ${primary.id}:`, err);
          }

          // Remove duplicates from mergedList and update the primary item
          const idx = mergedList.findIndex(item => item.id === primary.id);
          if (idx !== -1) {
            mergedList[idx] = updatedPrimaryData;
          }
          duplicates.forEach(dup => {
            const dupIdx = mergedList.findIndex(item => item.id === dup.id);
            if (dupIdx !== -1) {
              mergedList.splice(dupIdx, 1);
            }
          });
        }
      }
      
      mergedList.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.time.localeCompare(b.time);
      });

      if (targetDate === 'all') {
        setSharedAppointments(mergedList);
      } else {
        setSharedAppointments((prev) => {
          const fetchedIds = new Set(mergedList.map(a => a.id));
          const filteredPrev = prev.filter(item => {
            if (rangeStartDate && rangeEndDate && item.date >= rangeStartDate && item.date <= rangeEndDate) {
              return fetchedIds.has(item.id);
            }
            return true;
          });

          const map = new Map<string, Appointment>();
          filteredPrev.forEach(item => map.set(item.id, item));
          mergedList.forEach(item => map.set(item.id, item));

          const result = Array.from(map.values());
          result.sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            return a.time.localeCompare(b.time);
          });
          return result;
        });
      }
    } catch (err) {
      console.error('Error fetching shared appointments:', err);
    } finally {
      if (!isSilent) setLoadingAppointments(false);
    }
  };

  const fetchActiveShift = async (silent = false) => {
    if (!currentClinicId) return;
    if (!silent) setLoadingActiveShift(true);
    try {
      const { collection, getDocs, query, where, db } = await import('./dbClient');
      const shiftsRef = collection(db, 'clinics', currentClinicId, 'shifts');
      const q = query(shiftsRef, where('status', '==', 'open'));
      const snap = await getDocs(q);
      if (!snap.empty) {
        // Sort in memory to make sure we pick the latest opened shift (resilience)
        const docs = [...snap.docs];
        docs.sort((a, b) => {
          const aData = a.data();
          const bData = b.data();
          const aTime = aData.openedAt ? new Date(aData.openedAt).getTime() : 0;
          const bTime = bData.openedAt ? new Date(bData.openedAt).getTime() : 0;
          return bTime - aTime;
        });

        // Heal duplicate open shifts left from older bugs
        if (docs.length > 1) {
          const { doc, updateDoc } = await import('./dbClient');
          for (const staleDoc of docs.slice(1)) {
            const staleData = staleDoc.data();
            const startCash = Number(staleData.startCash) || 0;
            const staleRef = doc(db, 'clinics', currentClinicId, 'shifts', staleDoc.id);
            await updateDoc(staleRef, {
              status: 'closed',
              closedAt: new Date().toISOString(),
              closedBy: 'النظام',
              expectedCash: startCash,
              actualCash: startCash,
              discrepancy: 0,
              expensesTotal: 0,
              totalRevenue: 0,
              notes: `${staleData.notes || ''} [تم الإغلاق تلقائياً - وردية مفتوحة مكررة]`.trim()
            });
          }
        }

        const docSnap = docs[0];
        setActiveShift({ id: docSnap.id, ...docSnap.data() });
      } else {
        setActiveShift(null);
      }
    } catch (err) {
      console.error('Error fetching active shift:', err);
    } finally {
      if (!silent) setLoadingActiveShift(false);
    }
  };

  const effectiveSyncClinicId = currentClinicId || (session.type === 'superadmin' ? 'superadmin' : '');

  useEffect(() => {
    if (effectiveSyncClinicId) {
      if (currentClinicId) {
        fetchSharedAppointments();
        fetchActiveShift();
      }

      console.log(`[Sync Engine] Initializing instant WebSocket synchronization for ${effectiveSyncClinicId}...`);
      let socket: WebSocket | null = null;
      let reconnectTimeout: any = null;
      let pingInterval: any = null;
      let pollingInterval: any = null;
      let isUnmounted = false;
      let consecutiveErrors = 0;
      let lastFetchedTimestamp = Date.now() - 30000; // Track last event timestamp, adjust for potential clock mismatch
      const processedEventIds = new Set<string>();

      function processSyncEvent(eventData: any) {
        // Instantly clear client-side query cache so that subsequent requests get fresh data
        if (eventData.table) {
          clearTableCache(eventData.table);
        } else {
          clearQueryCache();
        }
        
        // Merge Delta Payloads directly into in-memory state variables to avoid fetching again
        if (eventData.payload && currentClinicId) {
          const payload = eventData.payload;
          const { table, action } = eventData;
          
          if (table === 'appointments') {
            setSharedAppointments((prev) => {
              if (action === 'add' || action === 'set') {
                const idx = prev.findIndex(item => item.id === payload.id);
                if (idx !== -1) {
                  const next = [...prev];
                  next[idx] = { ...next[idx], ...payload };
                  return next;
                }
                return [...prev, payload];
              } else if (action === 'update') {
                return prev.map(item => item.id === payload.id ? { ...item, ...payload } : item);
              } else if (action === 'delete') {
                return prev.filter(item => item.id !== payload.id);
              }
              return prev;
            });
          } else if (table === 'shifts') {
            if (action === 'delete') {
              setActiveShift((prev: any) => prev && prev.id === payload.id ? null : prev);
            } else {
              if (payload.status === 'open') {
                setActiveShift(payload);
              } else {
                setActiveShift((prev: any) => prev && prev.id === payload.id ? null : prev);
              }
            }
          }
        }
        
        // Dispatch custom window event so that specific panels/views (including SuperAdminDashboard) reload their data instantly
        window.dispatchEvent(new CustomEvent('clinic-sync', { detail: eventData }));
      }

      // HTTP Polling Fallback for environments where WebSockets are closed or unstable
      const pollForUpdates = async () => {
        if (!effectiveSyncClinicId || isUnmounted) return;
        try {
          const res = await fetch(`/api/sync/updates?clinicId=${encodeURIComponent(effectiveSyncClinicId)}&since=${lastFetchedTimestamp}`);
          if (!res.ok) return;
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) return;
          const events = await res.json();
          if (Array.isArray(events) && events.length > 0) {
            console.log(`[Sync Engine] Polling retrieved ${events.length} new sync events.`);
            events.forEach((evt) => {
              if (evt.id && processedEventIds.has(evt.id)) return;
              if (evt.id) processedEventIds.add(evt.id);
              
              if (evt.createdAt > lastFetchedTimestamp) {
                lastFetchedTimestamp = evt.createdAt;
              }
              
              processSyncEvent({
                eventId: evt.id,
                clinicId: evt.clinicId,
                table: evt.table,
                action: evt.action,
                recordId: evt.recordId,
                payload: evt.payload
              });
            });
          }
        } catch (err: any) {
          if (err?.name !== 'SyntaxError') {
            console.warn('[Sync Engine] Polling fallback warning:', err);
          }
        }
      };

      function startPolling(intervalMs: number) {
        if (pollingInterval) {
          clearInterval(pollingInterval);
        }
        if (!isUnmounted) {
          pollingInterval = setInterval(pollForUpdates, intervalMs);
        }
      }

      function connectWS() {
        if (!effectiveSyncClinicId || isUnmounted) return;
        if (socket) {
          socket.onclose = null;
          socket.onerror = null;
          socket.close(1000, 'Replaced connection');
        }
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/api/sync/ws?clinicId=${effectiveSyncClinicId}`;

        console.log('[Sync Engine] Connecting to WebSocket:', wsUrl);
        try {
          socket = new WebSocket(wsUrl);
        } catch (wsErr) {
          console.warn('[Sync Engine] Could not create WebSocket instance:', wsErr);
          startPolling(5000);
          return;
        }

        socket.onopen = () => {
          console.log('[Sync Engine] WebSocket connection established successfully.');
          consecutiveErrors = 0;
          // Keep active polling as a gentle safety background check every 15s alongside WebSocket
          startPolling(15000);

          pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping' }));
            }
          }, 25000);
        };

        socket.onmessage = (event) => {
          try {
            const eventData = JSON.parse(event.data);
            
            if (eventData.eventId) {
              if (processedEventIds.has(eventData.eventId)) {
                return;
              }
              processedEventIds.add(eventData.eventId);
            }

            console.log('[Sync Engine] Received real-time update event:', eventData);
            processSyncEvent(eventData);
          } catch (e) {
            // Ignore parse issues or heartbeats
          }
        };

        socket.onclose = (event) => {
          console.log('[Sync Engine] WebSocket connection closed.', event.reason, 'Code:', event.code);
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }
          
          // Switch to fast polling while disconnected
          startPolling(5000);
          
          // Continuously reconnect with exponential backoff capped at 10 seconds
          if (!isUnmounted) {
            consecutiveErrors++;
            const delay = Math.min(1000 * Math.pow(1.5, Math.min(consecutiveErrors, 8)), 10000);
            console.log(`[Sync Engine] Reconnecting WS in ${Math.round(delay)}ms... (Attempt ${consecutiveErrors})`);
            reconnectTimeout = setTimeout(() => {
              if (!isUnmounted) {
                connectWS();
              }
            }, delay);
          }
        };

        socket.onerror = (err) => {
          console.warn('[Sync Engine] WebSocket encountered an error:', err);
        };
      }

      // Initialize both polling and WebSocket
      startPolling(5000);
      connectWS();

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log('[Sync Engine] App became visible. Refreshing caches and reconnecting...');
          clearQueryCache();
          if (currentClinicId) {
            fetchSharedAppointments(true, getTodayDateString(), true);
            fetchActiveShift(true);
          }
          consecutiveErrors = 0;
          lastFetchedTimestamp = Date.now() - 30000;
          startPolling(5000);
          connectWS();
        } else {
          console.log('[Sync Engine] App hidden. Cleaning up active sockets and timers to save resources.');
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }
          if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
          }
          if (socket) {
            socket.onclose = null;
            socket.onerror = null;
            socket.close(1000, 'App hidden');
            socket = null;
          }
          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }
        }
      };

      const handleClinicSyncEvent = (e: Event) => {
        const customEvent = e as CustomEvent;
        const { table, id, payload } = customEvent.detail || {};
        console.log('[App] Received clinic-sync custom window event for table:', table);
        if (currentClinicId) {
          if (table === 'appointments' || table === 'records' || table === 'patients') {
            clearTableCache('appointments');
            clearTableCache('records');
            clearTableCache('patients');
            let affectedDate = payload?.date;
            if (!affectedDate && id && table === 'appointments') {
              const existingApp = sharedAppointmentsRef.current.find(a => a.id === id);
              if (existingApp) {
                affectedDate = existingApp.date;
              }
            }
            const todayStr = getEgyptTodayStr();
            const target = affectedDate || todayStr;
            fetchSharedAppointments(true, target, true);
            if (target !== todayStr) {
              fetchSharedAppointments(true, todayStr, true);
            }
          } else if (table === 'shifts') {
            fetchActiveShift(true);
          }
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('clinic-sync', handleClinicSyncEvent);

      return () => {
        isUnmounted = true;
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('clinic-sync', handleClinicSyncEvent);
        if (pingInterval) {
          clearInterval(pingInterval);
        }
        if (pollingInterval) {
          clearInterval(pollingInterval);
        }
        if (socket) {
          socket.onclose = null;
          socket.onerror = null;
          socket.close(1000, 'Component unmounted');
        }
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
        }
      };
    } else {
      setSharedAppointments([]);
      setActiveShift(null);
    }
  }, [effectiveSyncClinicId]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    if ((session.type === 'clinic' || session.type === 'clinic_staff') && currentClinicId) {
      import('./dbClient').then(({ doc, onSnapshot, getDoc }) => {
        const clinicDocRef = doc(db, 'clinics', currentClinicId);

        const parseDocToClinic = (docSnap: any): Clinic | null => {
          if (!docSnap || !docSnap.exists()) return null;
          const data = docSnap.data();
          const storedBookingMode = safeStorage.getItem(`clinic_booking_mode_${docSnap.id}`);
          return {
            ...data,
            id: docSnap.id,
            name: data.name || 'عيادة الدكتور لطب وجراحة الأسنان',
            nameAr: data.nameAr || '',
            nameEn: data.nameEn || '',
            logoUrl: data.logoUrl || '',
            doctorName: data.doctorName || '',
            doctorNameEn: data.doctorNameEn || '',
            doctorPhone: data.doctorPhone || '',
            doctorSpecialtyAr: data.doctorSpecialtyAr || '',
            doctorSpecialtyEn: data.doctorSpecialtyEn || '',
            clinicHours: data.clinicHours || '',
            address: data.address || '',
            prescriptionStyle: data.prescriptionStyle || 'classic',
            prescriptionLayout: data.prescriptionLayout || 'traditional',
            bookingSystemMode: data.bookingSystemMode || (storedBookingMode as any) || 'hybrid',
            email: data.email || '',
            password: data.password || '',
            createdAt: data.createdAt || '',
            isActive: data.isActive !== false,
            subscriptionExpiresAt: data.subscriptionExpiresAt || '',
            staffPin: data.staffPin || '1234',
            staffMembers: data.staffMembers || [],
            consultationPrice: data.consultationPrice !== undefined ? Number(data.consultationPrice) : 0,
            additionalPhones: data.additionalPhones || [],
            paymentMethods: data.paymentMethods || undefined,
            allowedFeatures: data.allowedFeatures || undefined,
            customDentalServices: data.customDentalServices || undefined,
            dentalServiceCategories: data.dentalServiceCategories || undefined,
            customPrescriptionPadConfig: data.customPrescriptionPadConfig || undefined,
            loyaltyProgramEnabled: data.loyaltyProgramEnabled !== false,
            loyaltyEarnEgpThreshold: data.loyaltyEarnEgpThreshold !== undefined ? Number(data.loyaltyEarnEgpThreshold) : 100,
            loyaltyEarnPoints: data.loyaltyEarnPoints !== undefined ? Number(data.loyaltyEarnPoints) : 20,
            loyaltyRedeemPointsThreshold: data.loyaltyRedeemPointsThreshold !== undefined ? Number(data.loyaltyRedeemPointsThreshold) : 1000,
            loyaltyRedeemDiscountEgp: data.loyaltyRedeemDiscountEgp !== undefined ? Number(data.loyaltyRedeemDiscountEgp) : 250,
            loyaltyMinRedeemPoints: data.loyaltyMinRedeemPoints !== undefined ? Number(data.loyaltyMinRedeemPoints) : 0,
            questionnaireQuestions: data.questionnaireQuestions || [],
            autoBackupEnabled: data.autoBackupEnabled,
            autoBackupFormat: data.autoBackupFormat,
          };
        };

        getDoc(clinicDocRef).then((snap) => {
          const parsed = parseDocToClinic(snap);
          if (parsed) setCurrentClinicData(parsed);
        }).catch(err => console.warn('Error fetching clinic doc:', err));

        if (typeof onSnapshot === 'function') {
          unsub = onSnapshot(clinicDocRef, (snap) => {
            const parsed = parseDocToClinic(snap);
            if (parsed) setCurrentClinicData(parsed);
          });
        }
      }).catch(err => console.error('Error importing dbClient for clinic listener:', err));
    } else {
      setCurrentClinicData(null);
    }
    return () => {
      if (unsub) unsub();
    };
  }, [session, currentClinicId]);

  // Tab permission redirection for doctor/manager and staff based on Super Admin allowedFeatures
  useEffect(() => {
    if (session.type === 'clinic' || session.type === 'clinic_staff') {
      const clinicFeatures = currentClinicData?.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];
      
      let allowed = clinicFeatures;
      if (session.type === 'clinic_staff') {
        const staffTabs = session.allowedTabs || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];
        allowed = staffTabs.filter(t => clinicFeatures.includes(t));
      }
      
      // Settings tab is always allowed for manager, but never for staff
      const isSettingsTab = clinicActiveTab === 'settings';
      const isMedicalFilesTab = clinicActiveTab === 'medical_files';
      
      if (session.type === 'clinic' && isSettingsTab) {
        return; // always allowed
      }
      
      if (isMedicalFilesTab && allowed.includes('patients')) {
        return; // sub-tab of patients, which is allowed
      }
      
      if (allowed.length > 0 && !allowed.includes(clinicActiveTab as string)) {
        setClinicActiveTab(allowed[0] as any);
      }
    }
  }, [session, clinicActiveTab, currentClinicData?.allowedFeatures]);

  // Restore session on mount
  useEffect(() => {
    const initApp = async () => {
      // Fetch precise network time on app initialization
      try {
        await fetchNetworkTime();
      } catch (e) {
        console.error("Error fetching network time:", e);
      }

      const saved = safeStorage.getItem('dental_saas_session');
      if (saved) {
        try {
          const parsedSession = JSON.parse(saved);
          // If the saved session is a clinic or staff, verify if subscription is still valid
          if (parsedSession.type === 'clinic' || parsedSession.type === 'clinic_staff') {
            try {
              const { doc, getDoc } = await import('./dbClient');
              const clinicDocRef = doc(db, 'clinics', parsedSession.clinicId);
              const clinicDoc = await getDoc(clinicDocRef);
              if (clinicDoc.exists()) {
                const data = clinicDoc.data();
                const clinicObj: Clinic = {
                  id: clinicDoc.id,
                  name: data.name || '',
                  email: data.email || '',
                  password: data.password || '',
                  createdAt: data.createdAt || '',
                  isActive: data.isActive !== false,
                  subscriptionExpiresAt: data.subscriptionExpiresAt || '',
                  staffPin: data.staffPin || '1234',
                  staffMembers: data.staffMembers || []
                };
                
                // If it's a settings pin restore
                if (data.staffPin) {
                  setStaffPinInput(data.staffPin);
                }
              }
            } catch (err) {
              console.error("Error verifying active clinic session:", err);
            }
          }
          setSession(parsedSession);
        } catch (e) {
          console.error("Error parsing saved session", e);
        }
      }
      setLoadingSession(false);
    };

    initApp();
  }, []);

  // Save session to local storage
  const saveSession = (newSess: SessionState) => {
    setSession(newSess);
    safeStorage.setItem('dental_saas_session', JSON.stringify(newSess));
  };

  const handleLogout = () => {
    setSession({ type: 'logged_out' });
    safeStorage.removeItem('dental_saas_session');
    // Clear forms
    setLoginEmail('');
    setLoginPassword('');
    setLoginError('');
  };

  // Handle custom login flow
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    const emailClean = loginEmail.trim().toLowerCase();
    const passClean = loginPassword.trim();

    if (!emailClean || !passClean) {
      setLoginError('يرجى كتابة البريد الإلكتروني وكلمة المرور/الرمز السري');
      setLoginLoading(false);
      return;
    }

    try {
      // 1. Check Super Admin credentials (only in manager mode)
      if (loginRole === 'manager') {
        try {
          const adminCheckRes = await fetch('/api/superadmin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailClean, password: passClean })
          });
          if (adminCheckRes.ok) {
            const adminData = await adminCheckRes.json();
            if (adminData.success) {
              saveSession({ type: 'admin' });
              setLoginLoading(false);
              return;
            }
          }
        } catch (err) {
          console.warn('SuperAdmin login API check error:', err);
        }
      }

      // 2. Check Clinic credentials in Firestore
      const clinicsRef = collection(db, 'clinics');
      const q = query(clinicsRef, where('email', '==', emailClean));
      let snap;
      try {
        snap = await getDocs(q);
      } catch (err: any) {
        handleDbError(err, OperationType.LIST, 'clinics');
      }

      if (snap.empty) {
        setLoginError('البريد الإلكتروني هذا غير مسجل أو غير صحيح');
        setLoginLoading(false);
        return;
      }

      let matchedClinic: Clinic | null = null;
      let matchedStaffName: string | undefined = undefined;
      let matchedStaffRole: string | undefined = undefined;
      let matchedStaffAllowedTabs: string[] | undefined = undefined;
      let credentialMatched = false;

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const staffList: StaffMember[] = data.staffMembers || [];
        const clinicData: Clinic = {
          id: docSnap.id,
          name: data.name || '',
          email: data.email || '',
          password: data.password || '',
          createdAt: data.createdAt || '',
          isActive: data.isActive !== false,
          subscriptionExpiresAt: data.subscriptionExpiresAt || '',
          staffPin: data.staffPin || '1234',
          staffMembers: staffList
        };

        if (loginRole === 'manager' && data.password === passClean) {
          matchedClinic = clinicData;
          credentialMatched = true;
        } else if (loginRole === 'staff') {
          // First check staffMembers array for individual staff login
          const foundStaff = staffList.find(m => m.password === passClean);
          if (foundStaff) {
            matchedClinic = clinicData;
            matchedStaffName = foundStaff.name;
            matchedStaffRole = foundStaff.role;
            matchedStaffAllowedTabs = foundStaff.allowedTabs;
            credentialMatched = true;
          } else if (clinicData.staffPin === passClean) {
            // Backward compatibility fallback
            matchedClinic = clinicData;
            matchedStaffName = 'طاقم العيادة';
            matchedStaffRole = 'استقبال / مساعد';
            credentialMatched = true;
          }
        }
      });

      if (credentialMatched && matchedClinic) {
        const clinicObj = matchedClinic;
        
        // Fetch fresh network time right before authentication to prevent client clock tampering
        try {
          await fetchNetworkTime();
        } catch (e) {
          console.warn('Could not sync network time before login, using offset.', e);
        }

        if (loginRole === 'manager') {
          saveSession({
            type: 'clinic',
            clinicId: clinicObj.id,
            clinicName: clinicObj.name
          });
          setStaffPinInput(clinicObj.staffPin || '1234');
          setShowWelcomeLoader(true);
        } else {
          saveSession({
            type: 'clinic_staff',
            clinicId: clinicObj.id,
            clinicName: clinicObj.name,
            staffName: matchedStaffName,
            staffRole: matchedStaffRole,
            allowedTabs: matchedStaffAllowedTabs
          });
          setShowWelcomeLoader(true);
        }
      } else {
        setLoginError(loginRole === 'manager' ? 'كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى' : 'كلمة المرور أو رمز دخول الموظف غير صحيح، يرجى التأكد من الطبيب');
      }
    } catch (err: any) {
      console.error(err);
      setLoginError('حدث خطأ أثناء تسجيل الدخول: ' + (err.message || err.toString()));
    } finally {
      setLoginLoading(false);
    }
  };



  if (loadingSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center font-sans" dir="rtl">
        <div className="bg-emerald-600 text-white p-4 rounded-2xl shadow-xl shadow-emerald-100 animate-bounce mb-4">
          <Activity className="h-8 w-8 animate-pulse" />
        </div>
        <p className="text-sm font-bold text-slate-700">جاري تحميل النظام السحابي...</p>
        <p className="text-xs text-slate-400 mt-1">التحقق من حالة اتصال قواعد البيانات</p>
      </div>
    );
  }

  // 1. Logged Out (Show Login screen)
  if (session.type === 'logged_out') {
    return (
      <>
        <DatabaseNoticeModal 
          isOpen={isDbModalOpen ? true : undefined} 
          onClose={() => setIsDbModalOpen(false)} 
          autoCheckOnMount={true} 
        />
        <LoginScreen
          loginRole={loginRole}
          setLoginRole={setLoginRole}
          loginEmail={loginEmail}
          setLoginEmail={setLoginEmail}
          loginPassword={loginPassword}
          setLoginPassword={setLoginPassword}
          loginError={loginError}
          setLoginError={setLoginError}
          loginLoading={loginLoading}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          handleLoginSubmit={handleLoginSubmit}
          onOpenDbNotice={() => setIsDbModalOpen(true)}
        />
      </>
    );
  }

  // 2. Admin Dashboard (Manage Clinics)
  if (session.type === 'admin') {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center font-sans" dir="rtl">
          <div className="w-10 h-10 rounded-full border-3 border-slate-200 border-t-emerald-600 animate-spin mb-4"></div>
          <p className="text-sm font-bold text-slate-700">جاري تحميل لوحة المشرف...</p>
        </div>
      }>
        <DatabaseNoticeModal 
          isOpen={isDbModalOpen ? true : undefined} 
          onClose={() => setIsDbModalOpen(false)} 
          autoCheckOnMount={true} 
        />
        <DailyBackupReminderBanner session={session} />
        <SuperAdminDashboard
          saveSession={saveSession}
          handleLogout={handleLogout}
        />
      </Suspense>
    );
  }

  // 3. Clinic System Dashboard (Isolated Patients Management)
  const isStaff = session.type === 'clinic_staff';
  const staffAllowedTabs: string[] = (isStaff && session.allowedTabs) 
    ? session.allowedTabs 
    : ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];

  const allowedFeatures = currentClinicData?.allowedFeatures || ['patients', 'calendar', 'prescriptions', 'laboratory', 'financials'];
  
  const currentClinicInfo: Clinic = currentClinicData || {
    id: currentClinicId,
    name: currentClinicName,
    email: '',
    password: '',
    createdAt: '',
    subscriptionExpiresAt: ''
  };

  // Check subscription warning (expires within 3 days)
  let remainingDaysText = '';
  let showSubscriptionWarning = false;
  if (currentClinicInfo.subscriptionExpiresAt) {
    const expiresAt = new Date(currentClinicInfo.subscriptionExpiresAt);
    if (!isNaN(expiresAt.getTime())) {
      const diffMs = expiresAt.getTime() - getRealDate().getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > 0 && diffDays <= 3) {
        showSubscriptionWarning = true;
        const days = Math.floor(diffDays);
        const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        remainingDaysText = `تنبيــــه: اشتراك عيادتكم يوشك على الانتهاء التلقائي! المتبقي المتبقي الفعلي هو: ${days} يوم و ${hours} ساعة و ${minutes} دقيقة. يرجى الاتصال بإدارة الموقع للتجديد لتجنب توقف النظام.`;
      }
    }
  }









  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-start" dir={isEn ? 'ltr' : 'rtl'}>
      <DatabaseNoticeModal 
        isOpen={isDbModalOpen ? true : undefined} 
        onClose={() => setIsDbModalOpen(false)} 
        autoCheckOnMount={true} 
      />
      {showWelcomeLoader && (
        <WelcomeLoader
          clinicName={currentClinicInfo.name}
          doctorName={currentClinicInfo.doctorName}
          logoUrl={currentClinicInfo.logoUrl}
          staffRole={session.type === 'clinic_staff' ? session.staffRole : undefined}
          durationMs={3000}
          onComplete={() => setShowWelcomeLoader(false)}
        />
      )}
      <DailyBackupReminderBanner session={session} />
      {!isOnline && (
        <div className="bg-amber-600 text-white text-xs font-bold px-4 py-2.5 flex items-center justify-center gap-2 transition-all shadow-md shrink-0 text-center">
          <div className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
          <span>{t('common.offlineWarning')}</span>
        </div>
      )}

      {/* Clinic System Topbar */}
      <header className="bg-white border-b border-slate-200/80 shrink-0 shadow-xs">
        {/* Desktop Header Layout */}
        <div className="hidden md:flex w-full max-w-[1536px] mx-auto px-[50px] justify-between items-center gap-4 py-3">
          <div className="flex items-center gap-6 w-auto">
            {/* Logo Container with compact height for professional and slim brand representation */}
            <div className="h-14 flex items-center justify-start shrink-0 bg-white hover:scale-[1.02] transition-transform duration-300">
              {currentClinicInfo.logoUrl && currentClinicInfo.logoUrl.trim() !== '' ? (
                <img 
                  src={currentClinicInfo.logoUrl} 
                  alt="Clinic Logo" 
                  className="h-full w-auto max-w-[240px] object-contain object-start"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex items-center gap-2 text-emerald-700 font-black">
                  <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-emerald-100 shrink-0">
                    <Activity className="h-5 w-5" />
                  </div>
                  <span className="text-lg font-bold text-slate-700">{t('common.appName')}</span>
                </div>
              )}
            </div>

            {/* Vertical Divider */}
            <div className="h-8 w-[1.5px] bg-slate-200 shrink-0" />

            {/* Clinic Info */}
            <div className="text-start">
              <h1 className="text-xl font-black text-slate-800 leading-snug flex flex-wrap items-center justify-start gap-2">
                {currentClinicInfo.nameEn || currentClinicInfo.name || session.clinicName}
                {isStaff ? (
                  <span className="bg-indigo-50 text-indigo-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-indigo-200 flex items-center gap-1 shadow-sm">
                    <UserCheck className="h-3 w-3 text-indigo-600 inline" />
                    {session.type === 'clinic_staff' && session.staffName ? `${t('common.secretaryPrefix')}: ${session.staffName} (${session.staffRole || 'Assistant'})` : t('common.secretaryPortal')}
                  </span>
                ) : (
                  <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-emerald-100">
                    {t('common.doctorRole')}
                  </span>
                )}
              </h1>

            </div>
          </div>
          
          {/* Left Actions Control Panel (Language Switcher, DB Status, ID Badge & Logout Button) */}
          <div className="flex items-center gap-2.5 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-200/60 shadow-xs shrink-0">
            <LanguageSwitcher variant="pill" />

            {isOnline ? (
              <span className="text-xs bg-white text-slate-700 border border-slate-200/80 shadow-2xs font-mono px-3 py-1.5 rounded-xl flex items-center gap-2" dir="ltr">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                ID: {currentClinicId}
              </span>
            ) : (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 font-mono px-3 py-1.5 rounded-xl flex items-center gap-2" dir="ltr">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                {t('common.offline')}
              </span>
            )}
            
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-slate-600 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200/80 hover:border-rose-100 shadow-2xs px-3.5 py-1.5 rounded-xl text-xs font-bold transition duration-150 cursor-pointer animate-fade-in"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>{t('common.logout')}</span>
            </button>
          </div>
        </div>

        {/* Mobile-First Header Layout: Compact, gorgeous and doesn't wrap unnecessarily */}
        <div className="flex md:hidden w-full px-4 py-2.5 items-center justify-between gap-2 bg-white">
          {/* Clinic Logo / Name & Badge */}
          <div className="flex items-center gap-2 max-w-[60%] min-w-0">
            {currentClinicInfo.logoUrl && currentClinicInfo.logoUrl.trim() !== '' ? (
              <img 
                src={currentClinicInfo.logoUrl} 
                alt="Clinic Logo" 
                className="h-8 w-auto max-w-[100px] object-contain object-start shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex items-center gap-1.5 text-emerald-700 font-black min-w-0">
                <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center text-white shadow-md shadow-emerald-100 shrink-0">
                  <Activity className="h-4 w-4" />
                </div>
                <span className="text-xs font-black text-slate-800 tracking-tight leading-none truncate select-none">
                  {currentClinicInfo.nameAr || currentClinicInfo.nameEn || currentClinicInfo.name || session.clinicName}
                </span>
              </div>
            )}
            
            <div className="shrink-0">
              {isStaff ? (
                <span className="bg-indigo-50/80 border border-indigo-100 text-indigo-700 text-xs font-black px-1.5 py-0.5 rounded-md flex items-center gap-0.5" title={session.staffName || 'Assistant'}>
                  <span className="max-w-[45px] truncate">{session.staffName || 'Assistant'}</span>
                </span>
              ) : (
                <span className="bg-emerald-50 border border-emerald-100/80 text-emerald-700 text-xs font-black px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                  {t('common.doctorRole')}
                </span>
              )}
            </div>
          </div>

          {/* Action controls: Language Switcher, Connection status + Logout */}
          <div className="flex items-center gap-1.5 shrink-0">
            <LanguageSwitcher variant="compact" />

            {isOnline ? (
              <span className="text-xs bg-slate-50 text-slate-600 border border-slate-100 px-2 py-1 rounded-lg flex items-center gap-1 font-mono" dir="ltr">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                #{currentClinicId ? currentClinicId.substring(0, 4) : 'ON'}
              </span>
            ) : (
              <span className="text-xs bg-rose-50 text-rose-600 border border-rose-100 px-2 py-1 rounded-lg flex items-center gap-1 font-bold" dir="ltr">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                {t('common.offline')}
              </span>
            )}

            <button
              onClick={handleLogout}
              className="flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200/80 p-2 rounded-xl text-xs font-bold transition duration-150 cursor-pointer shadow-3xs"
              title={t('common.logout')}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* System-Wide Broadcast Announcement Banner */}
      {activeBroadcast && activeBroadcast.content && dismissedBroadcastId !== activeBroadcast.id && (typeof window === 'undefined' || localStorage.getItem('dismissed_broadcast_' + activeBroadcast.id) !== 'true') && (
        <div
          className="py-3 px-4 shadow-md transition-all relative border-b border-black/10"
          style={{
            backgroundColor: activeBroadcast.bgColor || '#059669',
            color: activeBroadcast.textColor || '#ffffff'
          }}
          dir="rtl"
        >
          <div className="w-full max-w-[1536px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <span
                className="flex h-6 w-6 rounded-full items-center justify-center animate-pulse shrink-0"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)'
                }}
              >
                <Megaphone className="h-3.5 w-3.5" style={{ color: activeBroadcast.textColor || '#ffffff' }} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-black leading-relaxed" style={{ color: activeBroadcast.textColor || '#ffffff' }}>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-md font-bold ml-2 shrink-0 inline-block"
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.25)',
                      color: activeBroadcast.textColor || '#ffffff'
                    }}
                  >
                    تنبيه تعميمي موحد:
                  </span>
                  {activeBroadcast.content}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                if (activeBroadcast?.id) {
                  setDismissedBroadcastId(activeBroadcast.id);
                  try {
                    localStorage.setItem('dismissed_broadcast_' + activeBroadcast.id, 'true');
                  } catch (e) {
                    console.error('Error storing broadcast dismissal:', e);
                  }
                }
              }}
              className="p-1.5 rounded-lg transition shrink-0 cursor-pointer opacity-80 hover:opacity-100 hover:bg-black/10"
              style={{ color: activeBroadcast.textColor || '#ffffff' }}
              title="إغلاق التنبيه وعدم إظهاره مرة أخرى"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Expired Subscription Mode Top Banner */}
      {isClinicExpired(currentClinicInfo) && (
        <div className="bg-gradient-to-r from-rose-700 via-red-600 to-rose-800 text-white py-3.5 px-4 shadow-xl border-b-2 border-rose-900 animate-fade-in" dir="rtl">
          <div className="w-full max-w-[1536px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white/20 rounded-2xl shrink-0 shadow-inner">
                <AlertCircle className="h-6 w-6 text-white animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="bg-white text-rose-950 text-xs font-black px-2.5 py-0.5 rounded-full shadow-2xs">
                    وضع القراءة فقط والنسخ الاحتياطي
                  </span>
                  <p className="text-sm font-black tracking-wide">
                    🚫 {currentClinicInfo.isActive === false ? 'حساب العيادة موقوف من قبل إدارة المنصة' : `انتهت فترة اشتراك العيادة (${formatDateTime(currentClinicInfo.subscriptionExpiresAt)})`}
                  </p>
                </div>
                <p className="text-xs text-rose-100 mt-1 font-bold leading-relaxed">
                  تم إيقاف إمكانية إضافة أو تعديل البيانات نهائياً. يمكنك فقط استعراض سجلات العيادة السابقة وأخذ نسخة احتياطية من الإعدادات.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setClinicActiveTab('settings')}
                className="px-4 py-2 bg-white hover:bg-rose-50 text-rose-800 rounded-xl text-xs font-black shadow-md transition flex items-center gap-2 cursor-pointer hover:scale-105"
              >
                <Database className="h-4 w-4 text-rose-600" />
                <span>أخذ نسخة احتياطية للبيانات 📥</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Warnings Alert Banner */}
      {showSubscriptionWarning && (
        <div className="bg-amber-50 border-b border-amber-200 py-3.5 text-amber-900 shadow-inner animate-pulse">
          <div className="w-full max-w-[1536px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black">{remainingDaysText}</p>
              <p className="text-xs text-amber-700 mt-0.5">يرجى تحويل قيمة الاشتراك للمشرف لتفعيل التجديد التلقائي لضمان استمرارية الوصول للملفات الطبية ومواعيد المرضى.</p>
            </div>
          </div>
        </div>
      )}

      {/* Vibrant Clinic Secondary Tab-Bar Navigation */}
      <div className="bg-white border-b border-slate-200 shadow-md shrink-0 sticky top-0 z-30">
        <div className="w-full max-w-[1536px] mx-auto px-3 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-2">
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none pb-0.5 sm:pb-0 justify-start">
            {allowedFeatures.includes('patients') && (!isStaff || staffAllowedTabs.includes('patients')) && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setClinicActiveTab('patients')}
                className={`py-1.5 px-2.5 sm:px-3.5 rounded-xl text-xs sm:text-sm transition-colors duration-200 flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer group border ${
                  clinicActiveTab === 'patients' || clinicActiveTab === 'medical_files'
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20 border-cyan-400/40 font-bold'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-slate-200/80 hover:border-cyan-500/30 font-bold'
                }`}
              >
                <div className={`p-1 rounded-lg transition-transform duration-300 ${
                  clinicActiveTab === 'patients' || clinicActiveTab === 'medical_files' ? 'bg-white/20 text-white shadow-inner' : 'bg-cyan-500/10 text-cyan-600 group-hover:scale-110 group-hover:bg-cyan-500 group-hover:text-white'
                }`}>
                  <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span>{t('nav.patients')}</span>
              </motion.button>
            )}
            
            {allowedFeatures.includes('calendar') && (!isStaff || staffAllowedTabs.includes('calendar')) && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setClinicActiveTab('calendar')}
                className={`py-1.5 px-2.5 sm:px-3.5 rounded-xl text-xs sm:text-sm transition-colors duration-200 flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer group border ${
                  clinicActiveTab === 'calendar'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20 border-emerald-400/40 font-bold'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-slate-200/80 hover:border-emerald-500/30 font-bold'
                }`}
              >
                <div className={`p-1 rounded-lg transition-transform duration-300 ${
                  clinicActiveTab === 'calendar' ? 'bg-white/20 text-white shadow-inner' : 'bg-emerald-500/10 text-emerald-600 group-hover:scale-110 group-hover:bg-emerald-500 group-hover:text-white'
                }`}>
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span>{t('nav.calendar')}</span>
              </motion.button>
            )}

            {allowedFeatures.includes('prescriptions') && (!isStaff || staffAllowedTabs.includes('prescriptions')) && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setPrescriptionInitialPatientId('');
                  setClinicActiveTab('prescriptions');
                }}
                className={`py-1.5 px-2.5 sm:px-3.5 rounded-xl text-xs sm:text-sm transition-colors duration-200 flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer group border ${
                  clinicActiveTab === 'prescriptions'
                    ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md shadow-purple-500/20 border-purple-400/40 font-bold'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-slate-200/80 hover:border-purple-500/30 font-bold'
                }`}
              >
                <div className={`p-1 rounded-lg transition-transform duration-300 ${
                  clinicActiveTab === 'prescriptions' ? 'bg-white/20 text-white shadow-inner' : 'bg-purple-500/10 text-purple-600 group-hover:scale-110 group-hover:bg-purple-500 group-hover:text-white'
                }`}>
                  <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span>{t('nav.prescriptions')}</span>
              </motion.button>
            )}
 
            {allowedFeatures.includes('laboratory') && (!isStaff || staffAllowedTabs.includes('laboratory')) && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setClinicActiveTab('laboratory')}
                className={`py-1.5 px-2.5 sm:px-3.5 rounded-xl text-xs sm:text-sm transition-colors duration-200 flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer group border ${
                  clinicActiveTab === 'laboratory'
                    ? 'bg-gradient-to-r from-indigo-500 to-cyan-600 text-white shadow-md shadow-indigo-500/20 border-indigo-400/40 font-bold'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200/80 hover:border-indigo-500/30 font-bold'
                }`}
              >
                <div className={`p-1 rounded-lg transition-transform duration-300 ${
                  clinicActiveTab === 'laboratory' ? 'bg-white/20 text-white shadow-inner' : 'bg-indigo-500/10 text-indigo-600 group-hover:scale-110 group-hover:bg-indigo-500 group-hover:text-white'
                }`}>
                  <Beaker className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span>{t('nav.laboratory')}</span>
              </motion.button>
            )}

            {allowedFeatures.includes('financials') && (!isStaff || staffAllowedTabs.includes('financials')) && (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setClinicActiveTab('financials')}
                className={`py-1.5 px-2.5 sm:px-3.5 rounded-xl text-xs sm:text-sm transition-colors duration-200 flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer group border ${
                  clinicActiveTab === 'financials'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/20 border-amber-400/40 font-bold'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-slate-200/80 hover:border-amber-500/30 font-bold'
                }`}
              >
                <div className={`p-1 rounded-lg transition-transform duration-300 ${
                  clinicActiveTab === 'financials' ? 'bg-white/20 text-white shadow-inner' : 'bg-amber-500/10 text-amber-600 group-hover:scale-110 group-hover:bg-amber-500 group-hover:text-white'
                }`}>
                  <Receipt className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </div>
                <span>{t('nav.financials')}</span>
              </motion.button>
            )}
 
            {/* Show settings for managers only */}
            {!isStaff && (
              <>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setClinicActiveTab('settings')}
                  className={`py-1.5 px-2.5 sm:px-3.5 rounded-xl text-xs sm:text-sm transition-colors duration-200 flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer group border ${
                    clinicActiveTab === 'settings'
                      ? 'bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-md shadow-indigo-500/20 border-indigo-400/40 font-bold'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200/80 hover:border-indigo-500/30 font-bold'
                  }`}
                >
                  <div className={`p-1 rounded-lg transition-transform duration-300 ${
                    clinicActiveTab === 'settings' ? 'bg-white/20 text-white shadow-inner' : 'bg-indigo-500/10 text-indigo-600 group-hover:scale-110 group-hover:bg-indigo-500 group-hover:text-white'
                  }`}>
                    <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </div>
                  <span>{t('nav.settings')}</span>
                </motion.button>
              </>
            )}


          </div>
        </div>
      </div>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-[1536px] mx-auto p-4 sm:p-6 md:px-[80px] lg:px-[80px] xl:px-[80px] py-4 sm:py-6 lg:py-8 min-h-[75vh]">
        <AnimatePresence mode="wait">
          <motion.div
            key={clinicActiveTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
          >
            <AppErrorBoundary>
            <Suspense fallback={
              <div className="flex flex-col items-center justify-center p-12 min-h-[350px] w-full animate-pulse bg-white border border-slate-200/60 rounded-3xl shadow-xs">
                <div className="w-10 h-10 rounded-full border-3 border-slate-200 border-t-emerald-600 animate-spin mb-4"></div>
                <p className="text-slate-500 text-xs font-bold font-sans">جاري تحميل واجهة {
                  clinicActiveTab === 'patients' ? 'سجل المرضى' :
                  clinicActiveTab === 'calendar' ? 'مواعيد العمل والتقويم' :
                  clinicActiveTab === 'medical_files' ? 'الملفات الطبية للمرضى' :
                  clinicActiveTab === 'prescriptions' ? 'الروشتات الطبية وروشتة العلاج' :
                  clinicActiveTab === 'laboratory' ? 'المعامل والطلبات الخارجية' :
                  clinicActiveTab === 'financials' ? 'حسابات العيادة والمدفوعات' : 'الإعدادات العامة للعيادة'
                }...</p>
              </div>
            }>
              {allowedFeatures.includes('patients') && clinicActiveTab === 'patients' && (
                <div className="space-y-6">
                  <PatientsManager
                    clinic={currentClinicInfo}
                    isStaff={isStaff}
                    activeShift={activeShift}
                    onOpenMedicalFile={(patientId) => {
                      setSelectedPatientIdForFile(patientId);
                      setMedicalFileInitialTab(null);
                      setClinicActiveTab('medical_files');
                    }}
                    onOpenPatientFinancials={(patientId) => {
                      setSelectedPatientIdForFile(patientId);
                      setMedicalFileInitialTab(null);
                      setClinicActiveTab('medical_files');
                    }}
                  />
                </div>
              )}
        
        {allowedFeatures.includes('calendar') && clinicActiveTab === 'calendar' && (
          <InteractiveCalendar 
            clinic={currentClinicInfo} 
            isStaff={isStaff} 
            activeShift={activeShift}
            sharedAppointments={sharedAppointments}
            onRefreshAppointments={fetchSharedAppointments}
            onOpenMedicalFile={(patientId) => {
              setSelectedPatientIdForFile(patientId);
              setMedicalFileInitialTab(null);
              setClinicActiveTab('medical_files');
            }}
            onOpenPatientFinancials={(patientId) => {
              setSelectedPatientIdForFile(patientId);
              setMedicalFileInitialTab(null);
              setClinicActiveTab('medical_files');
            }}
          />
        )}

        {allowedFeatures.includes('patients') && clinicActiveTab === 'medical_files' && (
          <PatientMedicalFile
            clinic={currentClinicInfo}
            isStaff={isStaff}
            preselectedPatientId={selectedPatientIdForFile}
            initialTab={medicalFileInitialTab}
            onBackToPatients={() => setClinicActiveTab('patients')}
            onNavigateToPrescriptions={(patientId) => {
              setPrescriptionInitialPatientId(patientId);
              setClinicActiveTab('prescriptions');
            }}
            activeShift={activeShift}
            onRefreshAppointments={fetchSharedAppointments}
          />
        )}

        {allowedFeatures.includes('prescriptions') && clinicActiveTab === 'prescriptions' && (
          <PrescriptionGenerator 
            clinic={currentClinicInfo} 
            isStaff={isStaff} 
            initialPatientId={prescriptionInitialPatientId} 
            onSaveSuccess={() => setClinicActiveTab('calendar')}
          />
        )}

        {allowedFeatures.includes('laboratory') && clinicActiveTab === 'laboratory' && (
          <LabTrackingView 
            clinic={currentClinicInfo} 
            isDemoMode={false} 
            isStaff={isStaff} 
            activeShift={activeShift}
            operatorName={
              session.type === 'clinic_staff' 
                ? (session.staffName || 'ساره على') 
                : (currentClinicInfo.doctorName 
                    ? (currentClinicInfo.doctorName.trim().startsWith('د.') || currentClinicInfo.doctorName.trim().startsWith('د ')
                        ? currentClinicInfo.doctorName.trim()
                        : `د. ${currentClinicInfo.doctorName.trim()}`
                      )
                    : 'د. مدير العيادة'
                  )
            }
          />
        )}

        {allowedFeatures.includes('financials') && clinicActiveTab === 'financials' && (
          <ClinicFinancials 
            clinic={currentClinicInfo} 
            isStaff={isStaff} 
            operatorName={
              session.type === 'clinic_staff' 
                ? (session.staffName || 'ساره على') 
                : (currentClinicInfo.doctorName 
                    ? (currentClinicInfo.doctorName.trim().startsWith('د.') || currentClinicInfo.doctorName.trim().startsWith('د ')
                        ? currentClinicInfo.doctorName.trim()
                        : `د. ${currentClinicInfo.doctorName.trim()}`
                      )
                    : 'د. مدير العيادة'
                  )
            } 
            sharedAppointments={sharedAppointments}
            onRefreshAppointments={fetchSharedAppointments}
            activeShift={activeShift}
            onRefreshActiveShift={fetchActiveShift}
            allowedTabs={session.type === 'clinic_staff' ? session.allowedTabs : undefined}
          />
        )}

        {!isStaff && clinicActiveTab === 'settings' && currentClinicData && (
          <ClinicSettings
            clinicId={currentClinicId}
            clinic={currentClinicData}
            session={session}
            setSession={setSession}
            onClinicDataUpdated={(updated) => {
              if (updated && updated.id) {
                setCurrentClinicData(updated);
              }
            }}
          />
        )}
            </Suspense>
            </AppErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Elegant Footer */}
      <footer className="py-6 border-t border-slate-200/60 text-center text-xs text-slate-400">
        Clinic Management System Multi-Tenant SaaS Platform • كل عيادة بياناتها معزولة بشكل آمن ومستقل في قاعدة بيانات Turso ومستضافة على Vercel
      </footer>
    </div>
  );
}