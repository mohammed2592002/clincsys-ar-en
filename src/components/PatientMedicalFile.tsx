import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { getPatientRecordsRef, getPatientXRaysRef, getPatientsRef, getPrescriptionsRef, getAppointmentsRef, OperationType, handleDbError, cleanDbData, db, storage, getDocsSmart as getDocs, getDocSmart as getDoc, ref, uploadBytes, getDownloadURL, collection, addDoc, updateDoc, setDoc, deleteDoc, doc, query, where, orderBy, limit, clearQueryCache } from '../dbClient';
import { Patient, Clinic, PatientRecord, DentalTooth, Prescription, Appointment, CustomDentalService, PatientXRay } from '../types';
import { FileText, Plus, Calendar, DollarSign, Image, Heart, Trash2, Shield, Eye, RefreshCw, Sparkles, Check, Printer, Receipt, CreditCard, Clock, AlertCircle, Send, ZoomIn, ZoomOut, RotateCw, Contrast, Download, X, Edit, Edit3, Camera, Save, Clipboard, MessageSquare } from 'lucide-react';
const DentalChart = React.lazy(() => import('./DentalChart'));
import { useDialogs } from './DialogContext';
import { PrintPreviewModal } from './PrintPreviewModal';
import PatientSearchSelect from './PatientSearchSelect';
import { resolveProcedureBreakdown, cleanNotes, convertToFDI, convertToToothNotation, getToothInfo, getUniversalToothNumber, getAllToothKeys } from '../utils';
import { checkSubscriptionBlocked, isClinicExpired } from '../utils/timeUtils';
import { formatLocationDisplayName } from '../data/egyptLocations';
import PatientFinancialsModal, { normalizePaymentMethod } from './PatientFinancialsModal';
import { ToothBadge } from './ToothBadge';
import { DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG, DEFAULT_QUESTIONNAIRE_QUESTIONS } from '../types';
import { generatePrescriptionHTML } from '../utils/prescriptionHtml';
import { safeStorage, getEffectivePadConfig } from '../utils/storage';
import { compressImage, formatFileSize } from '../utils/imageCompressor';
import { uploadFileToR2, deleteFileFromR2, dataUrlToBlob } from '../utils/r2Upload';
import { saveOfflineMedia, getOfflineMedia, addToSyncQueue } from '../utils/offlineDb';


interface PatientMedicalFileProps {
  clinic: Clinic;
  isStaff?: boolean;
  preselectedPatientId?: string;
  onBackToPatients?: () => void;
  initialTab?: 'visits' | 'prescriptions' | 'financials' | 'xrays' | null;
  onNavigateToPrescriptions?: (patientId: string) => void;
  activeShift?: any;
  onRefreshAppointments?: (silent?: boolean | any, targetDate?: string, force?: boolean) => void;
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

export default function PatientMedicalFile({ clinic, isStaff, preselectedPatientId, onBackToPatients, initialTab, onNavigateToPrescriptions, activeShift, onRefreshAppointments }: PatientMedicalFileProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  const [previewInvoiceHtml, setPreviewInvoiceHtml] = useState<string | null>(null);
  const [previewPrescriptionHtml, setPreviewPrescriptionHtml] = useState<string | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState(preselectedPatientId || '');
  const [records, setRecords] = useState<PatientRecord[]>([]);
  const lastRecordsFetchTimeRef = useRef<number>(0);
  const lastPrescriptionsFetchTimeRef = useRef<number>(0);
  const lastAppointmentsFetchTimeRef = useRef<number>(0);
  const [_loading, setLoading] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [_error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedPatientId) {
      setSelectedPatientId(preselectedPatientId);
    }
  }, [preselectedPatientId]);

  // Form State
  const [isAddingRecord, setIsAddingRecord] = useState(false);
  const [treatment, setTreatment] = useState('حشو ليزر تجميلي للضرس');
  const [cost, setCost] = useState(350);
  const [notes, setNotes] = useState('');

  // Multiple concurrent procedures within this appointment
  const [procedures, setProcedures] = useState<Array<{ id: string; name: string; cost: number; tooth: number | '' }>>([]);

  // Initialize procedures when form opens
  useEffect(() => {
    if (isAddingRecord) {
      setProcedures([
        { id: 'p-init', name: treatment || 'حشو ليزر تجميلي للضرس', cost: cost || 350, tooth: selectedToothNum }
      ]);
    }
  }, [isAddingRecord]);
  
  // Dental Chart state
  const [toothChart, setToothChart] = useState<{ [toothNumber: number]: DentalTooth }>({});
  const [customServices, setCustomServices] = useState<CustomDentalService[]>(
    clinic.customDentalServices || []
  );

  useEffect(() => {
    if (clinic.customDentalServices) {
      setCustomServices(clinic.customDentalServices);
    }
  }, [clinic.customDentalServices]);

  const [serviceCategories, setServiceCategories] = useState<string[]>(
    clinic.dentalServiceCategories || []
  );

  useEffect(() => {
    if (clinic.dentalServiceCategories) {
      setServiceCategories(clinic.dentalServiceCategories);
    }
  }, [clinic.dentalServiceCategories]);

  const handleUpdateCategories = async (updatedCategories: string[]) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setServiceCategories(updatedCategories);
    try {
      const docRef = doc(db, 'clinics', clinic.id);
      await updateDoc(docRef, {
        dentalServiceCategories: updatedCategories
      });
    } catch (err) {
      console.error("Error saving dental service categories:", err);
    }
  };

  const handleUpdateCustomServices = async (updatedServices: CustomDentalService[]) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    setCustomServices(updatedServices);
    try {
      const docRef = doc(db, 'clinics', clinic.id);
      await updateDoc(docRef, {
        customDentalServices: updatedServices
      });
    } catch (err) {
      console.error("Error saving custom dental services:", err);
    }
  };

  // Prescriptions state
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loadingPrescriptions, setLoadingPrescriptions] = useState(false);
  const [rightColTab, setRightColTab] = useState<'visits' | 'prescriptions' | 'financials' | 'xrays' | null>(
    initialTab || null
  );

  // X-Rays State
  const [xrays, setXrays] = useState<PatientXRay[]>([]);
  const [loadingXrays, setLoadingXrays] = useState(false);
  const [isUploadingXray, setIsUploadingXray] = useState(false);
  const [xrayFile, setXrayFile] = useState<File | null>(null);
  const [xrayPreview, setXrayPreview] = useState<string | null>(null);
  const [xrayCompressionStats, setXrayCompressionStats] = useState<{ orig: string; comp: string } | null>(null);
  const [xrayDiagnosis, setXrayDiagnosis] = useState<string>('');
  const [activeXrayViewer, setActiveXrayViewer] = useState<PatientXRay | null>(null);

  // Edit X-Ray state
  const [editingXray, setEditingXray] = useState<any | null>(null);
  const [editXrayDiagnosis, setEditXrayDiagnosis] = useState('');
  const [editXrayFile, setEditXrayFile] = useState<File | null>(null);
  const [editXrayPreview, setEditXrayPreview] = useState<string | null>(null);
  const [editXrayCompressionStats, setEditXrayCompressionStats] = useState<{ orig: string; comp: string } | null>(null);
  const [isUpdatingXray, setIsUpdatingXray] = useState(false);

  const handleOpenEditXray = (xray: any) => {
    setEditingXray(xray);
    setEditXrayDiagnosis(xray.diagnosis || '');
    setEditXrayFile(null);
    setEditXrayPreview(null);
    setEditXrayCompressionStats(null);
  };

  const handleSelectEditXrayFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { file: compressedFile, previewUrl, compressedDataUrl, originalSize, compressedSize } = await compressImage(file, 1600, 1600, 0.80, 'image/webp');
      setEditXrayFile(compressedFile);
      setEditXrayPreview(compressedDataUrl || previewUrl);
      setEditXrayCompressionStats({
        orig: formatFileSize(originalSize),
        comp: formatFileSize(compressedSize)
      });
    } catch (err) {
      console.error('Error selecting edit X-ray file:', err);
      dialogs.alert('خطأ في معالجة الصورة الجديدة', { severity: 'error' });
    }
  };

  const handleSaveEditXray = async () => {
    if (!editingXray || !selectedPatientId) return;
    setIsUpdatingXray(true);
    try {
      let updatedImageUrl = editingXray.imageUrl;
      let newOriginalSize = editingXray.originalSize;
      let isOfflinePending = editingXray.isOfflinePending || false;
      let mediaId = editingXray.mediaId;

      if (editXrayPreview) {
        const fileToUpload = editXrayFile || dataUrlToBlob(editXrayPreview);
        const fileName = `xray_${selectedPatientId}_${Date.now()}.webp`;
        const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        let uploadSuccess = false;

        if (isOnline) {
          try {
            const r2PublicUrl = await uploadFileToR2(fileToUpload, 'xrays', clinic.id, fileName);
            if (r2PublicUrl) {
              if (editingXray.imageUrl && !editingXray.imageUrl.startsWith('data:') && !editingXray.imageUrl.startsWith('blob:')) {
                await deleteFileFromR2(editingXray.imageUrl).catch(() => {});
              }
              updatedImageUrl = r2PublicUrl;
              newOriginalSize = editXrayFile?.size || 0;
              isOfflinePending = false;
              uploadSuccess = true;
            }
          } catch (r2Err) {
            console.warn('R2 upload failed during edit, saving offline:', r2Err);
          }
        }

        if (!uploadSuccess) {
          mediaId = 'media_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
          updatedImageUrl = editXrayPreview;
          isOfflinePending = true;

          const targetDocPath = editingXray.id.startsWith('record_')
            ? `clinics/${clinic.id}/patients/${selectedPatientId}/records`
            : `clinics/${clinic.id}/patients/${selectedPatientId}/xrays`;
          const targetDocId = editingXray.id.startsWith('record_')
            ? editingXray.id.replace('record_', '')
            : editingXray.id;
          const targetField = editingXray.id.startsWith('record_') ? 'xrayUrl' : 'imageUrl';

          await saveOfflineMedia({
            id: mediaId,
            dataUrl: editXrayPreview,
            blob: fileToUpload,
            fileName,
            category: 'xrays',
            clinicId: clinic.id,
            patientId: selectedPatientId,
            docPath: targetDocPath,
            docId: targetDocId,
            field: targetField,
            status: 'pending',
            createdAt: Date.now()
          });

          await addToSyncQueue({
            action: 'uploadOfflineMedia',
            path: targetDocPath,
            docId: targetDocId,
            mediaId,
            category: 'xrays',
            fileName,
            data: {
              clinicId: clinic.id,
              patientId: selectedPatientId,
              targetDocId,
              field: targetField
            }
          });
        }
      }

      const updatedDiagnosis = editXrayDiagnosis.trim();

      if (editingXray.id.startsWith('record_')) {
        const realRecordId = editingXray.id.replace('record_', '');
        const recordRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'records', realRecordId);
        await updateDoc(recordRef, {
          xrayUrl: updatedImageUrl,
          notes: updatedDiagnosis,
          isOfflinePending
        });
      } else {
        const docRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'xrays', editingXray.id);
        await updateDoc(docRef, {
          imageUrl: updatedImageUrl,
          diagnosis: updatedDiagnosis,
          originalSize: newOriginalSize,
          mediaId,
          isOfflinePending
        });
      }

      dialogs.alert(isOfflinePending ? 'تم حفظ التعديل محلياً (أوفلاين) وسيتم الرفع تلقائياً لـ Cloudflare R2 فور عودة الإنترنت ⚡' : 'تم تعديل صورة الأشعة والتشخيص بنجاح!', { severity: 'success' });

      if (activeXrayViewer && activeXrayViewer.id === editingXray.id) {
        setActiveXrayViewer({
          ...activeXrayViewer,
          imageUrl: updatedImageUrl,
          diagnosis: updatedDiagnosis,
          isOfflinePending
        });
      }

      setEditingXray(null);
      await fetchPatientXRays(selectedPatientId);
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'records' } }));
    } catch (err: any) {
      console.error("Error updating X-ray:", err);
      dialogs.alert('حدث خطأ أثناء تعديل الأشعة: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setIsUpdatingXray(false);
    }
  };
  const [viewerZoom, setViewerZoom] = useState<number>(1);
  const [viewerRotate, setViewerRotate] = useState<number>(0);
  const [viewerContrast, setViewerContrast] = useState<boolean>(false);
  const [viewerPan, setViewerPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleMouseDownXray = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - viewerPan.x, y: e.clientY - viewerPan.y });
  };

  const handleMouseMoveXray = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setViewerPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUpXray = () => {
    setIsDragging(false);
  };

  const handleTouchStartXray = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - viewerPan.x,
        y: e.touches[0].clientY - viewerPan.y
      });
    }
  };

  const handleTouchMoveXray = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setViewerPan({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y
    });
  };

  const handleTouchEndXray = () => {
    setIsDragging(false);
  };
  const [isFinancialsModalOpen, setIsFinancialsModalOpen] = useState(false);
  const [isXrayModalOpen, setIsXrayModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'prescription' | 'record' | 'procedure' | 'visit'; id: string; procedure?: any; visit?: any } | null>(null);

  useEffect(() => {
    setRightColTab(initialTab || null);
    if (initialTab === 'financials') {
      setIsFinancialsModalOpen(true);
    } else if (initialTab === 'xrays') {
      setIsXrayModalOpen(true);
    }
  }, [initialTab]);

  // Financials tracking state for this patient
  const [patientAppointments, setPatientAppointments] = useState<Appointment[]>([]);
  const [loadingPatientAppointments, setLoadingPatientAppointments] = useState(false);
  const [recordingPaymentAppId, setRecordingPaymentAppId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [editingPriceAppId, setEditingPriceAppId] = useState<string | null>(null);
  const [newAppPrice, setNewAppPrice] = useState<number>(0);

  // Linking visit/record to appointments & payments
  const [_linkedAppointmentId, setLinkedAppointmentId] = useState<string>('');
  const [recordPaidAmount, setRecordPaidAmount] = useState<number>(0);

  // Timezone-safe local today YYYY-MM-DD string helper
  const getLocalTodayString = (): string => {
    return getEgyptTodayStr();
  };

  // Doctor Room & Receptionist Workflow States
  const [selectedToothNum, setSelectedToothNum] = useState<number | ''>('');
  const [resultingToothCondition, setResultingToothCondition] = useState<'no_change' | 'auto' | DentalTooth['condition']>('auto');
  const [financialNote, setFinancialNote] = useState<string>('');
  const paymentMethodsList = React.useMemo(() => {
    const defaultMethods = ['كاش', 'فيزا', 'إنستاباي', 'محفظة'];
    const custom = clinic.paymentMethods && clinic.paymentMethods.length > 0 ? clinic.paymentMethods : [];
    const combined = [...defaultMethods];
    custom.forEach(cm => {
      const normCm = normalizePaymentMethod(cm);
      if (!combined.some(m => normalizePaymentMethod(m) === normCm)) {
        combined.push(cm);
      }
    });
    return combined.filter(m => normalizePaymentMethod(m) !== 'نقاط الولاء');
  }, [clinic.paymentMethods]);

  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [receptionPaidAmount, setReceptionPaidAmount] = useState<number>(0);
  const [receptionPayingAppId, setReceptionPayingAppId] = useState<string | null>(null);

  useEffect(() => {
    if (paymentMethodsList.length > 0 && !paymentMethod) {
      setPaymentMethod(paymentMethodsList[0]);
    }
  }, [paymentMethodsList]);

  useEffect(() => {
    const todayStr = getLocalTodayString();
    const targetApp = patientAppointments.find(app => app.date === todayStr && app.status !== 'cancelled') || 
                      patientAppointments.find(app => (app.status === 'scheduled' || app.status === 'waiting') && app.date <= todayStr);
    if (targetApp) {
       setLinkedAppointmentId(targetApp.id);
    } else {
       setLinkedAppointmentId('');
    }
    // Default to 0 payment so that the receptionist can collect it outside and the remaining balance is tracked in the appointment card.
    setRecordPaidAmount(0);
  }, [patientAppointments, isAddingRecord]);

  useEffect(() => {
    // Default the newly added session price to unpaid (0 paid) so that the reception/nurse tracks the outstanding amount on the appointment card.
    setRecordPaidAmount(0);
  }, [cost]);

  // Add prescription state (with visit or standalone)
  const [addPrescriptionWithVisit, setAddPrescriptionWithVisit] = useState(false);
  const [isAddingPrescriptionStandalone, setIsAddingPrescriptionStandalone] = useState(false);
  const [patientAgeInput, _setPatientAgeInput] = useState('28');
  const [prescriptionMedications, setPrescriptionMedications] = useState<Array<{ name: string; dose: string; frequency: string; duration: string }>>([]);
  const [prescriptionNotes, setPrescriptionNotes] = useState('المضمضة بالماء الدافئ والملح، وتجنب السوائل الساخنة لمدة 24 ساعة.');

  // Group patient records into single daily visits containing all procedures done on that day
  const groupedVisits = React.useMemo(() => {
    if (!records || records.length === 0) return [];

    const map = new Map<string, {
      dateKey: string;
      rawDate: string;
      records: PatientRecord[];
      procedures: Array<{
        recordId: string;
        name: string;
        price: number;
        tooth?: number | null;
      }>;
      totalCost: number;
      appointmentIds: string[];
      notesList: string[];
    }>();

    records.forEach((rec) => {
      let dateKey = '';
      if (rec.date) {
        const d = new Date(rec.date);
        if (!isNaN(d.getTime())) {
          dateKey = d.toISOString().split('T')[0];
        } else {
          dateKey = rec.date.split('T')[0];
        }
      }
      if (!dateKey) dateKey = 'no-date';

      const recordProcs = resolveProcedureBreakdown({
        procedures: (rec.procedures && rec.procedures.length > 0) ? rec.procedures : [{
          name: rec.treatment,
          price: rec.cost,
          tooth: rec.toothNumber
        }],
        treatmentType: rec.treatment,
        price: rec.cost,
        toothNumber: rec.toothNumber
      });

      const procRows = recordProcs.map((p: any) => ({
        recordId: rec.id,
        name: p.name || rec.treatment || 'إجراء طبي',
        price: Number(p.price) || 0,
        tooth: p.tooth || rec.toothNumber || null
      }));

      const existing = map.get(dateKey);
      if (existing) {
        existing.records.push(rec);
        existing.procedures.push(...procRows);
        existing.totalCost += Number(rec.cost) || 0;
        if (rec.appointmentId && !existing.appointmentIds.includes(rec.appointmentId)) {
          existing.appointmentIds.push(rec.appointmentId);
        }
        if (rec.notes && rec.notes.trim() && !existing.notesList.includes(rec.notes.trim())) {
          existing.notesList.push(rec.notes.trim());
        }
      } else {
        map.set(dateKey, {
          dateKey,
          rawDate: rec.date,
          records: [rec],
          procedures: procRows,
          totalCost: Number(rec.cost) || 0,
          appointmentIds: rec.appointmentId ? [rec.appointmentId] : [],
          notesList: rec.notes && rec.notes.trim() ? [rec.notes.trim()] : []
        });
      }
    });

    return Array.from(map.values());
  }, [records]);

  const fetchPatients = async () => {
    setLoading(true);
    try {
      const pRef = getPatientsRef(clinic.id);
      const snap = await getDocs(pRef);

      const list: Patient[] = [];
      snap.forEach((pDoc) => {
        const data = pDoc.data();
        list.push({
          id: pDoc.id,
          name: data.name || '',
          phone: data.phone || '',
          whatsappNumber: data.whatsappNumber || data.phone || '',
          gender: data.gender || 'ذكر',
          age: data.age || '',
          address: data.address || '',
          governorate: data.governorate || '',
          cityOrDistrict: data.cityOrDistrict || '',
          area: data.area || '',
          occupation: data.occupation || '',
          questionnaire: data.questionnaire || {},
          medicalHistory: data.medicalHistory || '',
          createdAt: data.createdAt || '',
          updatedAt: data.updatedAt || '',
          toothChart: data.toothChart || {}
        });
      });

      // Sort patients: recently updated / newest first
      list.sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') || a.name.localeCompare(b.name));

      setPatients(list);
      if (list.length > 0 && !selectedPatientId && !preselectedPatientId) {
        setSelectedPatientId(list[0].id);
      }
    } catch (e) {
      console.error(e);
      setError('فشل تحميل المرضى: ' + e);
    } finally {
      setLoading(false);
    }
  };

  const fetchPatientPrescriptions = async (patientId: string, silent = false) => {
    if (!patientId) return;
    const fetchTime = Date.now();
    lastPrescriptionsFetchTimeRef.current = fetchTime;
    if (!silent && prescriptions.length === 0) {
      setLoadingPrescriptions(true);
    }
    try {
      const ref = getPrescriptionsRef(clinic.id);
      const q = query(ref, where("patientId", "==", patientId));
      const snap = await getDocs(q);
      if (fetchTime < lastPrescriptionsFetchTimeRef.current) {
        console.log('[PatientMedicalFile] Stale prescriptions fetch ignored.');
        return;
      }
      const list: Prescription[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          patientId: data.patientId || '',
          patientName: data.patientName || '',
          patientAge: data.patientAge || '',
          date: data.date || '',
          medications: data.medications || [],
          notes: cleanNotes(data.notes || ''),
          prescriptionStyle: data.prescriptionStyle,
          prescriptionLayout: data.prescriptionLayout
        });
      });
      list.sort((a, b) => b.date.localeCompare(a.date));
      setPrescriptions(list);
    } catch (err: any) {
      console.error("Error fetching prescriptions:", err);
    } finally {
      if (fetchTime === lastPrescriptionsFetchTimeRef.current) {
        setLoadingPrescriptions(false);
      }
    }
  };

  const fetchPatientXRays = async (patientId: string, currentPatientRecords?: PatientRecord[], silent = false) => {
    if (!patientId) return;
    if (!silent && xrays.length === 0) {
      setLoadingXrays(true);
    }
    try {
      const ref = getPatientXRaysRef(clinic.id, patientId);
      const snap = await getDocs(query(ref, orderBy("createdAt", "desc")));
      const list: PatientXRay[] = [];
      
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (data.patientId && data.patientId !== patientId) continue;
        if (!data.imageUrl || typeof data.imageUrl !== 'string' || data.imageUrl.trim() === '') continue;
        
        let finalImageUrl = data.imageUrl;
        let isPending = data.isOfflinePending || false;

        // If stored as offline media or local pending, retrieve local image data
        if (data.mediaId || isPending || (!finalImageUrl.startsWith('http://') && !finalImageUrl.startsWith('https://') && !finalImageUrl.startsWith('data:'))) {
          try {
            const media = await getOfflineMedia(data.mediaId || docSnap.id || finalImageUrl);
            if (media) {
              if (media.dataUrl && !media.dataUrl.startsWith('blob:')) {
                finalImageUrl = media.dataUrl;
              } else if (media.blob) {
                finalImageUrl = URL.createObjectURL(media.blob);
              } else if (media.dataUrl) {
                finalImageUrl = media.dataUrl;
              }
              isPending = true;
            }
          } catch (e) {}
        }

        list.push({
          id: docSnap.id,
          patientId: data.patientId || patientId,
          date: data.date || '',
          time: data.time || '',
          imageUrl: finalImageUrl,
          diagnosis: data.diagnosis || '',
          createdAt: data.createdAt || '',
          originalSize: data.originalSize,
          compressedSize: data.compressedSize,
          mediaId: data.mediaId,
          isOfflinePending: isPending
        });
      }

      // Include xrays attached to medical visit records for THIS specific patient
      const targetRecords = currentPatientRecords !== undefined ? currentPatientRecords : [];
      for (const r of targetRecords) {
        if (r.xrayUrl && typeof r.xrayUrl === 'string' && r.xrayUrl.trim() !== '' && !list.some(x => x.imageUrl === r.xrayUrl)) {
          let visitXrayUrl = r.xrayUrl;
          let isVisitPending = (r as any).isOfflinePending || false;

          if (isVisitPending || (!visitXrayUrl.startsWith('http://') && !visitXrayUrl.startsWith('https://') && !visitXrayUrl.startsWith('data:'))) {
            try {
              const media = await getOfflineMedia(visitXrayUrl);
              if (media && media.dataUrl) {
                visitXrayUrl = media.dataUrl;
                isVisitPending = true;
              }
            } catch (e) {}
          }

          list.push({
            id: `record_${r.id}`,
            patientId: patientId,
            date: r.date || '',
            imageUrl: visitXrayUrl,
            diagnosis: r.notes ? `من كشف زيارة: ${r.treatment} (${r.notes})` : `من كشف زيارة: ${r.treatment}`,
            createdAt: r.date,
            isOfflinePending: isVisitPending
          });
        }
      }

      list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setXrays(list);
    } catch (err) {
      console.error("Error fetching patient xrays:", err);
    } finally {
      setLoadingXrays(false);
    }
  };

  const handleSelectXrayFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { file: compressedFile, previewUrl, compressedDataUrl, originalSize, compressedSize } = await compressImage(file, 1600, 1600, 0.80, 'image/webp');
      setXrayFile(compressedFile);
      setXrayPreview(compressedDataUrl || previewUrl);
      setXrayCompressionStats({
        orig: formatFileSize(originalSize),
        comp: formatFileSize(compressedSize)
      });
    } catch (err: any) {
      console.error(err);
      dialogs.alert(err.message || 'حدث خطأ أثناء قراءة ملف الصورة', { severity: 'error' });
    }
  };

  const handleSaveXray = async () => {
    if (!selectedPatientId || !activePatient) {
      dialogs.alert('يرجى اختيار مريض أولاً', { severity: 'warning' });
      return;
    }
    if (!xrayPreview) {
      dialogs.alert('يرجى اختيار صورة الأشعة أولاً', { severity: 'warning' });
      return;
    }

    if (checkSubscriptionBlocked(clinic, dialogs)) return;

    setIsUploadingXray(true);
    try {
      const todayStr = getEgyptTodayStr();
      const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      const xraysRef = getPatientXRaysRef(clinic.id, selectedPatientId);
      const xrayDocId = 'xray_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      const mediaId = 'media_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      const fileName = `xray_${selectedPatientId}_${Date.now()}.webp`;

      let imageUrl = xrayPreview;
      let isOfflinePending = false;

      const fileToUpload = xrayFile || dataUrlToBlob(xrayPreview);
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

      if (isOnline) {
        try {
          const r2PublicUrl = await uploadFileToR2(fileToUpload, 'xrays', clinic.id, fileName);
          if (r2PublicUrl) {
            imageUrl = r2PublicUrl;
            isOfflinePending = false;
          }
        } catch (r2Err) {
          console.warn('Direct R2 upload failed, queuing for offline background sync:', r2Err);
          isOfflinePending = true;
        }
      } else {
        isOfflinePending = true;
      }

      if (isOfflinePending) {
        // Save full image data to IndexedDB offline media store
        await saveOfflineMedia({
          id: mediaId,
          dataUrl: xrayPreview,
          blob: fileToUpload,
          fileName,
          category: 'xrays',
          clinicId: clinic.id,
          patientId: selectedPatientId,
          docPath: xraysRef.path,
          docId: xrayDocId,
          field: 'imageUrl',
          status: 'pending',
          createdAt: Date.now()
        });

        // Queue upload task to sync when internet connection returns
        await addToSyncQueue({
          action: 'uploadOfflineMedia',
          path: xraysRef.path,
          docId: xrayDocId,
          mediaId,
          category: 'xrays',
          fileName,
          data: {
            clinicId: clinic.id,
            patientId: selectedPatientId,
            xrayDocId,
            field: 'imageUrl'
          }
        });
      }

      const newXrayData: PatientXRay = {
        id: xrayDocId,
        patientId: selectedPatientId,
        date: todayStr,
        time: timeStr,
        imageUrl,
        diagnosis: xrayDiagnosis.trim(),
        createdAt: new Date().toISOString(),
        originalSize: xrayFile?.size || 0,
        mediaId: isOfflinePending ? mediaId : undefined,
        isOfflinePending
      };

      await setDoc(doc(xraysRef, xrayDocId), newXrayData);

      setXrayFile(null);
      setXrayPreview(null);
      setXrayCompressionStats(null);
      setXrayDiagnosis('');

      if (isOfflinePending) {
        dialogs.alert('تم حفظ صورة الأشعة محلياً في وضع الأوفلاين بنجاح ⚡ وسيتم رفعها تلقائياً إلى Cloudflare R2 وحفظ الرابط فور توفر الإنترنت.', { severity: 'success' });
      } else {
        dialogs.alert('تم رفع صورة الأشعة وحفظها على Cloudflare R2 بنجاح!', { severity: 'success' });
      }

      await fetchPatientXRays(selectedPatientId);
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'records' } }));
    } catch (err: any) {
      console.error("Error saving xray:", err);
      dialogs.alert('فشل حفظ الأشعة: ' + (err.message || err.toString()), { severity: 'error' });
    } finally {
      setIsUploadingXray(false);
    }
  };


  const handleDeleteXray = async (xrayId: string) => {
    const xrayToDelete = xrays.find(x => x.id === xrayId);
    
    if (xrayId.startsWith('record_')) {
      const realRecordId = xrayId.replace('record_', '');
      const confirm = await dialogs.confirm('هذه الأشعة مرفقة مع كشف زيارة. هل ترغب في إزالة صورة الأشعة من كشف الزيارة؟', {
        title: 'حذف أشعة كشف الزيارة',
        severity: 'danger',
        confirmLabel: 'حذف الأشعة',
        cancelLabel: 'إلغاء'
      });
      if (!confirm) return;

      try {
        if (xrayToDelete && xrayToDelete.imageUrl) {
          await deleteFileFromR2(xrayToDelete.imageUrl);
        }
        const recordRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'records', realRecordId);
        await updateDoc(recordRef, { xrayUrl: '' });
        dialogs.alert('تم حذف صورة الأشعة من السجل بنجاح', { severity: 'success' });
        if (activeXrayViewer?.id === xrayId) setActiveXrayViewer(null);
        await fetchPatientRecords(selectedPatientId);
        await fetchPatientXRays(selectedPatientId);
      } catch (err: any) {
        console.error("Error deleting xray from record:", err);
        dialogs.alert('فشل حذف الأشعة: ' + (err.message || err.toString()), { severity: 'error' });
      }
      return;
    }

    const confirm = await dialogs.confirm('هل أنت تأكد من رغبتك في حذف صورة الأشعة هذه من سجل المريض؟', {
      title: 'تأكيد حذف الأشعة',
      severity: 'danger',
      confirmLabel: 'حذف',
      cancelLabel: 'إلغاء'
    });
    if (!confirm) return;

    try {
      if (xrayToDelete && xrayToDelete.imageUrl) {
        await deleteFileFromR2(xrayToDelete.imageUrl);
      }

      const docRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'xrays', xrayId);
      await deleteDoc(docRef);
      dialogs.alert('تم حذف الأشعة من سجل المريض بنجاح', { severity: 'success' });
      if (activeXrayViewer?.id === xrayId) setActiveXrayViewer(null);
      await fetchPatientXRays(selectedPatientId);
    } catch (err: any) {
      console.error("Error deleting xray:", err);
      dialogs.alert('فشل حذف الأشعة: ' + (err.message || err.toString()), { severity: 'error' });
    }
  };

  const fetchPatientRecords = async (patientId: string, currentPatientsList?: Patient[], overrideChart?: { [toothNumber: number]: DentalTooth }, silent = false) => {
    if (!patientId) return;
    const fetchTime = Date.now();
    lastRecordsFetchTimeRef.current = fetchTime;
    if (!silent && records.length === 0) {
      setLoadingRecords(true);
    }
    setError(null);
    try {
      const snap = await getDocs(getPatientRecordsRef(clinic.id, patientId));
      if (fetchTime < lastRecordsFetchTimeRef.current) {
        console.log('[PatientMedicalFile] Stale records fetch ignored.');
        return;
      }
      const list: PatientRecord[] = [];
      let mergedChart: { [toothNumber: number]: DentalTooth } = overrideChart || {};

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const record: PatientRecord = {
          id: docSnap.id,
          date: data.date || '',
          treatment: data.treatment || '',
          cost: Number(data.cost) || 0,
          notes: cleanNotes(data.notes || ''),
          xrayUrl: data.xrayUrl || '',
          toothChart: data.toothChart || {},
          appointmentId: data.appointmentId || '',
          invoiceStatus: data.invoiceStatus || 'draft',
          financialNote: data.financialNote || '',
          toothNumber: data.toothNumber || null,
          procedures: data.procedures || []
        };
        list.push(record);
      });

      if (!overrideChart) {
        // The patient's master toothChart is the source of truth. Read it from
        // the in-memory patients list when available, otherwise fetch the patient
        // document directly so we don't depend on a stale/not-yet-loaded list
        // (which happens on first render and right after switching patients and
        // would otherwise blank out the chart).
        let masterChart: { [toothNumber: number]: DentalTooth } | null = null;

        const targetList = currentPatientsList || patients;
        const currentPatient = targetList.find(p => p.id === patientId);
        if (currentPatient && currentPatient.toothChart && Object.keys(currentPatient.toothChart).length > 0) {
          masterChart = currentPatient.toothChart;
        } else {
          try {
            const patientSnap = await getDoc(doc(db, 'clinics', clinic.id, 'patients', patientId));
            if (fetchTime < lastRecordsFetchTimeRef.current) {
              console.log('[PatientMedicalFile] Stale records fetch ignored.');
              return;
            }
            const patientData = patientSnap.exists() ? patientSnap.data() : null;
            if (patientData && patientData.toothChart && Object.keys(patientData.toothChart).length > 0) {
              masterChart = patientData.toothChart;
            }
          } catch (e) {
            console.error('[PatientMedicalFile] Failed to load master tooth chart:', e);
          }
        }

        if (masterChart) {
          mergedChart = { ...masterChart };
        } else {
          // Fallback: merge from all records
          list.forEach((record) => {
            if (record.toothChart) {
              Object.keys(record.toothChart).forEach((key) => {
                const toothNum = Number(key);
                const toothData = record.toothChart[key] as DentalTooth;
                if (!mergedChart[toothNum] || (toothData.treatmentDate && (!mergedChart[toothNum].treatmentDate || toothData.treatmentDate > (mergedChart[toothNum].treatmentDate || '')))) {
                  mergedChart[toothNum] = toothData;
                }
              });
            }
          });
        }
      }

      // Sort records newest first
      list.sort((a, b) => b.date.localeCompare(a.date));
      setRecords(list);
      setToothChart(mergedChart);
    } catch (err: any) {
      console.error(err);
      setError('فشل تحميل السجل الطبي للمريض: ' + (err.message || err.toString()));
    } finally {
      if (fetchTime === lastRecordsFetchTimeRef.current) {
        setLoadingRecords(false);
      }
    }
  };

  const fetchPatientAppointments = async (patientId: string, silent = false) => {
    if (!patientId) return;
    const fetchTime = Date.now();
    lastAppointmentsFetchTimeRef.current = fetchTime;
    if (!silent && patientAppointments.length === 0) {
      setLoadingPatientAppointments(true);
    }
    try {
      const ref = getAppointmentsRef(clinic.id);
      const q = query(ref, where("patientId", "==", patientId));
      const snap = await getDocs(q);
      if (fetchTime < lastAppointmentsFetchTimeRef.current) {
        console.log('[PatientMedicalFile] Stale appointments fetch ignored.');
        return;
      }
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
      list.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
      setPatientAppointments(list);
    } catch (err: any) {
      console.error("Error fetching patient appointments:", err);
    } finally {
      if (fetchTime === lastAppointmentsFetchTimeRef.current) {
        setLoadingPatientAppointments(false);
      }
    }
  };

  const autoMarkWaitingAppointmentCompleted = async (skipFetch = false) => {
    try {
      if (!clinic || !selectedPatientId) return;
      const todayStr = getLocalTodayString();
      const existingApp = patientAppointments.find(a => a.date === todayStr && (a.status === 'waiting' || a.status === 'scheduled')) || 
                          patientAppointments.find(a => (a.status === 'waiting' || a.status === 'scheduled') && a.date <= todayStr);
      if (existingApp) {
        const appRef = doc(getAppointmentsRef(clinic.id), existingApp.id);
        await updateDoc(appRef, { status: 'completed' });

        // Ensure patient document exists in patients collection
        if (selectedPatientId) {
          try {
            const pRef = doc(getPatientsRef(clinic.id), selectedPatientId);
            const pSnap = await getDoc(pRef);
            if (!pSnap.exists()) {
              const pName = (existingApp.patientName || activePatient?.name || '').trim();
              if (pName) {
                await setDoc(pRef, cleanDbData({
                  clinicId: clinic.id,
                  name: pName,
                  phone: (existingApp.patientPhone || activePatient?.phone || '').trim(),
                  age: ((existingApp as any).patientAge || activePatient?.age || '').trim(),
                  medicalHistory: ((existingApp as any).patientMedicalHistory || activePatient?.medicalHistory || '').trim(),
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }), { merge: true });
                await fetchPatients();
              }
            }
          } catch (pErr) {
            console.error("Error creating patient doc in PatientMedicalFile:", pErr);
          }
        }

        if (!skipFetch) {
          await fetchPatientAppointments(selectedPatientId);
        }
      }
    } catch (err) {
      console.error("Error auto-completing waiting appointment:", err);
    }
  };

  const handleConfirmReceptionPayment = async (app: Appointment) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    const amt = Number(receptionPaidAmount);
    if (isNaN(amt) || amt < 0) {
      dialogs.alert('يرجى إدخال قيمة صحيحة للمبلغ المحصل', { severity: 'warning' });
      return;
    }

    setLoadingPatientAppointments(true);
    try {
      const ref = getAppointmentsRef(clinic.id);
      const docRef = doc(ref, app.id);
      const currentPaid = app.paidAmount !== undefined ? Number(app.paidAmount) : 0;
      const newPaid = currentPaid + amt;
      const newRemaining = Math.max(0, (Number(app.price) || 0) - newPaid);
      const statusFinal = newRemaining === 0 ? 'paid' : 'installment';

      const selectedMethod = paymentMethod || paymentMethodsList[0] || 'كاش';
      const existingPayments = app.payments && Array.isArray(app.payments) ? [...app.payments] : [];
      const sumExisting = existingPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
      const resolvedPayments = [...existingPayments];
      if (currentPaid > sumExisting) {
        resolvedPayments.unshift({
          id: 'pay_init_' + app.id,
          amount: currentPaid - sumExisting,
          paymentMethod: app.paymentMethod || 'كاش',
          date: (app as any).paymentDate || app.date || getEgyptTodayStr(),
          createdAt: app.updatedAt || app.createdAt || new Date().toISOString(),
          notes: 'الدفعة الأولى السابقة',
          type: 'initial'
        });
      }

      const newPaymentRecord = {
        id: 'pay_reception_' + Math.random().toString(36).substring(2, 11),
        amount: amt,
        paymentMethod: selectedMethod,
        date: (activeShift && activeShift.date) ? activeShift.date : getEgyptTodayStr(),
        createdAt: new Date().toISOString(),
        shiftId: activeShift?.id || undefined,
        notes: 'دفعة التحصيل بالاستقبال',
        type: 'initial'
      };
      const updatedPayments = [...resolvedPayments, newPaymentRecord];

      await updateDoc(docRef, {
        paidAmount: newPaid,
        remainingAmount: newRemaining,
        invoiceStatus: statusFinal,
        paymentMethod: selectedMethod,
        payments: updatedPayments,
        shiftId: activeShift?.id || app.shiftId || undefined,
        updatedAt: new Date().toISOString(),
        notes: app.notes + `\n[تأكيد الاستقبال: تحصيل مبلغ ${amt} ج.م عبر (${normalizePaymentMethod(selectedMethod)}) في ${new Date().toLocaleDateString('ar-EG')}]`
      });

      setReceptionPayingAppId(null);
      setReceptionPaidAmount(0);
      dialogs.alert(`تم تأكيد السداد وإصدار الفاتورة بنجاح! الحالة الآن: ${statusFinal === 'paid' ? 'مسدد بالكامل' : 'قسط متبقي'}`, { severity: 'success' });
      await fetchPatientAppointments(selectedPatientId);
      if (onRefreshAppointments) {
        onRefreshAppointments(true, app.date || getLocalTodayString(), true);
      }
    } catch (err: any) {
      console.error(err);
      dialogs.alert('فشل تأكيد التحصيل: ' + err.toString(), { severity: 'error' });
    } finally {
      setLoadingPatientAppointments(false);
    }
  };

  const findAppointmentInDbOrState = async (patientId: string): Promise<any | null> => {
    const todayStr = getEgyptTodayStr();
    
    // 1. Check local patientAppointments state first (instant in-memory, highly accurate)
    if (patientAppointments && patientAppointments.length > 0) {
      const targetLocal = patientAppointments.find(app => app.date === todayStr && app.status !== 'cancelled') || 
                          patientAppointments.find(app => (app.status === 'scheduled' || app.status === 'waiting') && app.date <= todayStr);
      if (targetLocal) {
        currentTodayAppointmentIdRef.current = targetLocal.id;
        return targetLocal;
      }
    }

    // 2. Check our ref next (instant memory across renders)
    if (currentTodayAppointmentIdRef.current) {
      try {
        const docRef = doc(db, 'clinics', clinic.id, 'appointments', currentTodayAppointmentIdRef.current);
        const docSnap = await getDoc(docRef); // Use cached/local getDoc for speed
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && data.status !== 'cancelled') {
            return { id: docSnap.id, ...data };
          }
        }
      } catch (err) {
        console.error("Error fetching ref appointment from DB:", err);
      }
    }
    
    // 3. Query the DB directly by patientId to find today's or active appointment
    try {
      const appRef = getAppointmentsRef(clinic.id);
      const qPatient = query(appRef, where("patientId", "==", patientId));
      const snapPatient = await getDocs(qPatient);
      const list: any[] = [];
      snapPatient.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });

      // Find today's non-cancelled appointment for this patient
      const foundToday = list.find(app => app.date === todayStr && app.status !== 'cancelled');
      if (foundToday) {
        currentTodayAppointmentIdRef.current = foundToday.id;
        return foundToday;
      }

      // Otherwise find the latest active appointment (scheduled or waiting)
      list.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
      const foundPast = list.find(app => (app.status === 'scheduled' || app.status === 'waiting') && app.date <= todayStr);
      if (foundPast) {
        currentTodayAppointmentIdRef.current = foundPast.id;
        return foundPast;
      }
    } catch (err) {
      console.error("Error in findAppointmentInDbOrState DB fetch:", err);
    }

    return null;
  };

  const getPaymentMethodLabel = (method?: string) => {
    const norm = normalizePaymentMethod(method);
    if (norm === 'كاش') return 'كاش';
    if (norm === 'فيزا') return 'فيزا';
    if (norm === 'إنستاباي') return 'إنستاباي';
    if (norm === 'محفظة') return 'محفظة إلكترونية';
    return method || 'كاش';
  };

  const handleRecordPatientPayment = async (app: Appointment) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    const amt = Number(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      dialogs.alert('يرجى إدخال قيمة صحيحة للدفعة المحصلة', { severity: 'warning' });
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

    setLoadingPatientAppointments(true);
    try {
      const ref = getAppointmentsRef(clinic.id);
      const docRef = doc(ref, app.id);
      const newPaid = currentPaid + amt;
      const newRemaining = Math.max(0, currentRemaining - amt);
      const newPrice = Math.max(app.price, newPaid);
      const newStatus = newRemaining === 0 ? 'paid' : 'installment';

      const existingPayments = app.payments && Array.isArray(app.payments) ? [...app.payments] : [];
      const sumExisting = existingPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
      const resolvedPayments = [...existingPayments];
      if (currentPaid > sumExisting) {
        resolvedPayments.unshift({
          id: 'pay_init_' + app.id,
          amount: currentPaid - sumExisting,
          paymentMethod: app.paymentMethod || 'كاش',
          date: (app as any).paymentDate || app.date || getEgyptTodayStr(),
          createdAt: app.updatedAt || app.createdAt || new Date().toISOString(),
          notes: 'الدفعة الأولى السابقة',
          type: 'initial'
        });
      }

      const selectedMethod = paymentMethod || paymentMethodsList[0] || 'كاش';

      const newPaymentRecord = {
        id: 'pay_' + Math.random().toString(36).substring(2, 11),
        amount: amt,
        paymentMethod: selectedMethod,
        date: (activeShift && activeShift.date) ? activeShift.date : getEgyptTodayStr(),
        createdAt: new Date().toISOString(),
        shiftId: activeShift?.id || undefined,
        notes: paymentNotes ? `سداد قسط: ${paymentNotes}` : 'سداد قسط',
        type: 'installment'
      };

      const updatedPayments = [...resolvedPayments, newPaymentRecord];
      const updatedNotes = cleanNotes(app.notes || '') + (paymentNotes.trim() ? `\n• ${paymentNotes.trim()}` : '');

      await updateDoc(docRef, {
        paidAmount: newPaid,
        remainingAmount: newRemaining,
        price: newPrice,
        invoiceStatus: newStatus,
        paymentMethod: selectedMethod,
        payments: updatedPayments,
        shiftId: activeShift?.id || app.shiftId || undefined,
        updatedAt: new Date().toISOString(),
        notes: updatedNotes.trim()
      });

      // Dispatch sync events so calendar and financials update in real time
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'appointments' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'records' } }));

      setRecordingPaymentAppId(null);
      setPaymentAmount(0);
      setPaymentNotes('');
      dialogs.alert('تم تسجيل الدفعة وتحديث حساب المريض الفوري بنجاح!', { severity: 'success' });
      await autoMarkWaitingAppointmentCompleted();
      await fetchPatientAppointments(selectedPatientId);
      if (onRefreshAppointments) {
        onRefreshAppointments(true, app.date || getLocalTodayString(), true);
      }
    } catch (err: any) {
      console.error(err);
      dialogs.alert('فشل حفظ الدفعة: ' + err.toString(), { severity: 'error' });
    } finally {
      setLoadingPatientAppointments(false);
    }
  };

  const handleUpdateAppointmentPrice = async (app: Appointment) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    const priceVal = Number(newAppPrice);
    if (isNaN(priceVal) || priceVal < 0) {
      dialogs.alert('يرجى إدخال قيمة صحيحة للتكلفة أكبر من أو تساوي الصفر', { severity: 'warning' });
      return;
    }

    setLoadingPatientAppointments(true);
    try {
      const ref = getAppointmentsRef(clinic.id);
      const docRef = doc(ref, app.id);
      
      const currentPaid = app.paidAmount !== undefined ? app.paidAmount : 0;
      const newRemaining = Math.max(0, priceVal - currentPaid);

      await updateDoc(docRef, {
        price: priceVal,
        remainingAmount: newRemaining,
        paidAmount: currentPaid
      });

      setEditingPriceAppId(null);
      setNewAppPrice(0);
      dialogs.alert('تم تحديد وتعديل تكلفة الإجراء الطبي للموعد بنجاح!', { severity: 'success' });
      await autoMarkWaitingAppointmentCompleted();
      await fetchPatientAppointments(selectedPatientId);
      if (onRefreshAppointments) {
        onRefreshAppointments(true, app.date || getLocalTodayString(), true);
      }
    } catch (err: any) {
      console.error(err);
      dialogs.alert('فشل تعديل التكلفة: ' + err.toString(), { severity: 'error' });
    } finally {
      setLoadingPatientAppointments(false);
    }
  };

  const handlePrintAppointmentInvoice = (app: Appointment) => {
    const todayStr = new Date().toLocaleString('ar-EG');
    const paid = app.paidAmount !== undefined ? app.paidAmount : app.price;
    const remaining = app.remainingAmount !== undefined ? app.remainingAmount : 0;
    
    const invoiceHTML = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>فاتورة علاجية - ${clinic.nameAr || clinic.name}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Cairo', sans-serif;
            background-color: #ffffff;
            color: #0f172a;
            margin: 40px;
            direction: rtl;
          }
          @media print {
            @page {
              size: A5 portrait;
              margin: 8mm;
            }
            body {
              margin: 0;
              padding: 0;
              background-color: #ffffff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .invoice-box {
              border: none !important;
              box-shadow: none !important;
              padding: 10px !important;
              margin: 0 !important;
              max-width: 100% !important;
            }
          }
          .invoice-box {
            max-width: 800px;
            margin: auto;
            border: 1px solid #e2e8f0;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
          }
          .header {
            display: flex;
            justify-content: space-between;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 20px;
            margin-bottom: 20px;
          }
          .title {
            text-align: center;
            font-size: 20px;
            font-weight: 900;
            margin: 20px 0;
            border-top: 1px solid #e2e8f0;
            border-bottom: 1px solid #e2e8f0;
            padding: 10px 0;
          }
          .details-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          .details-table th {
            background-color: #f1f5f9;
            padding: 12px;
            border: 1px solid #cbd5e1;
            text-align: right;
            font-size: 13px;
          }
          .details-table td {
            padding: 12px;
            border: 1px solid #cbd5e1;
            font-size: 13px;
          }
          .summary-box {
            width: 300px;
            margin-right: auto;
            margin-top: 20px;
            border-top: 2px solid #e2e8f0;
            padding-top: 10px;
          }
          .summary-row {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 13px;
          }
          .total-paid {
            color: #10b981;
            font-weight: 900;
            background-color: #f0fdf4;
            padding: 4px 8px;
            border-radius: 6px;
          }
          .total-remaining {
            color: #d97706;
            font-weight: 900;
            background-color: #fffbeb;
            padding: 4px 8px;
            border-radius: 6px;
          }
          .notes {
            margin-top: 30px;
            padding: 15px;
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            font-size: 11px;
            color: #475569;
          }
          .footer {
            margin-top: 50px;
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: #94a3b8;
          }
        </style>
      </head>
      <body>
        <div class="invoice-box">
          <div class="header">
            <div>
              <h1 style="margin: 0; font-size: 22px;">${clinic.nameAr || clinic.name}</h1>
              <p style="margin: 5px 0 0; font-size: 12px; color: #64748b;">الدكتور: ${clinic.doctorName || 'طبيب متخصص'}</p>
            </div>
            <div style="text-align: left;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">تاريخ الطباعة: ${todayStr}</p>
              <p style="margin: 5px 0 0; font-size: 11px; color: #64748b;">هاتف: ${clinic.doctorPhone || ''}${clinic.additionalPhones && clinic.additionalPhones.length > 0 ? ' - ' + clinic.additionalPhones.filter(Boolean).join(' - ') : ''}</p>
            </div>
          </div>

          <div class="title">كشف حساب الجلسة والفواتير التابعة للمريض</div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px; margin-bottom: 20px;">
            <p><strong>اسم المريض:</strong> ${app.patientName}</p>
            <p><strong>الهاتف:</strong> ${app.patientPhone || 'غير مسجل'}</p>
            <p><strong>تاريخ الموعد:</strong> ${app.date}</p>
            <p><strong>نوع العلاج:</strong> ${app.treatmentType || 'علاج طبي عام'}</p>
          </div>

          <table class="details-table">
            <thead>
              <tr>
                <th>الإجراء العلاجي</th>
                <th style="text-align: center;">الحالة</th>
                <th style="text-align: left;">التكلفة الإجمالية</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>${app.treatmentType || 'عام'}</strong></td>
                 <td style="text-align: center;">${app.status === 'completed' ? 'تم تقديم الخدمة' : app.status === 'waiting' ? 'انتظار بالعيادة' : 'موعد مجدول'}</td>
                <td style="text-align: left; font-weight: bold;">${app.price.toLocaleString()} ج.م</td>
              </tr>
            </tbody>
          </table>

          <div class="summary-box">
            <div class="summary-row">
              <span>التكلفة الإجمالية:</span>
              <span style="font-weight: bold;">${app.price.toLocaleString()} ج.م</span>
            </div>
            <div class="summary-row total-paid">
              <span>إجمالي المدفوع حتى الآن:</span>
              <span>${paid.toLocaleString()} ج.م</span>
            </div>
            <div class="summary-row total-remaining">
              <span>المتبقي (الآجل):</span>
              <span>${remaining.toLocaleString()} ج.م</span>
            </div>
          </div>

          ${app.notes ? `
            <div class="notes">
              <strong>ملاحظات الحساب وسجل السداد:</strong>
              <p style="margin: 5px 0 0; white-space: pre-line; line-height: 1.5;">${app.notes}</p>
            </div>
          ` : ''}

          <div class="footer">
            <span>توقيع الحسابات: .........................</span>
            <span>اعتماد الطبيب: .........................</span>
          </div>
        </div>
      </body>
      </html>
    `;

    setPreviewInvoiceHtml(invoiceHTML);
  };

  useEffect(() => {
    fetchPatients();

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};
      if (table === 'patients') {
        console.log('[PatientMedicalFile] Instant patients list sync triggered!');
        fetchPatients();
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => window.removeEventListener('clinic-sync', handleSync);
  }, [clinic.id]);

  // Ref-based state synchronization to prevent unnecessary event listener teardown/re-registration
  const syncStateRef = useRef({
    patients,
    isAddingRecord,
    isAddingPrescriptionStandalone,
    recordingPaymentAppId,
    editingPriceAppId,
    receptionPayingAppId,
    loadingRecords,
    loadingPrescriptions,
    loadingPatientAppointments
  });

  useEffect(() => {
    syncStateRef.current = {
      patients,
      isAddingRecord,
      isAddingPrescriptionStandalone,
      recordingPaymentAppId,
      editingPriceAppId,
      receptionPayingAppId,
      loadingRecords,
      loadingPrescriptions,
      loadingPatientAppointments
    };
  }, [
    patients,
    isAddingRecord,
    isAddingPrescriptionStandalone,
    recordingPaymentAppId,
    editingPriceAppId,
    receptionPayingAppId,
    loadingRecords,
    loadingPrescriptions,
    loadingPatientAppointments
  ]);

  const lastPatientIdRef = useRef<string>('');
  const currentTodayAppointmentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedPatientId && selectedPatientId !== lastPatientIdRef.current) {
      lastPatientIdRef.current = selectedPatientId;
      currentTodayAppointmentIdRef.current = null;
      setIsAddingRecord(false);
      setIsAddingPrescriptionStandalone(false);
      setAddPrescriptionWithVisit(false);
      setRightColTab(null);
    }
  }, [selectedPatientId]);

  useEffect(() => {
    if (selectedPatientId) {
      // Fetch all patient details simultaneously in parallel
      Promise.allSettled([
        fetchPatientRecords(selectedPatientId, patients),
        fetchPatientPrescriptions(selectedPatientId),
        fetchPatientAppointments(selectedPatientId),
        fetchPatientXRays(selectedPatientId, undefined)
      ]);
    }

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};
      
      const {
        patients: currentPatients,
        isAddingRecord: currentIsAddingRecord,
        isAddingPrescriptionStandalone: currentIsAddingPrescriptionStandalone,
        recordingPaymentAppId: currentRecordingPaymentAppId,
        editingPriceAppId: currentEditingPriceAppId,
        receptionPayingAppId: currentReceptionPayingAppId,
        loadingRecords: currentLoadingRecords,
        loadingPrescriptions: currentLoadingPrescriptions,
        loadingPatientAppointments: currentLoadingPatientAppointments
      } = syncStateRef.current;

      const relevantTables = ['records', 'prescriptions', 'appointments', 'patients', 'xrays'];
      if (
        selectedPatientId &&
        relevantTables.includes(table) &&
        !currentIsAddingRecord &&
        !currentIsAddingPrescriptionStandalone &&
        !currentRecordingPaymentAppId &&
        !currentEditingPriceAppId &&
        !currentReceptionPayingAppId &&
        !currentLoadingRecords &&
        !currentLoadingPrescriptions &&
        !currentLoadingPatientAppointments
      ) {
        console.log(`[PatientMedicalFile] Instant details sync triggered for table: ${table}`);
        Promise.allSettled([
          fetchPatientRecords(selectedPatientId, currentPatients, undefined, true),
          fetchPatientPrescriptions(selectedPatientId, true),
          fetchPatientAppointments(selectedPatientId, true),
          fetchPatientXRays(selectedPatientId, undefined, true)
        ]);
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => window.removeEventListener('clinic-sync', handleSync);
  }, [selectedPatientId]);

  const handlePrintPrescription = (presc: Prescription) => {
    const pDate = new Date(presc.date);
    const todayStr = !isNaN(pDate.getTime()) ? `${pDate.getDate()}/${pDate.getMonth() + 1}/${pDate.getFullYear()}` : presc.date;

    const effectivePadConfig = getEffectivePadConfig(clinic.id, clinic.customPrescriptionPadConfig);

    const pStyle = presc.prescriptionStyle || (effectivePadConfig.backgroundImage ? 'custom_pad' : clinic.prescriptionStyle || 'classic');
    const pLayout = presc.prescriptionLayout || clinic.prescriptionLayout || 'traditional';

    const prescriptionHTML = generatePrescriptionHTML({
      clinic,
      patientName: presc.patientName,
      patientAge: presc.patientAge,
      dateStr: todayStr,
      medications: presc.medications,
      notes: presc.notes,
      prescriptionStyle: pStyle,
      prescriptionLayout: pLayout,
      customPrescriptionPadConfig: effectivePadConfig
    });

    setPreviewPrescriptionHtml(prescriptionHTML);
  };

  const _deadPrescriptionHTML = () => {
    const borderStyle = '', watermarkStyle = '', primaryColor = '', headerBg = '', logoHTML = '', medsHTML = '', presc: any = {}, todayStr = '';
    const prescriptionHTML = `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>روشتة علاجية - ${clinic.nameEn || clinic.name}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
          
          body {
            font-family: 'Cairo', sans-serif;
            background-color: #ffffff;
            color: #0f172a;
            margin: 0;
            padding: 0;
            direction: rtl;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .prescription-container {
            width: 100%;
            max-width: 800px;
            min-height: 98vh;
            margin: 0 auto;
            box-sizing: border-box;
            border: ${borderStyle};
            padding: 40px;
            position: relative;
            display: flex;
            flex-direction: column;
            background-color: #ffffff;
          }

          .watermark-bg {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 520px;
            height: 520px;
            opacity: 0.15;
            ${watermarkStyle}
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            z-index: 1;
            pointer-events: none;
          }

          /* Header Section */
          .header-layout {
            display: grid;
            grid-template-columns: 2.5fr 1.2fr 2.5fr;
            align-items: center;
            background-color: ${primaryColor};
            color: #ffffff;
            padding: 24px 30px;
            border-radius: 12px;
            margin-bottom: 25px;
            z-index: 10;
            position: relative;
          }
          .header-right {
            text-align: right;
          }
          .header-left {
            text-align: left;
          }
          .header-center {
            text-align: center;
            display: flex;
            justify-content: center;
            align-items: center;
          }

          .clinic-logo-img {
            max-height: 110px;
            max-width: 240px;
            object-fit: contain;
          }
          .clinic-logo-placeholder {
            width: 100px;
            height: 100px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 52px;
            color: #ffffff;
            font-weight: bold;
          }

          .clinic-title-ar {
            font-size: 21px;
            color: #ffffff;
            margin: 0;
            font-weight: 900;
          }
          .clinic-title-en {
            font-size: 20px;
            color: #ffffff;
            margin: 0;
            font-weight: 800;
            font-family: system-ui, sans-serif;
          }
          
          .doctor-name-ar {
            font-size: 15px;
            color: #f8fafc;
            margin: 5px 0 0 0;
            font-weight: 700;
          }
          .doctor-name-en {
            font-size: 15px;
            color: #f8fafc;
            margin: 5px 0 0 0;
            font-weight: 700;
            font-family: system-ui, sans-serif;
          }
          
          .specialty-ar {
            font-size: 11.5px;
            color: #e2e8f0;
            margin: 3px 0 0 0;
            font-weight: 600;
            line-height: 1.3;
          }
          .specialty-en {
            font-size: 11.5px;
            color: #e2e8f0;
            margin: 3px 0 0 0;
            font-weight: 600;
            line-height: 1.3;
            font-family: system-ui, sans-serif;
          }

          /* Patient Card */
          .patient-card {
            background-color: ${headerBg};
            border-radius: 12px;
            padding: 14px 20px;
            margin-bottom: 30px;
            font-size: 13.5px;
            border: 1px solid ${primaryColor}25;
            z-index: 10;
            position: relative;
            display: grid;
            grid-template-columns: 2.2fr 1fr 1.3fr;
            gap: 15px;
          }
          .patient-field {
            display: flex;
            gap: 6px;
            align-items: center;
          }
          .patient-field strong {
            color: ${primaryColor};
            font-weight: 700;
          }

          /* Rx Symbol */
          .rx-logo {
            font-size: 45px;
            font-weight: 900;
            color: ${primaryColor};
            line-height: 1;
            margin-bottom: 25px;
            font-style: italic;
            z-index: 10;
            position: relative;
            font-family: 'Times New Roman', Times, serif;
          }

          .prescription-body {
            flex: 1;
            z-index: 10;
            position: relative;
          }

          /* List Style Drugs */
          .prescription-meds-list {
            margin-top: 15px;
            margin-bottom: 30px;
            text-align: right;
          }
          .med-item {
            margin-bottom: 22px;
            padding-bottom: 12px;
            border-bottom: 1px dashed #e2e8f0;
          }
          .med-item:last-child {
            border-bottom: none;
          }
          .med-name {
            font-size: 17px;
            font-weight: 800;
            color: #0f172a;
            font-family: 'JetBrains Mono', 'Inter', system-ui, sans-serif;
            text-align: left;
            direction: ltr;
          }
          .med-instructions {
            font-size: 13px;
            font-weight: 600;
            color: #475569;
            margin-top: 5px;
            padding-right: 15px;
            text-align: right;
            direction: rtl;
          }

          /* Table Style Drugs */
          .med-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 40px;
          }
          .med-table th {
            background-color: ${primaryColor};
            color: white;
            padding: 12px 14px;
            font-size: 13px;
            text-align: right;
            font-weight: 700;
          }
          .med-table th:first-child {
            border-radius: 0 10px 10px 0;
          }
          .med-table th:last-child {
            border-radius: 10px 0 0 10px;
          }
          .med-table td {
            border-bottom: 1px solid #e2e8f0;
            padding: 14px 14px;
            font-size: 13.5px;
            color: #334155;
          }
          .med-table tr:hover td {
            background-color: #f8fafc;
          }

          /* Notes Section */
          .notes-section {
            background-color: #f8fafc;
            border-right: 4px solid ${primaryColor};
            padding: 15px 20px;
            border-radius: 4px 12px 12px 4px;
            font-size: 13px;
            color: #475569;
            line-height: 1.6;
            margin-top: 30px;
          }
          .notes-section strong {
            color: #1e293b;
            display: block;
            margin-bottom: 6px;
            font-weight: 700;
          }

          /* Bottom Footer */
          .footer-info {
            margin-top: auto;
            border-top: 2px solid ${primaryColor}30;
            padding-top: 20px;
            z-index: 10;
            position: relative;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .signature-box {
            text-align: center;
            font-size: 12px;
            color: #475569;
          }
          .signature-line {
            width: 170px;
            border-bottom: 1.5px solid #cbd5e1;
            margin-top: 35px;
          }
          
          .footer-clinic-details {
            font-size: 10.5px;
            color: #64748b;
            text-align: left;
            max-width: 400px;
            line-height: 1.5;
          }
          .footer-hours {
            font-size: 10.5px;
            color: #475569;
            text-align: center;
            font-weight: 600;
            background-color: ${headerBg};
            padding: 4px 12px;
            border-radius: 20px;
            border: 1px solid ${primaryColor}15;
          }

          @media print {
            @page {
              size: A5 portrait;
              margin: 5mm;
            }
            html, body {
              height: 100% !important;
              min-height: 100% !important;
              padding: 0 !important;
              margin: 0 !important;
              background-color: #fff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .prescription-container {
              display: flex !important;
              flex-direction: column !important;
              justify-content: space-between !important;
              border: ${borderStyle} !important;
              box-shadow: none !important;
              padding: 20px !important;
              width: 100% !important;
              height: 100% !important;
              min-height: 100% !important;
              box-sizing: border-box !important;
            }
            .watermark-bg {
              width: 280px !important;
              height: 280px !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .header-layout {
              padding: 12px 18px !important;
              margin-bottom: 15px !important;
              border-radius: 8px !important;
            }
            .clinic-logo-img {
              max-height: 65px !important;
              max-width: 150px !important;
            }
            .clinic-logo-placeholder {
              width: 60px !important;
              height: 60px !important;
              font-size: 32px !important;
            }
            .clinic-title-ar {
              font-size: 15px !important;
            }
            .clinic-title-en {
              font-size: 14px !important;
            }
            .doctor-name-ar, .doctor-name-en {
              font-size: 11.5px !important;
              margin-top: 3px !important;
            }
            .specialty-ar, .specialty-en {
              font-size: 8.5px !important;
            }
            .patient-card {
              padding: 8px 15px !important;
              margin-bottom: 15px !important;
              font-size: 11.5px !important;
              gap: 10px !important;
              border-radius: 8px !important;
            }
            .rx-logo {
              font-size: 30px !important;
              margin-bottom: 15px !important;
            }
            .med-name {
              font-size: 13.5px !important;
            }
            .med-instructions {
              font-size: 10.5px !important;
            }
            .med-item {
              margin-bottom: 12px !important;
              padding-bottom: 8px !important;
            }
            .med-table th {
              padding: 8px 10px !important;
              font-size: 11px !important;
            }
            .med-table td {
              padding: 8px 10px !important;
              font-size: 11px !important;
            }
            .notes-section {
              padding: 10px 15px !important;
              margin-top: 15px !important;
              font-size: 11px !important;
              border-radius: 4px 8px 8px 4px !important;
            }
            .footer-info {
              padding-top: 10px !important;
            }
            .signature-line {
              width: 120px !important;
              margin-top: 20px !important;
            }
            .footer-clinic-details {
              font-size: 9px !important;
            }
            .footer-hours {
              font-size: 9px !important;
              padding: 2px 10px !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="prescription-container">
          <!-- Background Watermark of Clinic Logo -->
          <div class="watermark-bg"></div>

          <div class="prescription-body">
            <!-- Top Header with Clinic Info & Logo -->
            <div class="header-layout">
              <div class="header-right">
                <h2 class="clinic-title-ar">${clinic.nameAr || clinic.name}</h2>
                <p class="doctor-name-ar">دكتور: ${clinic.doctorName || 'طبيب الأسنان المعتمد'}</p>
                <p class="specialty-ar">${clinic.doctorSpecialtyAr || 'طب وجراحة الفم والأسنان المتقدم وتجميلها'}</p>
              </div>
              
              <div class="header-center">
                ${logoHTML}
              </div>
              
              <div class="header-left">
                <h2 class="clinic-title-en">${clinic.nameEn || 'Dental Clinic'}</h2>
                <p class="doctor-name-en">Dr. ${clinic.doctorNameEn || clinic.doctorName || 'Dental Specialist'}</p>
                <p class="specialty-en">${clinic.doctorSpecialtyEn || 'Specialist of Oral & Dental Surgery'}</p>
              </div>
            </div>

            <!-- Patient Information Bar -->
            <div class="patient-card">
              <div class="patient-field">
                <strong>${isEn ? 'Patient Name:' : 'اسم المريض:'}</strong>
                <span>${presc.patientName}</span>
              </div>
              <div class="patient-field">
                <strong>${isEn ? 'Age:' : 'العمر:'}</strong>
                <span>${presc.patientAge || (isEn ? 'N/A' : 'غير محدد')} ${isEn ? 'yrs' : 'سنة'}</span>
              </div>
              <div class="patient-field" style="justify-content: flex-end;">
                <strong>${isEn ? 'Date:' : 'التاريخ:'}</strong>
                <span>${todayStr}</span>
              </div>
            </div>

            <!-- Medications list -->
            <div style="margin-top: 15px;">
              ${medsHTML}
            </div>
          </div>

          <!-- Clinical Notes - Placed at the very bottom above the signatures and footer -->
          <div class="notes-section">
            <strong>${isEn ? 'Medical Instructions & Recommendations:' : 'التوصيات الطبية والإرشادية للمريض:'}</strong>
            <p>${presc.notes || (isEn ? 'No special recommendations. Please adhere to prescribed doses above.' : 'لا توجد توصيات خاصة. يرجى الالتزام بالجرعات الدوائية المحددة أعلاه.')}</p>
          </div>

          <!-- Bottom Footer and Signatures -->
          <div class="footer-info">
            <div class="signature-box">
              <p>${isEn ? 'Doctor Signature & Stamp' : 'توقيع وختم الطبيب المعالج'}</p>
              <div class="signature-line"></div>
            </div>
            
            ${clinic.clinicHours ? `
              <div class="footer-hours">
                ${isEn ? 'Working Hours:' : 'مواعيد العمل:'} ${clinic.clinicHours}
              </div>
            ` : ''}
            
            <div class="footer-clinic-details">
              <p><strong>${isEn ? 'Address:' : 'العنوان:'}</strong> ${clinic.address || (isEn ? 'Official Clinic Address' : 'عنوان العيادة الرسمي')}</p>
              <p style="margin-top: 3px;"><strong>${isEn ? 'Contact / Booking:' : 'للاتصال والحجز:'}</strong> ${clinic.doctorPhone || (isEn ? 'N/A' : 'غير مسجل')}${clinic.additionalPhones && clinic.additionalPhones.length > 0 ? ' - ' + clinic.additionalPhones.filter(Boolean).join(' - ') : ''}</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    setPreviewPrescriptionHtml(prescriptionHTML);
  };

  const handleSaveStandalonePrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!selectedPatientId || !activePatient) return;
    if (prescriptionMedications.length === 0) {
      dialogs.alert(isEn ? 'Please add at least one medication to the prescription' : 'يرجى إضافة دواء واحد على الأقل للروشتة', { severity: 'warning' });
      return;
    }

    try {
      const prescRef = getPrescriptionsRef(clinic.id);
      await addDoc(prescRef, {
        patientId: selectedPatientId,
        patientName: activePatient.name,
        patientAge: patientAgeInput,
        date: new Date().toISOString(),
        medications: prescriptionMedications,
        notes: prescriptionNotes.trim(),
        prescriptionStyle: clinic.prescriptionStyle || 'classic',
        prescriptionLayout: clinic.prescriptionLayout || 'traditional'
      });

      setIsAddingPrescriptionStandalone(false);
      // Reset prescription medications
      setPrescriptionMedications([]);
      setPrescriptionNotes(isEn ? 'Rinse with warm salt water, avoid hot liquids for 24 hours.' : 'المضمضة بالماء الدافئ والملح، وتجنب السوائل الساخنة لمدة 24 ساعة.');

      await autoMarkWaitingAppointmentCompleted();
      await fetchPatientPrescriptions(selectedPatientId, true);
    } catch (err: any) {
      console.error(err);
      setError((isEn ? 'Failed to add medical prescription: ' : 'فشل إضافة الروشتة الطبية: ') + (err.message || err.toString()));
    }
  };

  const handleDeletePrescription = (prescId: string) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete items. Deletion is available for doctors only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    setDeleteConfirm({ type: 'prescription', id: prescId });
  };

  const handleDeleteRecord = (recordId: string) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete items. Deletion is available for doctors only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    setDeleteConfirm({ type: 'record', id: recordId });
  };

  const handleDeleteProcedure = (recordId: string, procRow: any) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete items. Deletion is available for doctors only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    setDeleteConfirm({ type: 'procedure', id: recordId, procedure: procRow });
  };

  const handleDeleteVisit = (visit: any) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete items. Deletion is available for doctors only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    setDeleteConfirm({ type: 'visit', id: visit.dateKey, visit });
  };

  const executeDeletePrescription = async (prescId: string) => {
    try {
      setPrescriptions(prev => prev.filter(p => p.id !== prescId));
      const ref = getPrescriptionsRef(clinic.id);
      await deleteDoc(doc(ref, prescId));
      await fetchPatientPrescriptions(selectedPatientId, true);
    } catch (err: any) {
      console.error(err);
      setError((isEn ? 'Failed to delete medical prescription: ' : 'فشل حذف الروشتة الطبية: ') + (err.message || err.toString()));
      await fetchPatientPrescriptions(selectedPatientId, true);
    }
  };

  // Helper to safely restore teeth to healthy status in tooth chart if no other procedure uses them
  const updateToothChartAfterDeletion = async (
    targetTeethIdentifiers: (number | string | null | undefined)[],
    remainingRecords: PatientRecord[],
    deletedItemInfo?: { name?: string; treatment?: string; notes?: string; price?: number; date?: string; condition?: string }
  ) => {
    if (!selectedPatientId) return toothChart;

    let updatedToothChart = { ...(toothChart || {}) };
    let chartModified = false;

    // Collect all universal chart keys to inspect
    const universalKeysToCheck = new Set<number>();
    
    // 1. Direct teeth passed
    targetTeethIdentifiers.forEach(id => {
      if (id === null || id === undefined || id === '') return;
      const univ = getUniversalToothNumber(id);
      if (univ !== null) {
        universalKeysToCheck.add(univ);
      }
      const rawN = Number(id);
      if (!isNaN(rawN) && ((rawN >= 1 && rawN <= 32) || (rawN >= 101 && rawN <= 120))) {
        universalKeysToCheck.add(rawN);
      }
    });

    // 2. Extract tooth numbers from text in notes, name, or treatment (e.g. #18, [FDI: #18, #17, ...])
    const combinedText = `${deletedItemInfo?.notes || ''} ${deletedItemInfo?.name || ''} ${deletedItemInfo?.treatment || ''}`;
    const tagMatches = combinedText.matchAll(/#\s*(\d{1,3})/g);
    for (const m of tagMatches) {
      const rawVal = m[1];
      const univ = getUniversalToothNumber(rawVal);
      if (univ !== null) universalKeysToCheck.add(univ);
      const n = Number(rawVal);
      if (!isNaN(n) && ((n >= 1 && n <= 32) || (n >= 101 && n <= 120))) universalKeysToCheck.add(n);
    }

    // 3. Scan the entire toothChart for teeth associated with this treatment or multi-tooth conditions
    const searchName = (deletedItemInfo?.name || deletedItemInfo?.treatment || '').trim().toLowerCase();
    const isDenture = searchName.includes('متحرك') || searchName.includes('طقم') || searchName.includes('denture') || searchName.includes('أكريليك') || deletedItemInfo?.condition === 'denture';
    const isBridge = searchName.includes('جسر') || searchName.includes('bridge') || deletedItemInfo?.condition === 'bridge';
    const isOrtho = searchName.includes('تقويم') || searchName.includes('ortho') || deletedItemInfo?.condition === 'ortho';

    Object.entries(updatedToothChart).forEach(([keyStr, toothData]) => {
      const toothNum = Number(keyStr);
      if (isNaN(toothNum) || toothNum === 999) return;
      const univ = getUniversalToothNumber(toothNum) || toothNum;
      const tooth = toothData as DentalTooth;
      if (!tooth) return;

      // Check if tooth condition matches multi-tooth procedure
      if (isDenture && tooth.condition === 'denture') {
        universalKeysToCheck.add(univ);
      } else if (isBridge && tooth.condition === 'bridge') {
        universalKeysToCheck.add(univ);
      } else if (isOrtho && tooth.condition === 'ortho') {
        universalKeysToCheck.add(univ);
      }

      // Check if tooth history contains matching serviceName or notes
      if (tooth.history && Array.isArray(tooth.history)) {
        const matchesHistory = tooth.history.some(h => {
          const sName = (h.serviceName || '').trim().toLowerCase();
          const hNotes = (h.notes || '').trim().toLowerCase();
          if (searchName && (sName === searchName || sName.includes(searchName) || searchName.includes(sName))) return true;
          if (deletedItemInfo?.notes && hNotes && (hNotes.includes(deletedItemInfo.notes.toLowerCase()) || deletedItemInfo.notes.toLowerCase().includes(hNotes))) return true;
          return false;
        });
        if (matchesHistory) {
          universalKeysToCheck.add(univ);
        }
      }
    });

    if (universalKeysToCheck.size === 0) return toothChart;

    universalKeysToCheck.forEach(univKey => {
      const allRelatedKeys = getAllToothKeys(univKey);

      // Check if this tooth is still used in any remaining procedure across all remaining records
      const toothStillUsed = remainingRecords.some(r => {
        // 1. Check direct toothNumber
        const rToothKeys = getAllToothKeys(r.toothNumber);
        if (rToothKeys.some(k => allRelatedKeys.includes(k))) return true;

        // 2. Check procedures array
        if (r.procedures && Array.isArray(r.procedures)) {
          const hasInProcs = r.procedures.some(p => {
            const pKeys = getAllToothKeys(p.tooth);
            return pKeys.some(k => allRelatedKeys.includes(k));
          });
          if (hasInProcs) return true;
        }

        // 3. Check text in notes or treatment for tooth numbers
        const rText = `${r.notes || ''} ${r.treatment || ''}`;
        const rTagMatches = rText.matchAll(/#\s*(\d{1,3})/g);
        for (const m of rTagMatches) {
          const mUniv = getUniversalToothNumber(m[1]);
          if (mUniv && allRelatedKeys.includes(mUniv)) return true;
        }

        return false;
      });

      if (!toothStillUsed) {
        // No remaining active treatment on this tooth -> Restore directly to 100% healthy
        allRelatedKeys.forEach(k => {
          delete updatedToothChart[k];
        });
        updatedToothChart[univKey] = {
          toothNumber: univKey,
          condition: 'healthy',
          notes: '',
          treatmentDate: undefined,
          history: []
        };
        chartModified = true;
      } else {
        // Tooth has other active treatments -> Clean the deleted procedure from its history
        if (updatedToothChart[univKey]?.history && deletedItemInfo) {
          const delName = (deletedItemInfo.name || deletedItemInfo.treatment || '').trim().toLowerCase();
          const cleanHistory = (updatedToothChart[univKey].history || []).filter(h => {
            const sName = (h.serviceName || '').trim().toLowerCase();
            if (delName && (sName === delName || sName.includes(delName) || delName.includes(sName))) return false;
            return true;
          });

          if (cleanHistory.length === 0) {
            allRelatedKeys.forEach(k => {
              delete updatedToothChart[k];
            });
            updatedToothChart[univKey] = {
              toothNumber: univKey,
              condition: 'healthy',
              notes: '',
              treatmentDate: undefined,
              history: []
            };
          } else {
            const latestRemaining = cleanHistory[cleanHistory.length - 1];
            updatedToothChart[univKey] = {
              ...updatedToothChart[univKey],
              condition: latestRemaining.condition || 'healthy',
              notes: latestRemaining.notes || '',
              treatmentDate: latestRemaining.date,
              history: cleanHistory
            };
          }
          chartModified = true;
        }
      }
    });

    if (chartModified) {
      setToothChart({ ...updatedToothChart });
      setPatients(prev => prev.map(p => {
        if (p.id === selectedPatientId) {
          return { ...p, toothChart: updatedToothChart };
        }
        return p;
      }));

      const patientDocRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatientId);
      await setDoc(patientDocRef, cleanDbData({
        clinicId: clinic.id,
        toothChart: updatedToothChart,
        updatedAt: new Date().toISOString()
      }), { merge: true });
    }

    return updatedToothChart;
  };

  // Helper to remove procedure from appointment and recalculate financial balances
  const updateAppointmentAfterDeletion = async (
    appointmentId: string,
    dateStr: string,
    deletedItem: { name?: string; price?: number; tooth?: number | string | null }
  ) => {
    let targetApp: Appointment | undefined;
    if (appointmentId) {
      targetApp = patientAppointments.find(a => a.id === appointmentId);
    }
    if (!targetApp && dateStr) {
      const rawDate = dateStr.split('T')[0];
      targetApp = patientAppointments.find(a => a.date === rawDate);
    }
    if (!targetApp && appointmentId) {
      try {
        const appSnap = await getDoc(doc(getAppointmentsRef(clinic.id), appointmentId), true);
        if (appSnap.exists()) {
          targetApp = { id: appSnap.id, ...appSnap.data() } as Appointment;
        }
      } catch (e) {
        console.warn("Could not fetch app doc:", e);
      }
    }

    if (!targetApp) return;

    const deletedCost = Number(deletedItem.price) || 0;
    const currentPrice = Number(targetApp.price) || 0;
    const currentPaid = Number(targetApp.paidAmount) || 0;
    const delToothKeys = getAllToothKeys(deletedItem.tooth);

    let updatedProcedures = Array.isArray(targetApp.procedures) ? [...targetApp.procedures] : [];
    if (updatedProcedures.length > 0) {
      const idx = updatedProcedures.findIndex(p => {
        const pKeys = getAllToothKeys(p.tooth);
        const toothMatch = (!p.tooth && !deletedItem.tooth) || pKeys.some(k => delToothKeys.includes(k));
        const nameMatch = p.name === deletedItem.name || (deletedItem.name && deletedItem.name.includes(p.name)) || (p.name && deletedItem.name && p.name.includes(deletedItem.name));
        const priceMatch = Number(p.price) === deletedCost;
        return (toothMatch && (nameMatch || priceMatch)) || (nameMatch && priceMatch);
      });
      if (idx !== -1) {
        updatedProcedures.splice(idx, 1);
      } else {
        const fallbackIdx = updatedProcedures.findIndex(p => {
          const pKeys = getAllToothKeys(p.tooth);
          return pKeys.some(k => delToothKeys.includes(k)) || p.name === deletedItem.name;
        });
        if (fallbackIdx !== -1) {
          updatedProcedures.splice(fallbackIdx, 1);
        }
      }
    }

    let newPrice = 0;
    if (updatedProcedures.length > 0) {
      newPrice = updatedProcedures.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
    } else {
      newPrice = Math.max(0, currentPrice - deletedCost);
    }

    const newRemaining = Math.max(0, newPrice - currentPaid);

    let newTreatmentType = '';
    if (updatedProcedures.length > 0) {
      newTreatmentType = updatedProcedures.map(p => p.name).join(' + ');
    } else if (newPrice > 0) {
      newTreatmentType = (targetApp.treatmentType || '')
        .replace(deletedItem.name || '', '')
        .replace(/\+\s*\+/g, '+')
        .replace(/^\s*\+\s*|\s*\+\s*$/g, '')
        .trim();
    }

    let newInvoiceStatus: 'draft' | 'pending_payment' | 'paid' | 'installment' = 'draft';
    if (newPrice > 0) {
      if (newRemaining === 0 && currentPaid >= newPrice) newInvoiceStatus = 'paid';
      else if (currentPaid > 0) newInvoiceStatus = 'installment';
      else newInvoiceStatus = 'pending_payment';
    } else {
      newInvoiceStatus = currentPaid > 0 ? 'paid' : 'draft';
    }

    const appRef = getAppointmentsRef(clinic.id);
    const appDocRef = doc(appRef, targetApp.id);

    const updatedAppData = {
      ...(targetApp || {}),
      price: newPrice,
      remainingAmount: newRemaining,
      treatmentType: newTreatmentType,
      procedures: updatedProcedures,
      invoiceStatus: newInvoiceStatus,
      updatedAt: new Date().toISOString()
    };

    await setDoc(appDocRef, cleanDbData(updatedAppData), { merge: true });
    setPatientAppointments(prev => prev.map(a => a.id === targetApp!.id ? { ...a, ...updatedAppData } : a));
  };

  const executeDeleteProcedure = async (recordId: string, procRow?: any) => {
    try {
      const rec = records.find(r => r.id === recordId);
      if (!rec) {
        await executeDeleteRecord(recordId);
        return;
      }

      const currentProcs = (rec.procedures && Array.isArray(rec.procedures) && rec.procedures.length > 0)
        ? [...rec.procedures]
        : [{ name: rec.treatment, price: rec.cost, tooth: rec.toothNumber }];

      if (currentProcs.length <= 1 || !procRow) {
        await executeDeleteRecord(recordId);
        return;
      }

      const delToothKeys = getAllToothKeys(procRow.tooth);
      const delCost = Number(procRow.price) || 0;
      const delName = procRow.name || '';

      const idx = currentProcs.findIndex(p => {
        const pKeys = getAllToothKeys(p.tooth);
        const toothMatch = (!p.tooth && !procRow.tooth) || pKeys.some(k => delToothKeys.includes(k));
        const nameMatch = p.name === delName || (delName && delName.includes(p.name)) || (p.name && delName && p.name.includes(delName));
        const priceMatch = Number(p.price) === delCost;
        return (toothMatch && (nameMatch || priceMatch)) || (nameMatch && priceMatch);
      });

      if (idx !== -1) {
        currentProcs.splice(idx, 1);
      } else {
        currentProcs.pop();
      }

      const newCost = currentProcs.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
      const newTreatment = currentProcs.map(p => p.name).join(' + ');

      const updatedRec: PatientRecord = {
        ...rec,
        cost: newCost,
        treatment: newTreatment,
        procedures: currentProcs
      };

      const remainingRecords = records.map(r => r.id === recordId ? updatedRec : r);
      setRecords(remainingRecords);

      const recordsRef = getPatientRecordsRef(clinic.id, selectedPatientId);
      await setDoc(doc(recordsRef, recordId), cleanDbData(updatedRec), { merge: true });

      const updatedChart = await updateToothChartAfterDeletion([procRow.tooth, rec.toothNumber], remainingRecords, {
        name: procRow.name || rec.treatment,
        treatment: rec.treatment,
        notes: procRow.notes || rec.notes,
        price: procRow.price || rec.cost
      });
      await updateAppointmentAfterDeletion(rec.appointmentId || '', rec.date || '', procRow);

      clearQueryCache();
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'appointments' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patient_records' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patients' } }));

      if (onRefreshAppointments) {
        onRefreshAppointments();
      }

      await Promise.all([
        fetchPatientRecords(selectedPatientId, undefined, updatedChart, true),
        fetchPatientAppointments(selectedPatientId, true)
      ]);
    } catch (err: any) {
      console.error("Error executing delete procedure:", err);
      setError('فشل حذف الإجراء الطبي: ' + (err.message || err.toString()));
      await fetchPatientRecords(selectedPatientId, undefined, undefined, true);
    }
  };

  const executeDeleteRecord = async (recordId: string) => {
    try {
      const recToDelete = records.find(r => r.id === recordId);
      if (!recToDelete) {
        const ref = getPatientRecordsRef(clinic.id, selectedPatientId);
        await deleteDoc(doc(ref, recordId));
        await fetchPatientRecords(selectedPatientId, undefined, undefined, true);
        return;
      }

      // 1. التحديث الفوري للـ State المحلي للسجلات
      const remainingRecords = records.filter(r => r.id !== recordId);
      setRecords(remainingRecords);

      // 2. حذف صورة الأشعة من التخزين السحابي إذا وُجدت
      if (recToDelete.xrayUrl) {
        try {
          await deleteFileFromR2(recToDelete.xrayUrl);
        } catch (e) {
          console.warn("Failed to delete X-Ray file:", e);
        }
      }

      // 3. حذف السجل من قاعدة البيانات
      const recordsRef = getPatientRecordsRef(clinic.id, selectedPatientId);
      await deleteDoc(doc(recordsRef, recordId));

      // 4. تعديل شكل السن للطبيعي (Tooth Chart):
      const affectedTeethList: (number | string | null | undefined)[] = [];
      if (recToDelete.toothNumber) {
        affectedTeethList.push(recToDelete.toothNumber);
      }
      if (recToDelete.procedures && Array.isArray(recToDelete.procedures)) {
        recToDelete.procedures.forEach(p => {
          if (p.tooth) affectedTeethList.push(p.tooth);
        });
      }

      const updatedChart = await updateToothChartAfterDeletion(affectedTeethList, remainingRecords, {
        name: recToDelete.treatment,
        treatment: recToDelete.treatment,
        notes: recToDelete.notes,
        price: recToDelete.cost,
        date: recToDelete.date
      });

      // 5. مسح الإجراء من بطاقة الموعد والحسابات نهائياً (Appointment & Financials):
      await updateAppointmentAfterDeletion(recToDelete.appointmentId || '', recToDelete.date || '', {
        name: recToDelete.treatment,
        price: recToDelete.cost,
        tooth: recToDelete.toothNumber
      });

      // 6. مسح الكاش وتنبيه كافة الشاشات والتقويم والحسابات بالمزامنة الفورية
      clearQueryCache();
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'appointments' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patient_records' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patients' } }));

      if (onRefreshAppointments) {
        onRefreshAppointments();
      }

      await Promise.all([
        fetchPatientRecords(selectedPatientId, undefined, updatedChart, true),
        fetchPatientAppointments(selectedPatientId, true)
      ]);
    } catch (err: any) {
      console.error("Error executing delete record:", err);
      setError('فشل حذف الإجراء الطبي: ' + (err.message || err.toString()));
      await fetchPatientRecords(selectedPatientId, undefined, undefined, true);
    }
  };

  const executeDeleteVisit = async (visit: any) => {
    if (!visit || !visit.records || !Array.isArray(visit.records) || visit.records.length === 0) return;
    try {
      const recordsToDelete = visit.records as PatientRecord[];
      const recordIdsToDelete = recordsToDelete.map(r => r.id);

      // 1. التحديث الفوري للـ State المحلي للسجلات
      const remainingRecords = records.filter(r => !recordIdsToDelete.includes(r.id));
      setRecords(remainingRecords);

      // 2. حذف صور الأشعة وحذف السجلات من قاعدة البيانات
      const recordsRef = getPatientRecordsRef(clinic.id, selectedPatientId);
      for (const rec of recordsToDelete) {
        if (rec.xrayUrl) {
          try {
            await deleteFileFromR2(rec.xrayUrl);
          } catch (e) {
            console.warn("Failed to delete X-Ray file:", e);
          }
        }
        await deleteDoc(doc(recordsRef, rec.id));
      }

      // 3. جمع كافة الأسنان والإجراءات المتأثرة عبر كافة سجلات الزيارة
      const allAffectedTeeth: (number | string | null | undefined)[] = [];
      const deletedNames: string[] = [];
      const deletedNotes: string[] = [];
      recordsToDelete.forEach(rec => {
        if (rec.toothNumber) allAffectedTeeth.push(rec.toothNumber);
        if (rec.procedures && Array.isArray(rec.procedures)) {
          rec.procedures.forEach(p => {
            if (p.tooth) allAffectedTeeth.push(p.tooth);
          });
        }
        if (rec.treatment) deletedNames.push(rec.treatment);
        if (rec.notes) deletedNotes.push(rec.notes);
      });

      // 4. تعديل شكل خريطة الأسنان للطبيعي لكافة الأسنان والتركيبات
      const updatedChart = await updateToothChartAfterDeletion(allAffectedTeeth, remainingRecords, {
        name: deletedNames.join(' '),
        treatment: deletedNames.join(' '),
        notes: deletedNotes.join(' ')
      });

      // 5. مسح الإجراءات من بطاقات المواعيد والحسابات
      for (const rec of recordsToDelete) {
        await updateAppointmentAfterDeletion(rec.appointmentId || '', rec.date || '', {
          name: rec.treatment,
          price: rec.cost,
          tooth: rec.toothNumber
        });
      }

      // 6. مسح الكاش وتنبيه كافة الشاشات والتقويم والحسابات بالمزامنة الفورية
      clearQueryCache();
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'appointments' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patient_records' } }));
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'patients' } }));

      if (onRefreshAppointments) {
        onRefreshAppointments();
      }

      await Promise.all([
        fetchPatientRecords(selectedPatientId, undefined, updatedChart, true),
        fetchPatientAppointments(selectedPatientId, true)
      ]);
    } catch (e: any) {
      console.error("Error executing delete visit:", e);
      setError((isEn ? 'Failed to delete visit: ' : 'فشل حذف الزيارة: ') + (e.message || e.toString()));
      await fetchPatientRecords(selectedPatientId, undefined, undefined, true);
    }
  };

  const handleSaveToothChart = async (updatedChart: { [toothNumber: number]: DentalTooth }) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!selectedPatientId) return;
    try {
      // Update local state synchronously first to ensure immediate consistency
      setToothChart(updatedChart);
      setPatients(prev => prev.map(p => {
        if (p.id === selectedPatientId) {
          return { ...p, toothChart: updatedChart };
        }
        return p;
      }));

      const patientDocRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatientId);
      await setDoc(patientDocRef, cleanDbData({
        clinicId: clinic.id,
        toothChart: updatedChart,
        updatedAt: new Date().toISOString()
      }), { merge: true });

      await autoMarkWaitingAppointmentCompleted(true);
    } catch (err: any) {
      console.error("Error saving patient tooth chart:", err);
      setError((isEn ? 'Failed to save tooth chart: ' : 'فشل حفظ خريطة الأسنان: ') + (err.message || err.toString()));
    }
  };

  const handleAddSessionFromChart = async (
    toothNum: number,
    _condition: DentalTooth['condition'],
    serviceName: string,
    priceVal: number,
    notesStr: string,
    latestChart?: { [toothNumber: number]: DentalTooth }
  ) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!selectedPatientId) return;
    try {
      let currentPatientName = activePatient?.name || '';
      let currentPatientPhone = activePatient?.phone || '';

      if (!currentPatientName) {
        const pFromList = patients.find(p => p.id === selectedPatientId);
        if (pFromList) {
          currentPatientName = pFromList.name || '';
          currentPatientPhone = pFromList.phone || '';
        }
      }

      if (!currentPatientName) {
        try {
          const pDocRef = doc(getPatientsRef(clinic.id), selectedPatientId);
          const pSnap = await getDoc(pDocRef, true);
          if (pSnap.exists()) {
            const pData = pSnap.data();
            currentPatientName = pData?.name || '';
            currentPatientPhone = pData?.phone || '';
          }
        } catch (e) {
          console.error("Error fetching patient details on session creation:", e);
        }
      }

      if (latestChart) {
        setToothChart(latestChart);
      }
      const toothInfo = getToothInfo(toothNum);
      const tName = `${serviceName.trim()} (${toothInfo.fullText})`;
      const appRef = getAppointmentsRef(clinic.id);
      const todayStr = getEgyptTodayStr();

      let appDocId = '';
      let existingApp = null;

      const found = await findAppointmentInDbOrState(selectedPatientId);
      if (found) {
        appDocId = found.id;
        existingApp = found;
        if (!currentPatientName) currentPatientName = found.patientName || '';
        if (!currentPatientPhone) currentPatientPhone = found.patientPhone || '';
      } else {
        // Pre-generate new appointment doc reference locally (zero delay!)
        const newAppDocRef = doc(appRef);
        appDocId = newAppDocRef.id;
      }

      let invStatus: 'draft' | 'pending_payment' | 'paid' | 'installment' = 'draft';
      let recordProcedures: any[] = [];
      const writePromises: Promise<any>[] = [];

      if (existingApp) {
        const prevPrice = existingApp.price !== undefined ? Number(existingApp.price) : 0;
        const prevTreatment = existingApp.treatmentType ? existingApp.treatmentType.trim() : '';

        // Accumulate treatment names avoiding duplicates
        let combinedTreatment = prevTreatment;
        if (combinedTreatment) {
          if (!combinedTreatment.includes(tName.trim())) {
            combinedTreatment = `${combinedTreatment} + ${tName.trim()}`;
          }
        } else {
          combinedTreatment = tName.trim();
        }

        // Accumulate price
        const combinedPrice = prevPrice + priceVal;
        const currentPaid = existingApp.paidAmount !== undefined ? Number(existingApp.paidAmount) : 0;
        const newRemaining = Math.max(0, combinedPrice - currentPaid);

        if (combinedPrice > 0) {
          if (newRemaining <= 0 && currentPaid >= combinedPrice) invStatus = 'paid';
          else if (currentPaid > 0) invStatus = 'installment';
          else invStatus = 'pending_payment';
        }

        // Accumulate individual procedures
        let combinedProcedures: Array<{ name: string; price: number; tooth: number | null }> = [];
        if (existingApp.procedures && Array.isArray(existingApp.procedures) && existingApp.procedures.length > 0) {
          combinedProcedures = [...existingApp.procedures];
        } else if (existingApp.treatmentType) {
          const parts = existingApp.treatmentType.split('+').map((p: string) => p.trim()).filter(Boolean);
          if (parts.length > 1) {
            parts.forEach((pStr: string) => {
              combinedProcedures.push({
                name: pStr,
                price: Math.round((Number(existingApp.price) || 0) / parts.length),
                tooth: existingApp.toothNumber || null
              });
            });
          } else {
            combinedProcedures = [{
              name: existingApp.treatmentType.trim(),
              price: Number(existingApp.price) || 0,
              tooth: existingApp.toothNumber || null
            }];
          }
        }

        const isDup = combinedProcedures.some(cp => cp.name === tName.trim() && cp.price === priceVal);
        if (!isDup) {
          combinedProcedures.push({
            name: tName.trim(),
            price: priceVal,
            tooth: toothNum || null
          });
        }
        const currentSingleProcedure = [{
          name: tName.trim(),
          price: priceVal,
          tooth: toothNum || null
        }];

        const appDocRef = doc(appRef, appDocId);
        writePromises.push(setDoc(appDocRef, cleanDbData({
          ...(existingApp || {}),
          clinicId: clinic.id,
          patientName: currentPatientName || existingApp.patientName || (isEn ? 'New Patient' : 'مريض جديد'),
          patientPhone: currentPatientPhone || existingApp.patientPhone || '',
          status: 'completed',
          date: todayStr, // Ensure the appointment reflects today's date
          treatmentType: combinedTreatment,
          price: combinedPrice,
          paidAmount: currentPaid,
          remainingAmount: newRemaining,
          invoiceStatus: invStatus,
          financialNote: (existingApp && existingApp.financialNote) ? `${existingApp.financialNote}\n${isEn ? 'Sent from Dental Chart' : 'مرسل من خريطة الأسنان'}` : (isEn ? 'Sent directly from dental chart for receptionist collection' : 'مرسل من خريطة الأسنان مباشرة للتحصيل عند الممرضة / الاستقبال'),
          toothNumber: toothNum,
          notes: (() => {
            const prev = cleanNotes(existingApp?.notes);
            const curr = notesStr.trim();
            if (prev && curr) return `${prev}\n${curr}`;
            return prev || curr;
          })(),
          procedures: combinedProcedures
        }), { merge: true }));
        currentTodayAppointmentIdRef.current = appDocId;
      } else {
        invStatus = priceVal > 0 ? 'pending_payment' : 'draft';
        const initialProcs = [{ name: tName.trim(), price: priceVal, tooth: toothNum || null }];

        const appDocRef = doc(appRef, appDocId);
        writePromises.push(setDoc(appDocRef, cleanDbData({
          clinicId: clinic.id,
          patientId: selectedPatientId,
          patientName: currentPatientName || (isEn ? 'New Patient' : 'مريض جديد'),
          patientPhone: currentPatientPhone || '',
          date: todayStr,
          time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
          treatmentType: tName,
          price: priceVal,
          paidAmount: 0,
          remainingAmount: priceVal,
          status: 'completed',
          invoiceStatus: invStatus,
          financialNote: isEn ? 'Sent directly from dental chart for receptionist collection' : 'مرسل من خريطة الأسنان مباشرة للتحصيل عند الممرضة / الاستقبال',
          toothNumber: toothNum,
          notes: notesStr.trim(),
          procedures: initialProcs
        })));
        currentTodayAppointmentIdRef.current = appDocId;
      }

      const recordsRef = getPatientRecordsRef(clinic.id, selectedPatientId);
      const newRecordDocRef = doc(recordsRef);
      const currentSingleProcedure = [{ name: tName.trim(), price: priceVal, tooth: toothNum || null }];
      writePromises.push(setDoc(newRecordDocRef, cleanDbData({
        clinicId: clinic.id,
        patientId: selectedPatientId,
        date: new Date().toISOString(),
        treatment: tName,
        cost: priceVal,
        notes: notesStr.trim(),
        appointmentId: appDocId,
        invoiceStatus: invStatus,
        financialNote: isEn ? 'Sent directly from dental chart for receptionist collection' : 'مرسل من خريطة الأسنان مباشرة للتحصيل عند الممرضة / الاستقبال',
        toothNumber: toothNum,
        toothChart: latestChart || toothChart,
        procedures: currentSingleProcedure
      })));

      // Persist the updated tooth chart and patient record safely (creating patient doc if pending/new)
      const chartToSave = latestChart || toothChart;
      const patientDocRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatientId);
      const patientUpdatePayload: any = {
        clinicId: clinic.id,
        toothChart: chartToSave,
        updatedAt: new Date().toISOString()
      };
      if (currentPatientName && currentPatientName.trim()) {
        patientUpdatePayload.name = currentPatientName.trim();
      }
      if (currentPatientPhone && currentPatientPhone.trim()) {
        patientUpdatePayload.phone = currentPatientPhone.trim();
      }
      writePromises.push(setDoc(patientDocRef, cleanDbData(patientUpdatePayload), { merge: true }));

      // 1. Run all database writes concurrently
      await Promise.all(writePromises);

      // Clear query cache so all components see fresh appointments immediately
      clearQueryCache();
      window.dispatchEvent(new CustomEvent('clinic-sync', { detail: { table: 'appointments' } }));

      // Update patients local state instantly
      setPatients(prev => {
        const exists = prev.some(p => p.id === selectedPatientId);
        if (exists) {
          return prev.map(p => p.id === selectedPatientId ? { ...p, toothChart: chartToSave, name: currentPatientName || p.name } : p);
        }
        return [{ id: selectedPatientId, name: currentPatientName || (isEn ? 'New Patient' : 'مريض جديد'), phone: currentPatientPhone || '', toothChart: chartToSave, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...prev];
      });

      // 2. Mark waiting appointments as completed (skip slow internal fetch)
      await autoMarkWaitingAppointmentCompleted(true);

      // 3. Fetch latest data concurrently (silently to avoid flickering)
      await Promise.all([
        fetchPatientAppointments(selectedPatientId, true),
        fetchPatientRecords(selectedPatientId, undefined, latestChart || toothChart, true)
      ]);

      if (onRefreshAppointments) {
        onRefreshAppointments(true, todayStr, true);
      }

      dialogs.alert(isEn ? `Session on ${toothInfo.fullText} saved successfully and sent to reception!` : `تم حفظ الجلسة على ${toothInfo.fullText} بنجاح وإرسالها للممرضة / الاستقبال للتحصيل!`, { severity: 'success' });
    } catch (err: any) {
      console.error("Error adding session from chart:", err);
      dialogs.alert((isEn ? 'An error occurred while saving session: ' : 'حدث خطأ أثناء حفظ الجلسة: ') + (err.message || err.toString()), { severity: 'error' });
    }
  };

  const activePatient = patients.find((p) => p.id === selectedPatientId) || (() => {
    const app = patientAppointments.find(a => a.patientId === selectedPatientId);
    if (app) {
      return {
        id: selectedPatientId,
        name: app.patientName,
        phone: app.patientPhone || '',
        age: (app as any).patientAge || '',
        medicalHistory: (app as any).patientMedicalHistory || '',
        createdAt: '',
        updatedAt: ''
      } as Patient;
    }
    return undefined;
  })();

  return (
    <div className="space-y-6">
      {/* Selector header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="h-6 w-6 text-emerald-600" />
            {t('medicalFile.title')}
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {onBackToPatients && (
            <button
              onClick={onBackToPatients}
              className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              {isEn ? '← Back to Patients' : '← العودة لسجل المرضى'}
            </button>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-slate-500 shrink-0">{t('medicalFile.selectPatient')}:</label>
            <PatientSearchSelect
              patients={patients}
              selectedPatientId={selectedPatientId}
              onSelectPatient={setSelectedPatientId}
              placeholder={isEn ? 'Search patient name or phone...' : 'ابحث باسم المريض أو هاتفه...'}
              className="w-64 sm:w-72"
            />
          </div>
        </div>
      </div>

      {activePatient && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Right side: Detailed Medical File */}
          <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-6">
            <div className="border-b border-slate-100 pb-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="text-base font-extrabold text-slate-800">{activePatient.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      activePatient.gender === 'أنثى' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {activePatient.gender ? (activePatient.gender === 'أنثى' ? (isEn ? 'Female' : 'أنثى') : (isEn ? 'Male' : activePatient.gender)) : (isEn ? 'Male' : 'ذكر')}
                    </span>
                    {(activePatient.governorate || activePatient.cityOrDistrict || activePatient.area || activePatient.address) && (
                      <span className="text-[10px] bg-amber-50 text-amber-800 font-bold px-2 py-0.5 rounded-full border border-amber-200/60" title={activePatient.address || ''}>
                        📍 {formatLocationDisplayName(activePatient.governorate, activePatient.cityOrDistrict, activePatient.area || activePatient.address, isEn)}
                      </span>
                    )}
                    {activePatient.occupation && (
                      <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-full">
                        💼 {activePatient.occupation}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full shrink-0">
                  {isEn ? 'Active Medical File' : 'ملف طبي نشط'}
                </span>
              </div>
              
              <div className="grid grid-cols-4 gap-2 text-center text-[11px] bg-slate-50 p-2 rounded-xl border border-slate-100">
                <div className="border-l border-slate-200/60 pb-1">
                  <span className="text-slate-400 block text-[9px] mb-0.5">{isEn ? 'Phone:' : 'الهاتف:'}</span>
                  <span className="font-semibold text-slate-600 block truncate" dir="ltr">{activePatient.phone || '—'}</span>
                </div>
                <div className="border-l border-slate-200/60 pb-1">
                  <span className="text-slate-400 block text-[9px] mb-0.5">{isEn ? 'Age:' : 'العمر:'}</span>
                  <span className="font-bold text-slate-700 block">{activePatient.age ? (isEn ? `${activePatient.age} yrs` : `${activePatient.age} سنة`) : '—'}</span>
                </div>
                <div className="border-l border-slate-200/60 pb-1">
                  <span className="text-slate-400 block text-[9px] mb-0.5">{isEn ? 'Visits:' : 'الزيارات:'}</span>
                  <span className="font-black text-indigo-600 block">{groupedVisits.length}</span>
                </div>
                {clinic.loyaltyProgramEnabled !== false && (
                  <div className="pb-1 bg-amber-50/50 rounded-lg">
                    <span className="text-amber-800 font-extrabold block text-[9px] mb-0.5 flex items-center justify-center gap-0.5">
                      🎁 {isEn ? 'Points:' : 'النقاط:'}
                    </span>
                    <span className="font-black text-amber-700 block font-mono">{activePatient.loyaltyPoints || 0}</span>
                  </div>
                )}
              </div>

              {activePatient.whatsappNumber && (
                <button
                  type="button"
                  onClick={() => {
                    const clean = activePatient.whatsappNumber!.replace(/\D/g, '');
                    const formatted = clean.startsWith('01') ? '2' + clean : clean;
                    window.open(`https://wa.me/${formatted}`, '_blank');
                  }}
                  className="w-full text-center py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{isEn ? `WhatsApp Chat (${activePatient.whatsappNumber})` : `تواصل عبر الواتساب مباشر (${activePatient.whatsappNumber})`}</span>
                </button>
              )}
            </div>

            {/* Quick stats / medical warnings / Reception Questionnaire */}
            <div className="space-y-3">
              <div className="bg-rose-50/60 p-4 rounded-xl border border-rose-200/80 text-xs shadow-2xs">
                <span className="font-bold text-rose-800 flex items-center gap-1.5 mb-1.5 text-xs">
                  <Heart className="h-4 w-4 text-rose-600 shrink-0" />
                  {isEn ? 'Warnings & Chronic Conditions (Reception Questionnaire):' : 'التحذيرات والأمراض المزمنة (نتائج استبيان الاستقبال):'}
                </span>

                {(() => {
                  const qObj = activePatient.questionnaire;
                  const customAns = qObj?.customAnswers;
                  const activeQList = (clinic.questionnaireQuestions && clinic.questionnaireQuestions.length > 0)
                    ? clinic.questionnaireQuestions
                    : DEFAULT_QUESTIONNAIRE_QUESTIONS;

                  const yesAnswers: Array<{ title: string; details?: string }> = [];

                  if (customAns && Object.keys(customAns).length > 0) {
                    Object.entries(customAns).forEach(([qId, val]) => {
                      const itemVal = val as { answer?: string; details?: string } | undefined;
                      if (itemVal && itemVal.answer === 'نعم') {
                        const matchedQ = activeQList.find(q => q.id === qId);
                        const qTitle = matchedQ ? matchedQ.text.replace(/^\d+[\.\-]\s*/, '').trim() : qId;
                        yesAnswers.push({
                          title: qTitle,
                          details: itemVal.details ? itemVal.details.trim() : ''
                        });
                      }
                    });
                  }

                  if (yesAnswers.length > 0) {
                    return (
                      <div className="space-y-2 mt-2">
                        {yesAnswers.map((item, idx) => (
                          <div key={idx} className="bg-white/90 p-2.5 rounded-lg border border-rose-200/90 text-rose-900 shadow-2xs flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-extrabold text-rose-950 text-xs">
                                • {item.title}
                              </span>
                              <span className="bg-rose-100 text-rose-700 font-black px-2 py-0.5 rounded text-[10px] shrink-0">
                                {isEn ? 'Yes' : 'نعم'}
                              </span>
                            </div>
                            {item.details ? (
                              <div className="text-[11px] font-bold text-slate-800 bg-amber-50/90 border border-amber-200 p-2 rounded-md mt-0.5">
                                <span className="text-amber-900 font-extrabold ml-1">{isEn ? 'Details:' : 'التفاصيل:'}</span>
                                <span className="text-slate-900">{item.details}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic font-medium">{isEn ? 'No additional details provided' : 'لا توجد تفاصيل إضافية مدخلة'}</span>
                            )}
                          </div>
                        ))}
                        {qObj?.generalNotes && qObj.generalNotes.trim() && (
                          <div className="bg-slate-100/90 p-2 rounded-lg border border-slate-200 text-slate-800 text-[11px] font-semibold mt-1">
                            <span className="font-bold text-slate-900 ml-1">{isEn ? 'General reception notes:' : 'ملاحظات عامة من الاستقبال:'}</span>
                            {qObj.generalNotes.trim()}
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (activePatient.medicalHistory && activePatient.medicalHistory.trim()) {
                    return (
                      <p className="text-rose-700 mt-1.5 leading-relaxed font-semibold">
                        {activePatient.medicalHistory}
                      </p>
                    );
                  }

                  return (
                    <p className="text-rose-700 mt-1.5 leading-relaxed font-semibold">
                      {isEn ? 'No recorded chronic diseases or contraindications' : 'لا يوجد أمراض مزمنة أو موانع علاج مسجلة'}
                    </p>
                  );
                })()}
              </div>
            </div>

            {/* Vibrant Tabs for Medical Visits, Saved Prescriptions, Financials, and X-Rays */}
            <div className="space-y-4">
              <div className="flex bg-slate-900/90 p-1 rounded-2xl gap-1 overflow-x-auto scrollbar-none shadow-md border border-slate-800">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setRightColTab(rightColTab === 'visits' ? null : 'visits')}
                  className={`flex-1 min-w-[80px] sm:min-w-[90px] py-2 px-2 flex items-center justify-center gap-1.5 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer ${
                    rightColTab === 'visits'
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  <Clipboard className={`h-3.5 w-3.5 shrink-0 ${rightColTab === 'visits' ? 'text-white' : 'text-emerald-400'}`} />
                  <span>{isEn ? `Visits (${groupedVisits.length})` : `الزيارات (${groupedVisits.length})`}</span>
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => setRightColTab(rightColTab === 'prescriptions' ? null : 'prescriptions')}
                  className={`flex-1 min-w-[80px] sm:min-w-[90px] py-2 px-2 flex items-center justify-center gap-1.5 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer ${
                    rightColTab === 'prescriptions'
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/25'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  <FileText className={`h-3.5 w-3.5 shrink-0 ${rightColTab === 'prescriptions' ? 'text-white' : 'text-blue-400'}`} />
                  <span>{isEn ? `Rx (${prescriptions.length})` : `الروشتات (${prescriptions.length})`}</span>
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => {
                    if (!selectedPatientId || !activePatient) {
                      dialogs.alert(isEn ? 'Please select a patient first' : 'يرجى اختيار مريض أولاً', { severity: 'warning' });
                      return;
                    }
                    setRightColTab('financials');
                    setIsFinancialsModalOpen(true);
                  }}
                  className={`flex-1 min-w-[80px] sm:min-w-[90px] py-2 px-2 flex items-center justify-center gap-1.5 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer ${
                    rightColTab === 'financials'
                      ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/25'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  <Receipt className={`h-3.5 w-3.5 shrink-0 ${rightColTab === 'financials' ? 'text-white' : 'text-amber-400'}`} />
                  <span>{isEn ? 'Financials' : 'المالية'}</span>
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => {
                    if (!selectedPatientId || !activePatient) {
                      dialogs.alert(isEn ? 'Please select a patient first' : 'يرجى اختيار مريض أولاً', { severity: 'warning' });
                      return;
                    }
                    setRightColTab('xrays');
                    setIsXrayModalOpen(true);
                  }}
                  className={`flex-1 min-w-[80px] sm:min-w-[90px] py-2 px-2 flex items-center justify-center gap-1.5 text-xs font-bold rounded-xl transition-all duration-200 shrink-0 cursor-pointer ${
                    rightColTab === 'xrays'
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/25'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  <Image className={`h-3.5 w-3.5 shrink-0 ${rightColTab === 'xrays' ? 'text-white' : 'text-purple-400'}`} />
                  <span>{isEn ? `X-Rays (${xrays.length})` : `الأشعة (${xrays.length})`}</span>
                </motion.button>
              </div>


              {/* No panel displayed when rightColTab is null */}

              {rightColTab === 'visits' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h4 className="font-bold text-xs text-slate-600">{isEn ? 'Visits & Procedures Log' : 'سجل الزيارات والعمليات الطبية'}</h4>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedPatientId && onNavigateToPrescriptions) {
                            onNavigateToPrescriptions(selectedPatientId);
                          } else {
                            dialogs.alert(isEn ? 'Please select a patient first' : 'يرجى اختيار مريض أولاً', { severity: 'warning' });
                          }
                        }}
                        className="text-xs text-emerald-600 font-bold flex items-center gap-1 hover:underline"
                      >
                        <Plus className="h-3 w-3" />
                        {isEn ? 'New Standalone Rx' : 'إنشاء روشتة منفصلة'}
                      </button>
                    </div>
                  </div>

                  {loadingRecords ? (
                    <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                      <RefreshCw className="h-5 w-5 animate-spin text-emerald-600" />
                      {isEn ? 'Loading visits...' : 'جاري تحميل الزيارات...'}
                    </div>
                  ) : groupedVisits.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-100 rounded-xl">
                      {isEn ? 'No recorded visits for this patient.' : 'لا توجد زيارات سابقة مسجلة لهذا المريض.'}
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                      {groupedVisits.map((visit) => {
                        const linkedApp = visit.appointmentIds.length > 0
                          ? patientAppointments.find((a) => visit.appointmentIds.includes(a.id))
                          : patientAppointments.find((a) => a.date === visit.dateKey);

                        let formattedDateStr = visit.dateKey;
                        try {
                          if (visit.rawDate) {
                            formattedDateStr = new Date(visit.rawDate).toLocaleDateString(isEn ? 'en-US' : 'ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
                          }
                        } catch (_e) {
                          formattedDateStr = visit.dateKey;
                        }

                        return (
                          <div key={visit.dateKey} className="p-3.5 bg-white hover:bg-slate-50/80 border border-slate-200/60 rounded-xl text-xs space-y-2.5 relative group shadow-xs">
                            <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                                  <Calendar className="h-4 w-4" />
                                </div>
                                <div>
                                  <span className="font-bold text-slate-800 block text-[13px]">
                                    {isEn ? `Visit on ${formattedDateStr}` : `زيارة يوم ${formattedDateStr}`}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    {isEn
                                      ? `Includes ${visit.procedures.length} ${visit.procedures.length === 1 ? 'procedure' : 'procedures'}`
                                      : `تتضمن ${visit.procedures.length} ${visit.procedures.length === 1 ? 'إجراء طبي' : 'إجراءات طبية'}`}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg font-mono text-xs">
                                  {visit.totalCost.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
                                </span>
                                {!isStaff && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteVisit(visit)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition shrink-0"
                                    title={isEn ? 'Delete all procedures for this visit' : 'حذف جميع إجراءات هذه الزيارة'}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            
                            {visit.procedures && visit.procedures.length > 0 && (
                              <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/50 shadow-3xs text-[11px]" dir={isEn ? 'ltr' : 'rtl'}>
                                <table className={`w-full border-collapse ${isEn ? 'text-left' : 'text-right'}`}>
                                  <thead>
                                    <tr className="bg-slate-100/60 text-[9px] font-bold text-slate-500 border-b border-slate-200/40">
                                      <th className={`py-1 px-2 ${isEn ? 'text-left' : 'text-right'}`}>{isEn ? 'Medical Procedure' : 'الإجراء الطبي'}</th>
                                      <th className="py-1 px-2 text-center w-12">{isEn ? 'Tooth' : 'السن'}</th>
                                      <th className={`py-1 px-2 w-20 ${isEn ? 'text-right' : 'text-left'}`}>{isEn ? 'Price' : 'السعر'}</th>
                                      {!isStaff && <th className="py-1 px-2 text-center w-8"></th>}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 font-medium">
                                    {visit.procedures.map((row, rIdx) => (
                                      <tr key={`${row.recordId}-${rIdx}`} className="hover:bg-slate-100/40 transition-colors">
                                        <td className={`py-1.5 px-2 font-bold text-slate-700 ${isEn ? 'text-left' : 'text-right'}`}>
                                          {row.name}
                                        </td>
                                        <td className="py-1.5 px-2 text-center font-extrabold text-indigo-600 font-mono">
                                          {row.tooth ? <ToothBadge tooth={row.tooth} size="sm" showTextLabel={false} /> : '—'}
                                        </td>
                                        <td className={`py-1.5 px-2 font-black text-slate-600 font-mono ${isEn ? 'text-right' : 'text-left'}`}>
                                          {`${(row.price || 0).toLocaleString()} ${isEn ? 'EGP' : 'ج.م'}`}
                                        </td>
                                        {!isStaff && (
                                          <td className="py-1.5 px-2 text-center">
                                            <button
                                              type="button"
                                              onClick={() => handleDeleteProcedure(row.recordId, row)}
                                              className="text-slate-300 hover:text-rose-600 p-0.5 rounded transition"
                                              title={isEn ? 'Delete procedure' : 'حذف هذا الإجراء'}
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </button>
                                          </td>
                                        )}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {linkedApp && (
                              <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-100 text-[10px]">
                                <span className="text-slate-500 font-bold flex items-center gap-1 font-sans">
                                  <DollarSign className="h-3 w-3 text-indigo-500 shrink-0" />
                                  {isEn ? 'Payment Status:' : 'حالة السداد والأقساط:'}
                                </span>
                                <span className={`font-bold px-2 py-0.5 rounded-md font-sans ${
                                  linkedApp.remainingAmount === 0 
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100/60' 
                                    : 'bg-amber-50 text-amber-700 border border-amber-100/60'
                                }`}>
                                  {linkedApp.remainingAmount === 0 
                                    ? (isEn ? 'Fully Paid' : 'مسدد بالكامل') 
                                    : (isEn ? `Remaining: ${(linkedApp.remainingAmount || 0).toLocaleString()} EGP` : `متبقي قسط: ${(linkedApp.remainingAmount || 0).toLocaleString()} ج.م`)}
                                </span>
                              </div>
                            )}

                            {visit.notesList && visit.notesList.length > 0 && (
                              <div className="space-y-1 pt-1">
                                {visit.notesList.map((noteStr, nIdx) => (
                                  <p key={nIdx} className="text-[11px] text-slate-500 bg-white p-2 rounded border border-slate-100/80 leading-relaxed">
                                    {noteStr}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {rightColTab === 'prescriptions' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h4 className="font-bold text-xs text-slate-600">{isEn ? 'Saved Medical Prescriptions' : 'سجل الروشتات الطبية المحفوظة'}</h4>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedPatientId && onNavigateToPrescriptions) {
                          onNavigateToPrescriptions(selectedPatientId);
                        } else {
                          dialogs.alert(isEn ? 'Please select a patient first' : 'يرجى اختيار مريض أولاً', { severity: 'warning' });
                        }
                      }}
                      className="text-xs text-emerald-600 font-bold flex items-center gap-1 hover:underline"
                    >
                      <Plus className="h-3 w-3" />
                      {isEn ? 'New Standalone Rx' : 'إنشاء روشتة منفصلة'}
                    </button>
                  </div>

                  {loadingPrescriptions ? (
                    <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                      <RefreshCw className="h-5 w-5 animate-spin text-emerald-600" />
                      {isEn ? 'Loading prescriptions...' : 'جاري تحميل الروشتات...'}
                    </div>
                  ) : prescriptions.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-100 rounded-xl">
                      {isEn ? 'No saved prescriptions for this patient.' : 'لا توجد روشتات مسجلة سابقاً لهذا المريض.'}
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                      {prescriptions.map((presc) => (
                        <div key={presc.id} className="p-3 bg-white hover:bg-slate-50 border border-slate-100 rounded-xl text-xs space-y-2.5 relative group shadow-sm">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-bold text-slate-700 block">{isEn ? 'Prescription Rx' : 'روشتة علاجية Rx'}</span>
                              <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                                {(() => {
                                  const d = new Date(presc.date);
                                  return !isNaN(d.getTime()) ? `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` : presc.date;
                                })()}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handlePrintPrescription(presc)}
                                className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-lg transition"
                                title={isEn ? 'Print prescription' : 'طباعة الروشتة فورا'}
                              >
                                <Printer className="h-4 w-4" />
                              </button>
                              {!isStaff && (
                                <button
                                  type="button"
                                  onClick={() => handleDeletePrescription(presc.id)}
                                  className="p-1.5 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-lg transition"
                                  title={isEn ? 'Delete prescription' : 'حذف الروشتة'}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="bg-slate-50 p-2 rounded-lg border border-slate-100/70">
                            <span className="text-[10px] text-slate-400 block font-bold mb-1">{isEn ? `Medications (${presc.medications.length}):` : `الأدوية المسجلة (${presc.medications.length}):`}</span>
                            <div className="space-y-1">
                              {presc.medications.map((med, idx) => (
                                <div key={idx} className="text-[11px] text-slate-600 flex justify-between">
                                  <span className="font-semibold">- {med.name}</span>
                                  <span className="text-slate-400">{med.dose} • {med.duration}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {presc.notes && (
                            <p className="text-[10px] text-slate-500 bg-amber-50/40 p-2 rounded border border-amber-100/60 leading-relaxed">
                              <strong>{isEn ? 'Notes:' : 'ملاحظات:'}</strong> {presc.notes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {rightColTab === 'financials' && (
                <div className="space-y-4 text-xs bg-slate-50/80 p-4 rounded-2xl border border-slate-200 text-center">
                  <div className="p-3 bg-amber-100/80 text-amber-800 rounded-2xl w-fit mx-auto shadow-2xs">
                    <Receipt className="h-7 w-7" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-800">{isEn ? 'Comprehensive Financial Statement' : 'كشف الحساب والأقساط الشامل'}</h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                      {isEn ? 'Track and manage all patient payments, installments, invoice collection, and loyalty points with full flexibility.' : 'يتم تتبع وإدارة جميع مدفوعات المريض، الأقساط المتبقية، تحصيل الفواتير، ونقاط الولاء بمرونة كاملة من خلال نافذة كشف الحساب.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPatientId || !activePatient) {
                        dialogs.alert(isEn ? 'Please select a patient first' : 'يرجى اختيار مريض أولاً', { severity: 'warning' });
                        return;
                      }
                      setIsFinancialsModalOpen(true);
                    }}
                    className="w-full py-3 bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-extrabold rounded-xl text-xs shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Receipt className="h-4.5 w-4.5" />
                    <span>{isEn ? 'Open Financial Statement & Installments 📑' : 'فتح نافذة كشف الحساب والأقساط 📑'}</span>
                  </button>
                </div>
              )}

              {rightColTab === 'xrays' && (
                <div className="p-5 bg-gradient-to-br from-purple-900 via-indigo-950 to-slate-900 text-white rounded-3xl shadow-lg border border-purple-800/50 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-purple-500/20 text-purple-300 rounded-2xl border border-purple-500/30">
                        <Image className="h-6 w-6" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm text-white">{isEn ? `Patient X-Ray Archive (${xrays.length})` : `سجل وأرشيف أشعة المريض (${xrays.length})`}</h4>
                        <p className="text-xs text-purple-200/80">{isEn ? 'View comprehensive X-ray viewer, upload images with compression & diagnosis' : 'عرض شاشة الأشعة الشاملة، رفع الصور مع الضغط والتشخيص'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsXrayModalOpen(true)}
                      className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-extrabold rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer"
                    >
                      <Eye className="h-4 w-4 text-purple-200" />
                      <span>{isEn ? 'Open Full X-Ray Viewer 🖼️' : 'فتح نافذة الأشعة المكبّرة الشاملة 🖼️'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Large Modal Window for X-Rays */}
              {isXrayModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
                    {/* Modal Header */}
                    <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-purple-600/30 text-purple-300 rounded-2xl border border-purple-500/30">
                          <Image className="h-6 w-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-black text-base text-white">{isEn ? 'Patient X-Ray Archive' : 'أرشيف وسجل أشعة المريض'}</h3>
                            {activePatient && (
                              <span className="text-xs font-bold px-2.5 py-0.5 bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30">
                                {activePatient.name}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Upload & manage radiographic scans, zoom & high contrast with instant compression' : 'رفع وإدارة صور الفحص الشعاعي، التكبير والتباين العالي مع الضغط الفوري لحفظ المساحة'}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold px-3 py-1 bg-purple-950/80 text-purple-300 rounded-full border border-purple-800/80 hidden sm:inline-block">
                          {isEn ? `Total: ${xrays.length} X-Rays` : `إجمالي: ${xrays.length} أشعة`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsXrayModalOpen(false)}
                          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                          title={isEn ? 'Close Window' : 'إغلاق النافذة'}
                        >
                          <X className="h-6 w-6" />
                        </button>
                      </div>
                    </div>

                    {/* Modal Content Body */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" dir={isEn ? 'ltr' : 'rtl'}>
                      {/* Form to Upload New X-Ray */}
                      <div className="bg-slate-50/90 border border-slate-200/90 rounded-2xl p-4 space-y-3">
                        <h5 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                          <Plus className="h-4 w-4 text-purple-600" />
                          {isEn ? 'Add New Radiographic X-Ray Image:' : 'إضافة صورة أشعة جديدة:'}
                        </h5>

                        <div className="grid grid-cols-1 gap-3">
                          {/* Upload Dropzone */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Select X-Ray Image *' : 'اختر صورة الأشعة *'}</label>
                            <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-purple-300 hover:border-purple-500 bg-white hover:bg-purple-50/40 rounded-xl cursor-pointer transition text-center group">
                              <Image className="h-6 w-6 text-purple-500 group-hover:scale-110 transition-transform mb-1" />
                              <span className="text-xs font-bold text-purple-700">{isEn ? 'Click to upload X-Ray image from device' : 'اضغط لرفع صورة الأشعة من الجهاز'}</span>
                              <span className="text-[10px] text-slate-400 mt-0.5">{isEn ? 'Image will be automatically compressed to save database storage while preserving visual quality' : 'يتم ضغط الصورة تلقائياً لحفظ مساحة القاعدة مع الحفاظ التام على جودة الدقة الشاشية'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={handleSelectXrayFile}
                                className="hidden"
                              />
                            </label>
                          </div>

                          {/* Optional Diagnosis Field */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Diagnosis / X-Ray Notes (Optional)' : 'التشخيص / ملاحظات الأشعة (اختياري)'}</label>
                            <textarea
                              value={xrayDiagnosis}
                              onChange={(e) => setXrayDiagnosis(e.target.value)}
                              placeholder={isEn ? 'Enter initial diagnosis or radiological notes (e.g. root fractures, deep caries, etc)...' : 'أدخل التشخيص المبدئي أو ملاحظات الفحص الشعاعي (مثال: كسور في الجذور، تسوس بعيد، إلخ)...'}
                              rows={2}
                              className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none bg-white font-medium resize-none"
                            />
                          </div>
                        </div>

                        {/* Image Preview & Compression Summary */}
                        {xrayPreview && xrayPreview.trim() !== '' && (
                          <div className="flex flex-wrap items-center justify-between bg-purple-50/90 border border-purple-200 rounded-xl p-3 gap-3">
                            <div className="flex items-center gap-3">
                              <img src={xrayPreview} alt={isEn ? 'X-Ray Preview' : 'معاينة الأشعة'} className="h-14 w-14 object-cover rounded-lg border border-purple-300 shadow-2xs" />
                              <div>
                                <span className="text-xs font-bold text-purple-950 block">{isEn ? 'Ready to Save' : 'جاهز للحفظ'}</span>
                                {xrayCompressionStats && (
                                  <span className="text-[11px] text-purple-700 font-bold block">
                                    {isEn ? `Compressed size: ${xrayCompressionStats.orig} → ${xrayCompressionStats.comp}` : `تم ضغط الحجم: من ${xrayCompressionStats.orig} ← إلى ${xrayCompressionStats.comp}`}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setXrayFile(null);
                                  setXrayPreview(null);
                                  setXrayCompressionStats(null);
                                }}
                                className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                              >
                                {isEn ? 'Cancel' : 'إلغاء'}
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveXray}
                                disabled={isUploadingXray}
                                className="px-4 py-2 text-xs font-black text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-sm transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                              >
                                {isUploadingXray ? (
                                  <>
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    {isEn ? 'Saving...' : 'جاري الحفظ...'}
                                  </>
                                ) : (
                                  <>
                                    <Check className="h-3.5 w-3.5" />
                                    {isEn ? 'Save X-Ray' : 'حفظ الأشعة'}
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* List / Gallery of X-Rays */}
                      {loadingXrays ? (
                        <div className="text-center py-12 text-slate-400 text-xs font-bold">{isEn ? 'Loading X-Ray archive...' : 'جاري تحميل أرشيف الأشعة...'}</div>
                      ) : xrays.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 space-y-1">
                          <Image className="h-8 w-8 text-slate-300 mx-auto" />
                          <p className="text-xs font-bold text-slate-600">{isEn ? 'No X-rays recorded for this patient yet' : 'لا توجد أشعة مسجلة لهذا المريض بعد'}</p>
                          <p className="text-[11px] text-slate-400">{isEn ? 'You can upload the first X-ray image with diagnosis using the form above' : 'يمكنك رفع صورة الأشعة الأولى مع التشخيص من النموذج أعلاه'}</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {xrays.map((xray) => (
                            <div key={xray.id} className="group relative bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs hover:shadow-md transition flex flex-col justify-between">
                              <div
                                className="relative h-44 bg-slate-950 overflow-hidden cursor-pointer"
                                onClick={() => {
                                  setActiveXrayViewer(xray);
                                  setViewerZoom(1);
                                  setViewerRotate(0);
                                  setViewerContrast(false);
                                  setViewerPan({ x: 0, y: 0 });
                                }}
                              >
                                {xray.imageUrl && xray.imageUrl.trim() !== '' ? (
                                  <img
                                    src={xray.imageUrl}
                                    alt={isEn ? 'Patient X-Ray' : 'أشعة مريض'}
                                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                                    onError={async (e) => {
                                      const target = e.currentTarget;
                                      try {
                                        const media = await getOfflineMedia(xray.mediaId || xray.id || '');
                                        if (media) {
                                          if (media.dataUrl && !media.dataUrl.startsWith('blob:')) {
                                            target.src = media.dataUrl;
                                          } else if (media.blob) {
                                            target.src = URL.createObjectURL(media.blob);
                                          }
                                        }
                                      } catch (err) {}
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs font-bold bg-slate-900">
                                    {isEn ? 'No Image' : 'بدون صورة'}
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                  <span className="bg-white/95 text-slate-900 text-xs font-black px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-sm">
                                    <Eye className="h-3.5 w-3.5 text-purple-600" />
                                    {isEn ? 'Full Screen View' : 'عرض المكَبّر'}
                                  </span>
                                </div>
                                
                                {xray.isOfflinePending && (
                                  <span className="absolute top-2 right-2 bg-amber-500/90 text-white text-[10px] font-black px-2 py-0.5 rounded-md flex items-center gap-1 shadow-md backdrop-blur-xs z-10 animate-pulse">
                                    {isEn ? '⚡ Syncing (Offline)' : '⚡ قيد المزامنة (أوفلاين)'}
                                  </span>
                                )}

                                <span className="absolute bottom-2 right-2 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
                                  {xray.date} {xray.time ? `• ${xray.time}` : ''}
                                </span>
                              </div>

                              <div className="p-3 flex flex-col justify-between space-y-2 flex-1">
                                <div>
                                  <span className="text-[10px] font-black text-purple-900 block">{isEn ? 'Diagnosis & Notes:' : 'التشخيص والملاحظات:'}</span>
                                  <p className="text-xs text-slate-700 font-medium line-clamp-3 mt-0.5">
                                    {xray.diagnosis ? xray.diagnosis : <span className="text-slate-400 italic">{isEn ? 'No diagnosis entered' : 'بدون تشخيص مدخل'}</span>}
                                  </p>
                                </div>

                                <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] mt-auto">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveXrayViewer(xray);
                                      setViewerZoom(1);
                                      setViewerRotate(0);
                                      setViewerContrast(false);
                                      setViewerPan({ x: 0, y: 0 });
                                    }}
                                    className="text-purple-600 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                                  >
                                    <ZoomIn className="h-3.5 w-3.5" />
                                    {isEn ? 'Zoom & View' : 'تكبير واستعراض'}
                                  </button>

                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditXray(xray)}
                                      className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 font-bold px-2 py-1 rounded-lg transition flex items-center gap-1 cursor-pointer"
                                      title={isEn ? 'Edit X-Ray Image and Diagnosis' : 'تعديل صورة الأشعة والتشخيص'}
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                      <span>{isEn ? 'Edit' : 'تعديل'}</span>
                                    </button>

                                    {!xray.id.startsWith('record_') && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteXray(xray.id)}
                                        className="text-rose-500 hover:text-rose-700 font-bold p-1 rounded hover:bg-rose-50 transition cursor-pointer"
                                        title={isEn ? 'Delete X-Ray' : 'حذف الأشعة'}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Full Screen Interactive X-Ray Viewer Modal */}
              {activeXrayViewer && (
                <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col justify-between p-4 sm:p-6 animate-fadeIn" dir={isEn ? 'ltr' : 'rtl'}>
                  {/* Modal Top Bar */}
                  <div className="flex items-center justify-between text-white border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-900/80 rounded-xl text-purple-300">
                        <Image className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm text-white">{isEn ? 'High-Precision X-Ray Viewer' : 'عراض الأشعة عالي الدقة'}</h3>
                          {activeXrayViewer.isOfflinePending && (
                            <span className="text-[10px] font-black px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/40 flex items-center gap-1">
                              {isEn ? '⚡ Saved locally (Offline) - Will upload automatically' : '⚡ محفوظة محلياً (أوفلاين) - ستُرفع تلقائياً لـ Cloudflare R2'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{isEn ? `Date: ${activeXrayViewer.date}` : `التاريخ: ${activeXrayViewer.date}`} {activeXrayViewer.time ? `(${activeXrayViewer.time})` : ''}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveXrayViewer(null)}
                      className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>

                  {/* Modal Image Frame */}
                  <div className="flex-1 flex items-center justify-center overflow-hidden my-4 relative select-none">
                    <div className="relative overflow-hidden max-h-full max-w-full p-4 flex items-center justify-center w-full h-full">
                      {activeXrayViewer.imageUrl && activeXrayViewer.imageUrl.trim() !== '' ? (
                        <img
                          src={activeXrayViewer.imageUrl}
                          alt={isEn ? 'Enlarged Patient X-Ray' : 'أشعة مريض مكبرة'}
                          onMouseDown={handleMouseDownXray}
                          onMouseMove={handleMouseMoveXray}
                          onMouseUp={handleMouseUpXray}
                          onMouseLeave={handleMouseUpXray}
                          onTouchStart={handleTouchStartXray}
                          onTouchMove={handleTouchMoveXray}
                          onTouchEnd={handleTouchEndXray}
                          draggable={false}
                          style={{
                            transform: `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerZoom}) rotate(${viewerRotate}deg)`,
                            filter: viewerContrast ? 'contrast(180%) brightness(110%) grayscale(100%)' : 'none',
                            transition: isDragging ? 'none' : 'transform 0.15s ease-out, filter 0.2s ease-out',
                            cursor: isDragging ? 'grabbing' : 'grab'
                          }}
                          className="max-h-[65vh] max-w-full object-contain rounded-lg shadow-2xl border border-slate-800 touch-none select-none active:cursor-grabbing"
                        />
                      ) : (
                        <div className="text-slate-400 text-xs font-bold">{isEn ? 'Failed to load X-ray image' : 'تعذر تحميل صورة الأشعة'}</div>
                      )}
                    </div>
                  </div>

                  {/* Modal Bottom Controls & Diagnosis */}
                  <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4 text-white space-y-3 max-w-3xl mx-auto w-full">
                    {activeXrayViewer.diagnosis && (
                      <div className="bg-slate-800/80 border border-slate-700/80 p-3 rounded-xl text-xs space-y-1">
                        <span className="font-bold text-purple-400 block">{isEn ? 'Radiological Diagnosis & Notes:' : 'التشخيص والملاحظات الشعاعية:'}</span>
                        <p className="text-slate-200 leading-relaxed font-medium">{activeXrayViewer.diagnosis}</p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setViewerZoom(prev => Math.min(prev + 0.3, 3.5))}
                          className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                          title={isEn ? 'Zoom In' : 'تكبير'}
                        >
                          <ZoomIn className="h-4 w-4 text-purple-400" />
                          <span>{isEn ? 'Zoom In' : 'تكبير'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewerZoom(prev => Math.max(prev - 0.3, 0.6))}
                          className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                          title={isEn ? 'Zoom Out' : 'تصغير'}
                        >
                          <ZoomOut className="h-4 w-4 text-purple-400" />
                          <span>{isEn ? 'Zoom Out' : 'تصغير'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewerRotate(prev => (prev + 90) % 360)}
                          className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                          title={isEn ? 'Rotate' : 'تدوير'}
                        >
                          <RotateCw className="h-4 w-4 text-purple-400" />
                          <span>{isEn ? 'Rotate' : 'تدوير'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setViewerZoom(1);
                            setViewerRotate(0);
                            setViewerContrast(false);
                            setViewerPan({ x: 0, y: 0 });
                          }}
                          className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
                        >
                          {isEn ? 'Reset' : 'إعادة ضبط'}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEditXray(activeXrayViewer)}
                          className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-amber-600/20"
                          title={isEn ? 'Edit X-Ray image and diagnosis' : 'تعديل صورة الأشعة والتشخيص'}
                        >
                          <Edit3 className="h-4 w-4" />
                          <span>{isEn ? 'Edit X-Ray & Diagnosis' : 'تعديل الأشعة والتشخيص'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteXray(activeXrayViewer.id)}
                          className="px-3 py-2 bg-rose-600/90 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                          title={isEn ? 'Delete X-Ray' : 'حذف الأشعة'}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span>{isEn ? 'Delete X-Ray' : 'حذف الأشعة'}</span>
                        </button>

                        <a
                          href={activeXrayViewer.imageUrl}
                          download={`xray_${activeXrayViewer.patientId}_${activeXrayViewer.date}.jpg`}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="h-4 w-4" />
                          <span>{isEn ? 'Download Image' : 'تحميل الصورة'}</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}


            </div>
          </div>

          {/* Left side: Interactive Dental Chart */}
          <div className="lg:col-span-8 space-y-6">

            {/* Comprehensive Interactive Dental Chart card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-md font-bold text-slate-800 flex items-center gap-2">
                  <Shield className="h-5 w-5 text-indigo-600" />
                  {isEn ? "Patient's Active Dental Map" : "خريطة فم المريض النشطة"}
                </h3>
                <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded font-bold">
                  {isEn ? 'Real-Time Record Updates' : 'تحديث فوري للسجل'}
                </span>
              </div>
              
              <React.Suspense fallback={
                <div className="p-12 text-center text-slate-400 text-xs font-bold flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
                  {isEn ? 'Loading dental chart...' : 'جاري تحميل خريطة الأسنان...'}
                </div>
              }>
                <DentalChart
                  key={selectedPatientId || 'no-patient'}
                  patientId={selectedPatientId}
                  clinicId={clinic.id}
                  customServices={customServices}
                  onUpdateCustomServices={handleUpdateCustomServices}
                  categories={serviceCategories}
                  onUpdateCategories={handleUpdateCategories}
                  initialChart={toothChart}
                  onSaveChart={handleSaveToothChart}
                  readOnly={isStaff || isClinicExpired(clinic)}
                  onSaveToothSession={handleAddSessionFromChart}
                  patientAppointments={patientAppointments}
                  patientRecords={records}
                />
              </React.Suspense>
            </div>

          </div>

        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-fade-in">
          <div className={`bg-white p-6 rounded-2xl border border-slate-200 max-w-md w-full shadow-xl space-y-4 ${isEn ? 'text-left' : 'text-right'}`} dir={isEn ? 'ltr' : 'rtl'}>
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
                <Trash2 className="h-5 w-5" />
              </div>
              <h3 className="text-md font-bold text-slate-800">{isEn ? 'Confirm Deletion' : 'تأكيد عملية الحذف'}</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {deleteConfirm.type === 'prescription' 
                ? (isEn ? 'Are you sure you want to permanently delete this prescription? This action cannot be undone.' : 'هل أنت متأكد من رغبتك في حذف هذه الروشتة الطبية نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')
                : deleteConfirm.type === 'procedure'
                ? (isEn ? `Are you sure you want to permanently delete the procedure "${deleteConfirm.procedure?.name || ''}" and update tooth status & financials?` : `هل أنت متأكد من رغبتك في حذف الإجراء الطبي "${deleteConfirm.procedure?.name || ''}" نهائياً وتحديث شكل السن والحسابات؟`)
                : deleteConfirm.type === 'visit'
                ? (isEn ? 'Are you sure you want to permanently delete all procedures in this visit and reset treated teeth to normal?' : 'هل أنت متأكد من رغبتك في حذف جميع إجراءات هذه الزيارة نهائياً وإعادة الأسنان المعالجة فيها لحالتها الطبيعية؟')
                : (isEn ? 'Are you sure you want to permanently delete this medical record and restore the tooth to its default state?' : 'هل أنت متأكد من رغبتك في حذف هذا السجل الطبي نهائياً وإعادة السن لحالته الطبيعية؟')}
            </p>
            <div className={`flex justify-end gap-2.5 pt-2 ${isEn ? 'flex-row-reverse' : ''}`}>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold transition"
              >
                {isEn ? 'Cancel' : 'إلغاء'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const { type, id, procedure, visit } = deleteConfirm;
                  setDeleteConfirm(null);
                  if (type === 'prescription') {
                    await executeDeletePrescription(id);
                  } else if (type === 'procedure') {
                    await executeDeleteProcedure(id, procedure);
                  } else if (type === 'visit') {
                    await executeDeleteVisit(visit);
                  } else {
                    await executeDeleteRecord(id);
                  }
                }}
                className="px-5 py-2 text-white bg-rose-600 hover:bg-rose-700 rounded-xl text-xs font-bold transition shadow-md shadow-rose-100"
              >
                {isEn ? 'Yes, Delete Permanently' : 'نعم، احذف نهائياً'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Print Modal */}
      <PrintPreviewModal
        isOpen={!!previewInvoiceHtml}
        onClose={() => setPreviewInvoiceHtml(null)}
        title={isEn ? 'Medical Invoice' : 'فاتورة علاجية'}
        htmlContent={previewInvoiceHtml || ''}
      />

      {/* Prescription Print Modal */}
      <PrintPreviewModal
        isOpen={!!previewPrescriptionHtml}
        onClose={() => setPreviewPrescriptionHtml(null)}
        title={isEn ? 'Medical Prescription' : 'روشتة طبية'}
        htmlContent={previewPrescriptionHtml || ''}
      />

      {/* Patient Financials & Installments Modal */}
      {isFinancialsModalOpen && activePatient && (
        <PatientFinancialsModal
          isOpen={isFinancialsModalOpen}
          onClose={() => {
            setIsFinancialsModalOpen(false);
            if (selectedPatientId) {
              fetchPatientAppointments(selectedPatientId);
            }
          }}
          clinicId={clinic.id}
          patientId={selectedPatientId}
          patientName={activePatient.name}
          patientPhone={activePatient.phone}
          paymentMethods={clinic.paymentMethods}
          activeShiftDate={activeShift?.date}
          activeShiftId={activeShift?.id}
          activeShift={activeShift}
        />
      )}

      {/* Edit X-Ray Modal */}
      {editingXray && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className={`bg-slate-900 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 text-white space-y-5 shadow-2xl relative ${isEn ? 'text-left' : 'text-right'}`} dir={isEn ? 'ltr' : 'rtl'}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl">
                  <Edit3 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-amber-300">{isEn ? 'Edit X-Ray Image & Diagnosis' : 'تعديل صورة الأشعة والتشخيص'}</h3>
                  <p className="text-[11px] text-slate-400">{isEn ? 'Update attached diagnosis or replace X-Ray image' : 'تحديث التشخيص المرفق أو استبدال صورة الأشعة'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingXray(null)}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Image Preview & Replacement Section */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300">{isEn ? 'X-Ray Image:' : 'صورة الأشعة:'}</label>
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 h-48 flex items-center justify-center group">
                <img
                  src={editXrayPreview || editingXray.imageUrl}
                  alt={isEn ? 'X-Ray Image' : 'صورة الأشعة'}
                  className="w-full h-full object-contain"
                />
                <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1.5 cursor-pointer">
                  <Camera className="h-6 w-6 text-amber-400" />
                  <span className="text-xs font-bold text-white bg-amber-600/90 px-3 py-1 rounded-lg">{isEn ? 'Change or Replace Image' : 'تغيير أو استبدال الصورة'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleSelectEditXrayFile}
                  />
                </label>
              </div>
              {editXrayCompressionStats && (
                <p className="text-[11px] text-emerald-400 font-medium">
                  {isEn ? `New image compressed from ${editXrayCompressionStats.orig} to ${editXrayCompressionStats.comp}` : `تم ضغط الصورة الجديدة من ${editXrayCompressionStats.orig} إلى ${editXrayCompressionStats.comp}`}
                </p>
              )}
            </div>

            {/* Diagnosis & Notes Textarea */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-300">{isEn ? 'Radiological Diagnosis & Notes:' : 'التشخيص والملاحظات الطبية:'}</label>
              <textarea
                rows={3}
                value={editXrayDiagnosis}
                onChange={(e) => setEditXrayDiagnosis(e.target.value)}
                placeholder={isEn ? 'Enter radiological diagnosis or findings here...' : 'اكتب التشخيص المكتشف أو ملاحظات الأشعة هنا...'}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingXray(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold text-slate-300 transition cursor-pointer"
                disabled={isUpdatingXray}
              >
                {isEn ? 'Cancel' : 'إلغاء'}
              </button>
              <button
                type="button"
                onClick={handleSaveEditXray}
                disabled={isUpdatingXray}
                className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-500/20 transition flex items-center gap-2 cursor-pointer"
              >
                {isUpdatingXray ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    {isEn ? 'Saving...' : 'جاري الحفظ...'}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    {isEn ? 'Save Changes' : 'حفظ التعديلات'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
