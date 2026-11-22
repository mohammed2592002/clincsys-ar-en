import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { authHeaders, getClinicRef, getPrescriptionsRef, getPatientsRef, getCustomMedicationsRef, getCustomCategoriesRef, getDocsSmart as getDocs, addDoc, setDoc, deleteDoc, doc, updateDoc, query, where, orderBy, limit } from '../dbClient';
import { Patient, Clinic, CustomPrescriptionPadConfig, DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG } from '../types';
import { generatePrescriptionHTML } from '../utils/prescriptionHtml';
import { getEffectivePadConfig, saveEffectivePadConfig } from '../utils/storage';
import { uploadFileToR2 } from '../utils/r2Upload';

import PrescriptionPadModal from './PrescriptionPadModal';
import { FileSpreadsheet, Plus, Trash2, Printer, Check, Clipboard, Sparkles, Settings, X, Edit, Save } from 'lucide-react';
import { useDialogs } from './DialogContext';
import { PrintPreviewModal } from './PrintPreviewModal';
import PatientSearchSelect from './PatientSearchSelect';
import { checkSubscriptionBlocked } from '../utils/timeUtils';

type ElementKey = 'patientName' | 'patientAge' | 'date' | 'medicationsBox' | 'notesBox';

interface PrescriptionGeneratorProps {
  clinic: Clinic;
  isStaff?: boolean;
  initialPatientId?: string;
  onSaveSuccess?: () => void;
}

const COMMON_DENTAL_DRUGS = [
  { name: 'Augmentin 1g', dose: 'قرص واحد', frequency: 'كل 12 ساعة (بعد الأكل)', duration: '7 أيام', category: 'مضاد حيوي واسع المجال' },
  { name: 'Amoxicillin 500mg', dose: 'كبسولة واحدة', frequency: 'كل 8 ساعات (بعد الأكل)', duration: '5 أيام', category: 'مضاد حيوي' },
  { name: 'Flagyl 500mg', dose: 'قرص واحد', frequency: 'كل 8 ساعات (وسط الأكل)', duration: '5 أيام', category: 'مضاد بكتيريا لا هوائية' },
  { name: 'Cataflam 50mg', dose: 'قرص واحد', frequency: 'كل 8 ساعات (عند اللزوم بعد الأكل)', duration: '5 أيام', category: 'مسكن ومضاد للالتهاب' },
  { name: 'Brufen 400mg', dose: 'قرص واحد', frequency: 'كل 8 ساعات (بعد الأكل)', duration: '5 أيام', category: 'مسكن وخافض حرارة' },
  { name: 'Gengigel', dose: 'مسحة خفيفة', frequency: '3 مرات يومياً بعد المضمضة', duration: '7 أيام', category: 'جيل لالتئام جروح اللثة' },
  { name: 'Orovex Mouthwash', dose: 'ملء غطاء', frequency: 'مضمضة دقيقة كاملة 3 مرات يومياً', duration: '7 أيام', category: 'مضمضة مطهرة للفم' },
  { name: 'Ketofan 50mg', dose: 'قرص واحد', frequency: 'عند اللزوم بعد الأكل', duration: '5 أيام', category: 'مسكن للآلام الشديدة' }
];

export default function PrescriptionGenerator({ clinic, isStaff, initialPatientId, onSaveSuccess }: PrescriptionGeneratorProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [patientAge, setPatientAge] = useState('28');

  // React to initialPatientId change to select the active patient
  useEffect(() => {
    if (initialPatientId && patients.length > 0) {
      if (patients.some(p => p.id === initialPatientId)) {
        setSelectedPatientId(initialPatientId);
      }
    }
  }, [initialPatientId, patients]);

  // Find selected patient and calculate age automatically
  const selectedPatient = patients.find((p) => p.id === selectedPatientId);
  const selectedPatientAge = selectedPatient?.age;

  useEffect(() => {
    if (selectedPatient) {
      setPatientAge(selectedPatientAge || '28');
    }
  }, [selectedPatientId, selectedPatientAge]);

  // Custom medications (fetched from Firestore per clinic)
  const [customDrugs, setCustomDrugs] = useState<Array<{ id: string; name: string; dose: string; frequency: string; duration: string; category: string }>>([]);
  const [customCategories, setCustomCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('الكل');

  const [showMedSettings, setShowMedSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'drugs' | 'categories'>('drugs');

  const [newCustomDrug, setNewCustomDrug] = useState({
    name: '',
    dose: isEn ? '1 Tablet' : 'قرص واحد',
    frequency: isEn ? 'Every 12 hours (after meals)' : 'كل 12 ساعة (بعد الأكل)',
    duration: isEn ? '5 Days' : '5 أيام',
    category: isEn ? 'Analgesics' : 'مسكنات'
  });

  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  const [editingDrugId, setEditingDrugId] = useState<string | null>(null);
  const [editingDrugData, setEditingDrugData] = useState({
    name: '',
    dose: isEn ? '1 Tablet' : 'قرص واحد',
    frequency: isEn ? 'Every 12 hours (after meals)' : 'كل 12 ساعة (بعد الأكل)',
    duration: isEn ? '5 Days' : '5 أيام',
    category: isEn ? 'Analgesics' : 'مسكنات'
  });

  const [medSettingsLoading, setMedSettingsLoading] = useState(false);

  // Prescription medications list
  const [medications, setMedications] = useState<Array<{ name: string; dose: string; frequency: string; duration: string }>>([]);

  // Current medication form state
  const [medName, setMedName] = useState('');
  const [medDose, setMedDose] = useState(() => isEn ? '1 Tablet' : 'قرص واحد');
  const [medFreq, setMedFreq] = useState(() => isEn ? 'Every 12 hours (after meals)' : 'كل 12 ساعة (بعد الأكل)');
  const [medDur, setMedDur] = useState(() => isEn ? '5 Days' : '5 أيام');
  const [drugSearchQuery, setDrugSearchQuery] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [notes, setNotes] = useState(() => isEn
    ? 'Rinse with warm salt water, and avoid hot food and drinks for 24 hours.'
    : 'المضمضة بالماء الدافئ والملح، وتجنب المأكولات والمشروبات الساخنة لمدة 24 ساعة.'
  );
  const [recommendationsOn, setRecommendationsOn] = useState(false);

  useEffect(() => {
    if (isEn) {
      if (notes === 'المضمضة بالماء الدافئ والملح، وتجنب المأكولات والمشروبات الساخنة لمدة 24 ساعة.') {
        setNotes('Rinse with warm salt water, and avoid hot food and drinks for 24 hours.');
      }
      if (medDose === 'قرص واحد') setMedDose('1 Tablet');
      if (medFreq === 'كل 12 ساعة (بعد الأكل)') setMedFreq('Every 12 hours (after meals)');
      if (medDur === '5 أيام') setMedDur('5 Days');
    } else {
      if (notes === 'Rinse with warm salt water, and avoid hot food and drinks for 24 hours.') {
        setNotes('المضمضة بالماء الدافئ والملح، وتجنب المأكولات والمشروبات الساخنة لمدة 24 ساعة.');
      }
      if (medDose === '1 Tablet') setMedDose('قرص واحد');
      if (medFreq === 'Every 12 hours (after meals)') setMedFreq('كل 12 ساعة (بعد الأكل)');
      if (medDur === '5 Days') setMedDur('5 أيام');
    }
  }, [isEn]);

  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSavingOnly, setIsSavingOnly] = useState(false);

  const [showPadEditor, setShowPadEditor] = useState(false);
  const [padSaveStatus, setPadSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const pendingPad = React.useRef(false);
  const padRevision = React.useRef(0);
  const padSaveTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const padSaveQueue = React.useRef(Promise.resolve());
  const [showPrintStyle, setShowPrintStyle] = useState(false);
  const [showCustomDrug, setShowCustomDrug] = useState(false);
  const [padConfigOverride, setPadConfigOverride] = useState<CustomPrescriptionPadConfig>(() =>
    getEffectivePadConfig(clinic.id, clinic.customPrescriptionPadConfig)
  );

  useEffect(() => {
    if (!pendingPad.current) setPadConfigOverride(getEffectivePadConfig(clinic.id, clinic.customPrescriptionPadConfig));
  }, [clinic.id, clinic.customPrescriptionPadConfig]);

  const effectivePadConfig = getEffectivePadConfig(clinic.id, padConfigOverride);
  const latestPad = React.useRef(effectivePadConfig);
  latestPad.current = effectivePadConfig;

  // Layout and theme local overrides (synced from clinic settings, but customizable here)
  const [pStyle, setPStyle] = useState<'classic' | 'modern' | 'minimal' | 'elegant' | 'custom_pad'>(
    clinic.prescriptionStyle || (effectivePadConfig.backgroundImage ? 'custom_pad' : 'classic')
  );
  const [pLayout, setPLayout] = useState<'traditional' | 'table'>(clinic.prescriptionLayout || 'traditional');

  useEffect(() => {
    if (clinic.prescriptionStyle) {
      setPStyle(clinic.prescriptionStyle);
    } else if (effectivePadConfig.backgroundImage) {
      setPStyle('custom_pad');
    }
  }, [clinic.prescriptionStyle]);

  const [isCompressingImage, setIsCompressingImage] = useState(false);

  // Cache each edit immediately, then serialize debounced clinic writes so older edits cannot win.
  const persistPadConfig = (config: CustomPrescriptionPadConfig) => {
    setPadConfigOverride(config);
    saveEffectivePadConfig(clinic.id, config);
    pendingPad.current = true;
    setPadSaveStatus('saving');
    const revision = ++padRevision.current;
    clearTimeout(padSaveTimer.current);
    padSaveTimer.current = setTimeout(() => {
      padSaveQueue.current = padSaveQueue.current.catch(() => {}).then(async () => {
        try {
          await updateDoc(getClinicRef(clinic.id), { customPrescriptionPadConfig: config });
          if (padRevision.current === revision) { pendingPad.current = false; setPadSaveStatus('saved'); }
        } catch (error) {
          console.error('Could not sync prescription pad', error);
          if (padRevision.current === revision) setPadSaveStatus('error');
        }
      });
    }, 450);
  };

  const updatePadElementConfig = (key: ElementKey, updates: Partial<CustomPrescriptionPadConfig[ElementKey]>) => {
    const newCfg = {
      ...effectivePadConfig,
      [key]: {
        ...effectivePadConfig[key],
        ...updates
      }
    };
    persistPadConfig(newCfg);
  };

  const handleResetPadPositions = () => {
    const newCfg = {
      ...DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG,
      backgroundImage: effectivePadConfig.backgroundImage,
      hideBackgroundOnPrint: effectivePadConfig.hideBackgroundOnPrint
    };
    persistPadConfig(newCfg);
  };

  const handlePadImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > 15 * 1024 * 1024) {
      alert(isEn ? 'Image size is too large, please choose an image under 15MB' : 'حجم الصورة كبير جداً، يرجى اختيار صورة أقل من 15 ميجابايت');
      return;
    }

    setIsCompressingImage(true);
    try {
      let imageUrl = '';
      try {
        imageUrl = await uploadFileToR2(file, 'prescriptions', clinic.id);
        // Local fallback images require Authorization. Embed the authorized bytes so
        // the editor and the standalone print frame can both display the same image.
        if (imageUrl.startsWith('/api/files')) {
          const response = await fetch(imageUrl, { headers: authHeaders() });
          if (!response.ok) throw new Error('Could not load uploaded prescription image');
          const blob = await response.blob();
          imageUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('Could not read prescription image'));
            reader.readAsDataURL(blob);
          });
        }
      } catch (r2Err) {
        imageUrl = '';
        console.warn('R2 upload failed, falling back to local reader:', r2Err);
      }

      if (imageUrl) {
        const newCfg = { ...latestPad.current, backgroundImage: imageUrl };
        persistPadConfig(newCfg);
        setIsCompressingImage(false);
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const maxWidth = 1000;
          const maxHeight = 1414;
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.80);
            const newCfg = { ...latestPad.current, backgroundImage: compressedDataUrl };
            persistPadConfig(newCfg);
          }
          setIsCompressingImage(false);
        };
        img.onerror = () => { setIsCompressingImage(false); dialogs.alert(isEn ? 'This image could not be opened. Please choose a different image.' : 'تعذر فتح الصورة. يرجى اختيار صورة أخرى.', { severity: 'error' }); };
        img.src = ev.target?.result as string;
      };
      reader.onerror = () => { setIsCompressingImage(false); dialogs.alert(isEn ? 'Could not read this file.' : 'تعذرت قراءة الملف.', { severity: 'error' }); };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsCompressingImage(false);
    }
  };


  const handleRemovePadImage = () => {
    const newCfg = {
      ...effectivePadConfig,
      backgroundImage: ''
    };
    persistPadConfig(newCfg);
  };

  const handleToggleHideOnPrint = () => {
    const newCfg = {
      ...effectivePadConfig,
      hideBackgroundOnPrint: !effectivePadConfig.hideBackgroundOnPrint
    };
    persistPadConfig(newCfg);
  };

  const fetchPatients = async () => {
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
          age: data.age || '',
          medicalHistory: data.medicalHistory || '',
          createdAt: data.createdAt || '',
          updatedAt: data.updatedAt || ''
        });
      });
      setPatients(list);
      if (initialPatientId && list.some(p => p.id === initialPatientId)) {
        setSelectedPatientId(initialPatientId);
      } else if (list.length > 0) {
        setSelectedPatientId(list[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCustomCategories = async () => {
    try {
      const ref = getCustomCategoriesRef(clinic.id);
      const snap = await getDocs(ref);
      const list: any[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name || ''
        });
      });

      if (list.length === 0) {
        // Return default categories but DO NOT write them to database automatically!
        const defaultCats = [
          { id: 'default-cat-1', name: 'مسكنات ومضادات للالتهاب' },
          { id: 'default-cat-2', name: 'مضادات حيوية' },
          { id: 'default-cat-3', name: 'مضمضة مطهرة للفم' },
          { id: 'default-cat-4', name: 'جيل لالتئام جروح اللثة' },
          { id: 'default-cat-5', name: 'مضاد بكتيريا لا هوائية' },
          { id: 'default-cat-6', name: 'مخدر ومسكن موضعي' },
          { id: 'default-cat-7', name: 'أخرى' }
        ];
        setCustomCategories(defaultCats);
        return defaultCats;
      }

      setCustomCategories(list);
      return list;
    } catch (e) {
      console.error("Error fetching custom categories:", e);
      return [];
    }
  };

  const fetchCustomDrugs = async (_currentCats?: any[]) => {
    try {
      const ref = getCustomMedicationsRef(clinic.id);
      const snap = await getDocs(ref);
      const list: any[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name || '',
          dose: data.dose || '',
          frequency: data.frequency || '',
          duration: data.duration || '',
          category: data.category || 'أخرى'
        });
      });

      if (list.length === 0) {
        // Use default drugs from COMMON_DENTAL_DRUGS but DO NOT write to database!
        const defaultDrugs = COMMON_DENTAL_DRUGS.map((drug, index) => {
          let mappedCategory = 'أخرى';
          if (drug.category.includes('حيوي')) mappedCategory = 'مضادات حيوية';
          else if (drug.category.includes('مسكن') || drug.category.includes('حرارة')) mappedCategory = 'مسكنات ومضادات للالتهاب';
          else if (drug.category.includes('مضمضة') || drug.category.includes('غسول')) mappedCategory = 'مضمضة مطهرة للفم';
          else if (drug.category.includes('جيل') || drug.category.includes('جروح')) mappedCategory = 'جيل لالتئام جروح اللثة';
          else if (drug.category.includes('هوائية')) mappedCategory = 'مضاد بكتيريا لا هوائية';
          else if (drug.category.includes('مخدر')) mappedCategory = 'مخدر ومسكن موضعي';

          return {
            id: `default-drug-${index}`,
            name: drug.name,
            dose: drug.dose,
            frequency: drug.frequency,
            duration: drug.duration,
            category: mappedCategory
          };
        });
        setCustomDrugs(defaultDrugs);
      } else {
        setCustomDrugs(list);
      }
    } catch (e) {
      console.error("Error fetching custom drugs:", e);
    }
  };

  const handleAddCustomDrug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!newCustomDrug.name.trim()) {
      dialogs.alert(isEn ? 'Please enter medication name' : 'يرجى كتابة اسم الدواء', { severity: 'warning' });
      return;
    }

    const normalizedNewDrugName = newCustomDrug.name.trim().toLowerCase();
    const isDuplicateDrug = customDrugs.some(drug => drug.name.trim().toLowerCase() === normalizedNewDrugName);
    if (isDuplicateDrug) {
      dialogs.alert(isEn ? 'This medication already exists in your list' : 'هذا الدواء موجود مسبقاً في قائمة الأدوية الخاصة بك', { severity: 'warning' });
      return;
    }

    setMedSettingsLoading(true);
    try {
      const ref = getCustomMedicationsRef(clinic.id);
      const drugData = {
        name: newCustomDrug.name.trim(),
        dose: newCustomDrug.dose,
        frequency: newCustomDrug.frequency,
        duration: newCustomDrug.duration,
        category: newCustomDrug.category.trim() || (isEn ? 'Other' : 'أخرى')
      };
      const docRef = await addDoc(ref, drugData);
      setCustomDrugs(prev => [...prev, { id: docRef.id, ...drugData }]);
      setNewCustomDrug({
        name: '',
        dose: isEn ? '1 Tablet' : 'قرص واحد',
        frequency: isEn ? 'Every 12 hours (after meals)' : 'كل 12 ساعة (بعد الأكل)',
        duration: isEn ? '5 Days' : '5 أيام',
        category: customCategories[0]?.name || (isEn ? 'Analgesics & Anti-inflammatory' : 'مسكنات ومضادات للالتهاب')
      });
    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to add drug to list: ' : 'فشل إضافة الدواء لقائمتك: ') + e, { severity: 'error' });
    } finally {
      setMedSettingsLoading(false);
    }
  };

  const handleDeleteCustomDrug = async (id: string) => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete. Available to doctor only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    const hasConfirmed = await dialogs.confirm(isEn ? 'Do you want to permanently delete this medication from your list?' : 'هل تريد حذف هذا الدواء نهائياً من قائمة الأدوية الخاصة بك؟', { severity: 'warning' });
    if (!hasConfirmed) return;
    setMedSettingsLoading(true);
    try {
      if (id.startsWith('default-')) {
        setCustomDrugs(prev => prev.filter(drug => drug.id !== id));
      } else {
        const drugDocRef = doc(getCustomMedicationsRef(clinic.id), id);
        await deleteDoc(drugDocRef);
        setCustomDrugs(prev => prev.filter(drug => drug.id !== id));
      }
    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to delete drug: ' : 'فشل حذف الدواء: ') + e, { severity: 'error' });
    } finally {
      setMedSettingsLoading(false);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!newCategoryName.trim()) {
      dialogs.alert(isEn ? 'Please enter category name' : 'يرجى كتابة اسم القسم', { severity: 'warning' });
      return;
    }

    const normalizedNewCatName = newCategoryName.trim().toLowerCase();
    const isDuplicateCat = customCategories.some(cat => cat.name.trim().toLowerCase() === normalizedNewCatName);
    if (isDuplicateCat) {
      dialogs.alert(isEn ? 'This category already exists' : 'هذا القسم موجود مسبقاً', { severity: 'warning' });
      return;
    }

    setMedSettingsLoading(true);
    try {
      const ref = getCustomCategoriesRef(clinic.id);
      const catData = { name: newCategoryName.trim() };
      const docRef = await addDoc(ref, catData);
      setCustomCategories(prev => [...prev, { id: docRef.id, name: catData.name }]);
      setNewCategoryName('');
    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to add category: ' : 'فشل إضافة القسم: ') + e, { severity: 'error' });
    } finally {
      setMedSettingsLoading(false);
    }
  };

  const handleEditCategory = async (id: string) => {
    if (!editingCategoryName.trim()) {
      dialogs.alert(isEn ? 'Category name cannot be empty' : 'اسم القسم لا يمكن أن يكون فارغاً', { severity: 'warning' });
      return;
    }

    const normalizedEditCatName = editingCategoryName.trim().toLowerCase();
    const isDuplicateCat = customCategories.some(cat => cat.id !== id && cat.name.trim().toLowerCase() === normalizedEditCatName);
    if (isDuplicateCat) {
      dialogs.alert(isEn ? 'This category already exists' : 'هذا القسم موجود مسبقاً', { severity: 'warning' });
      return;
    }

    setMedSettingsLoading(true);
    try {
      const catDocRef = doc(getCustomCategoriesRef(clinic.id), id);
      const catData = { name: editingCategoryName.trim() };
      if (id.startsWith('default-')) {
        await setDoc(catDocRef, catData);
      } else {
        await updateDoc(catDocRef, catData);
      }

      const oldCat = customCategories.find(c => c.id === id);
      const oldName = oldCat?.name || '';
      const newName = editingCategoryName.trim();

      setCustomCategories(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));

      if (oldName) {
        // Update medications matching old category
        setCustomDrugs(prev => prev.map(d => d.category === oldName ? { ...d, category: newName } : d));
        const ref = getCustomMedicationsRef(clinic.id);
        const q = query(ref, where('category', '==', oldName));
        const snap = await getDocs(q);
        snap.forEach(async (docSnap) => {
          if (docSnap.id.startsWith('default-')) {
            await setDoc(doc(ref, docSnap.id), { category: newName });
          } else {
            await updateDoc(doc(ref, docSnap.id), { category: newName });
          }
        });
      }

      setEditingCategoryId(null);
      setEditingCategoryName('');
    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to update category: ' : 'فشل تعديل القسم: ') + e, { severity: 'error' });
    } finally {
      setMedSettingsLoading(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete. Available to doctor only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    const defaultOtherCat = isEn ? 'Other' : 'أخرى';
    const hasConfirmed = await dialogs.confirm(
      isEn
        ? `Are you sure you want to delete category "${name}"? Its medications will be kept and categorized as "${defaultOtherCat}".`
        : `هل أنت متأكد من حذف قسم "${name}"؟ ستبقى الأدوية الخاصة به ولكنها ستصنف كـ "أخرى".`,
      { severity: 'warning' }
    );
    if (!hasConfirmed) return;
    setMedSettingsLoading(true);
    try {
      if (id.startsWith('default-')) {
        setCustomCategories(prev => prev.filter(c => c.id !== id));
      } else {
        const catDocRef = doc(getCustomCategoriesRef(clinic.id), id);
        await deleteDoc(catDocRef);
        setCustomCategories(prev => prev.filter(c => c.id !== id));
      }

      // Update custom drugs in state and firestore
      setCustomDrugs(prev => prev.map(d => d.category === name ? { ...d, category: defaultOtherCat } : d));
      const ref = getCustomMedicationsRef(clinic.id);
      const q = query(ref, where('category', '==', name));
      const snap = await getDocs(q);
      snap.forEach(async (docSnap) => {
        if (docSnap.id.startsWith('default-')) {
          await setDoc(doc(ref, docSnap.id), { category: defaultOtherCat });
        } else {
          await updateDoc(doc(ref, docSnap.id), { category: defaultOtherCat });
        }
      });
    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to delete category: ' : 'فشل حذف القسم: ') + e, { severity: 'error' });
    } finally {
      setMedSettingsLoading(false);
    }
  };

  const handleStartEditDrug = (drug: any) => {
    setEditingDrugId(drug.id);
    setEditingDrugData({
      name: drug.name,
      dose: drug.dose,
      frequency: drug.frequency,
      duration: drug.duration,
      category: drug.category || (isEn ? 'Other' : 'أخرى')
    });
  };

  const handleSaveEditDrug = async (id: string) => {
    if (!editingDrugData.name.trim()) {
      dialogs.alert(isEn ? 'Medication name is required' : 'اسم الدواء مطلوب', { severity: 'warning' });
      return;
    }

    const normalizedEditDrugName = editingDrugData.name.trim().toLowerCase();
    const isDuplicateDrug = customDrugs.some(drug => drug.id !== id && drug.name.trim().toLowerCase() === normalizedEditDrugName);
    if (isDuplicateDrug) {
      dialogs.alert(isEn ? 'This medication already exists in your list' : 'هذا الدواء موجود مسبقاً في قائمة الأدوية الخاصة بك', { severity: 'warning' });
      return;
    }

    setMedSettingsLoading(true);
    try {
      const drugDocRef = doc(getCustomMedicationsRef(clinic.id), id);
      const drugData = {
        name: editingDrugData.name.trim(),
        dose: editingDrugData.dose,
        frequency: editingDrugData.frequency,
        duration: editingDrugData.duration,
        category: editingDrugData.category
      };
      if (id.startsWith('default-')) {
        await setDoc(drugDocRef, drugData);
      } else {
        await updateDoc(drugDocRef, drugData);
      }
      setCustomDrugs(prev => prev.map(d => d.id === id ? { id, ...editingDrugData, name: editingDrugData.name.trim() } : d));
      setEditingDrugId(null);
    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to update medication: ' : 'فشل تعديل الدواء: ') + e, { severity: 'error' });
    } finally {
      setMedSettingsLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
    fetchCustomCategories().then((cats) => {
      fetchCustomDrugs(cats);
    });

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};

      const relevantTables = ['custom_medications', 'custom_categories', 'patients', 'prescriptions'];
      if (
        relevantTables.includes(table) &&
        !showMedSettings &&
        !editingCategoryId &&
        !editingDrugId
      ) {
        console.log(`[PrescriptionGenerator] Instant prescription data sync triggered for table: ${table}`);
        fetchPatients();
        fetchCustomCategories().then((cats) => {
          fetchCustomDrugs(cats);
        });
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => window.removeEventListener('clinic-sync', handleSync);
  }, [clinic.id, showMedSettings, editingCategoryId, editingDrugId]);

  useEffect(() => {
    if (clinic.prescriptionStyle) setPStyle(clinic.prescriptionStyle);
    if (clinic.prescriptionLayout) setPLayout(clinic.prescriptionLayout);
  }, [clinic.prescriptionStyle, clinic.prescriptionLayout]);

  useEffect(() => {
    if (showMedSettings) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showMedSettings]);

  const handleAddMedication = () => {
    if (!medName.trim()) {
      dialogs.alert(isEn ? 'Please enter medication name' : 'يرجى كتابة اسم الدواء', { severity: 'warning' });
      return;
    }

    const normalizedNewName = medName.trim().toLowerCase();
    const isDuplicate = medications.some((med, idx) => {
      if (editingIndex !== null && idx === editingIndex) return false;
      return med.name.trim().toLowerCase() === normalizedNewName;
    });

    if (isDuplicate) {
      dialogs.alert(isEn ? 'This medication is already added to the prescription' : 'هذا الدواء تمت إضافته مسبقاً في الروشتة', { severity: 'warning' });
      return;
    }

    if (editingIndex !== null) {
      setMedications(medications.map((med, idx) => idx === editingIndex ? {
        name: medName.trim(),
        dose: medDose,
        frequency: medFreq,
        duration: medDur
      } : med));
      setEditingIndex(null);
    } else {
      setMedications([
        ...medications,
        {
          name: medName.trim(),
          dose: medDose,
          frequency: medFreq,
          duration: medDur
        }
      ]);
    }

    // Clear form states
    setMedName('');
    setMedDose(isEn ? '1 Tablet' : 'قرص واحد');
    setMedFreq(isEn ? 'Every 12 hours (after meals)' : 'كل 12 ساعة (بعد الأكل)');
    setMedDur(isEn ? '5 Days' : '5 أيام');
    setShowCustomDrug(false);
  };

  const handleRemoveMedication = (index: number) => {
    setMedications(prev => prev.filter((_, i) => i !== index));
    if (editingIndex === index) handleCancelEdit();
    else if (editingIndex !== null && editingIndex > index) setEditingIndex(editingIndex - 1);
  };

  const handleEditMedication = (index: number) => {
    const med = medications[index];
    setMedName(med.name);
    setMedDose(med.dose);
    setMedFreq(med.frequency);
    setMedDur(med.duration);
    setEditingIndex(index);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setMedName('');
    setMedDose(isEn ? '1 Tablet' : 'قرص واحد');
    setMedFreq(isEn ? 'Every 12 hours (after meals)' : 'كل 12 ساعة (بعد الأكل)');
    setMedDur(isEn ? '5 Days' : '5 أيام');
  };

  const translateDoseValue = (val: string) => {
    if (!isEn || !val) return val;
    switch (val.trim()) {
      case 'قرص واحد': return '1 Tablet';
      case 'كبسولة واحدة': return '1 Capsule';
      case 'ملعقة (5مل)': return '1 Spoon (5ml)';
      case 'كبسولتان': return '2 Capsules';
      case 'مسحة خفيفة': return 'Thin layer';
      case 'ملء غطاء': return '1 Capful';
      case 'عند اللزوم': return 'As needed';
      default: return val;
    }
  };

  const translateFreqValue = (val: string) => {
    if (!isEn || !val) return val;
    switch (val.trim()) {
      case 'كل 12 ساعة (بعد الأكل)': return 'Every 12 hours (after meals)';
      case 'كل 8 ساعات (بعد الأكل)': return 'Every 8 hours (after meals)';
      case 'كل 8 ساعات (وسط الأكل)': return 'Every 8 hours (with meals)';
      case 'كل 8 ساعات (عند اللزوم بعد الأكل)': return 'Every 8 hours (as needed after meals)';
      case 'كل 24 ساعة': return 'Every 24 hours';
      case 'قبل الأكل بـ 30 دقيقة': return '30 min before meals';
      case 'عند اللزوم للآلام': return 'As needed for pain';
      case 'عند اللزوم بعد الأكل': return 'As needed after meals';
      case 'كل 6 ساعات': return 'Every 6 hours';
      case '3 مرات يومياً بعد المضمضة': return '3 times daily after mouthwash';
      case 'مضمضة دقيقة كاملة 3 مرات يومياً': return 'Rinse for 1 min, 3 times daily';
      default: return val;
    }
  };

  const translateDurValue = (val: string) => {
    if (!isEn || !val) return val;
    switch (val.trim()) {
      case '3 أيام': return '3 Days';
      case '5 أيام': return '5 Days';
      case '7 أيام': return '7 Days';
      case '10 أيام': return '10 Days';
      case 'أسبوعين': return '2 Weeks';
      case 'عند اللزوم': return 'As needed';
      default: return val;
    }
  };

  const getCategoryDisplayName = (catName: string) => {
    if (!isEn || !catName) return catName;
    switch (catName.trim()) {
      case 'مسكنات ومضادات للالتهاب':
      case 'مسكنات':
        return 'Analgesics & Anti-inflammatory';
      case 'مضادات حيوية':
      case 'مضاد حيوي':
      case 'مضاد حيوي واسع المجال':
        return 'Antibiotics';
      case 'مضمضة مطهرة للفم':
      case 'مضمضة':
        return 'Antiseptic Mouthwash';
      case 'جيل لالتئام جروح اللثة':
      case 'جيل لالتئام الجروح':
        return 'Gum Healing Gel';
      case 'مضاد بكتيريا لا هوائية':
        return 'Anaerobic Antibacterial';
      case 'مخدر ومسكن موضعي':
        return 'Local Anesthetics';
      case 'أخرى':
        return 'Other';
      default:
        return catName;
    }
  };

  const selectDrugTemplate = (template: typeof customDrugs[number]) => {
    const index = medications.findIndex(m => m.name.trim().toLowerCase() === template.name.trim().toLowerCase());
    if (index >= 0) { handleRemoveMedication(index); return; }
    setMedications(prev => [...prev, { name: template.name, dose: translateDoseValue(template.dose), frequency: translateFreqValue(template.frequency), duration: translateDurValue(template.duration) }]);
  };

  // Build the themed color classes for the visual WYSIWYG preview
  const getThemeColors = (style: 'classic' | 'modern' | 'minimal' | 'elegant' | 'custom_pad') => {
    switch (style) {
      case 'modern':
        return {
          primary: '#10b981', // Emerald
          text: 'text-emerald-700',
          bg: 'bg-emerald-50/50',
          border: 'border-emerald-500',
          bannerBg: 'bg-emerald-600',
          tableHeader: 'bg-emerald-600',
          notesBorder: 'border-emerald-500',
          cardBorder: 'border-emerald-200'
        };
      case 'minimal':
        return {
          primary: '#1e293b', // Charcoal Slate
          text: 'text-slate-800',
          bg: 'bg-slate-50',
          border: 'border-slate-800',
          bannerBg: 'bg-slate-800',
          tableHeader: 'bg-slate-800',
          notesBorder: 'border-slate-800',
          cardBorder: 'border-slate-200'
        };
      case 'elegant':
        return {
          primary: '#7c3aed', // Royal Purple
          text: 'text-violet-700',
          bg: 'bg-violet-50/50',
          border: 'border-violet-500',
          bannerBg: 'bg-violet-600',
          tableHeader: 'bg-violet-600',
          notesBorder: 'border-violet-500',
          cardBorder: 'border-violet-200'
        };
      case 'custom_pad':
        return {
          primary: '#d97706', // Amber Gold
          text: 'text-amber-700',
          bg: 'bg-amber-50/50',
          border: 'border-amber-500',
          bannerBg: 'bg-amber-600',
          tableHeader: 'bg-amber-600',
          notesBorder: 'border-amber-500',
          cardBorder: 'border-amber-200'
        };
      case 'classic':
      default:
        return {
          primary: '#06b6d4', // Classic Cyan
          text: 'text-cyan-700',
          bg: 'bg-cyan-50/50',
          border: 'border-cyan-500',
          bannerBg: 'bg-cyan-600',
          tableHeader: 'bg-cyan-600',
          notesBorder: 'border-cyan-500',
          cardBorder: 'border-cyan-200'
        };
    }
  };

  const colors = getThemeColors(pStyle);
  const patientNameText = selectedPatient ? selectedPatient.name : (isEn ? '___________________' : 'ــــــــــــــــــــــــــــــــــــــــ');
  const now = new Date();
  const todayDateString = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

  const handleSaveAndPrint = async () => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!selectedPatientId) {
      dialogs.alert(isEn ? 'Please select a patient first' : 'يرجى تحديد المريض أولاً', { severity: 'warning' });
      return;
    }
    if (medications.length === 0) {
      dialogs.alert(isEn ? 'Please add at least one medication to the prescription' : 'يرجى إضافة دواء واحد على الأقل للروشتة', { severity: 'warning' });
      return;
    }

    const patient = patients.find((p) => p.id === selectedPatientId);
    if (!patient) return;

    setLoading(true);
    try {
      // 1. Save in clinic prescriptions collection
      const ref = getPrescriptionsRef(clinic.id);
      await addDoc(ref, {
        patientId: patient.id,
        patientName: patient.name,
        patientAge,
        date: new Date().toISOString(),
        medications,
        notes: recommendationsOn ? notes.trim() : '',
        prescriptionStyle: pStyle,
        prescriptionLayout: pLayout
      });

      setSuccessMsg(isEn ? 'Prescription saved successfully to patient record, preparing print...' : 'تم حفظ الروشتة بنجاح في سجل المريض، جاري التحضير للطباعة...');
      setTimeout(() => setSuccessMsg(''), 4000);

      // 2. Generate optimized prescription HTML for print
      const prescriptionHTML = generatePrescriptionHTML({
        clinic,
        patientName: patient.name,
        patientAge,
        medications,
        notes: recommendationsOn ? notes.trim() : '',
        prescriptionStyle: pStyle,
        prescriptionLayout: pLayout,
        customPrescriptionPadConfig: effectivePadConfig,
        isEn
      });

      setPreviewHtml(prescriptionHTML);

    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to save prescription: ' : 'فشل حفظ الروشتة: ') + e, { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOnly = async () => {
    if (checkSubscriptionBlocked(clinic, dialogs)) return;
    if (!selectedPatientId) {
      dialogs.alert(isEn ? 'Please select a patient first' : 'يرجى تحديد المريض أولاً', { severity: 'warning' });
      return;
    }
    if (medications.length === 0) {
      dialogs.alert(isEn ? 'Please add at least one medication to the prescription' : 'يرجى إضافة دواء واحد على الأقل للروشتة', { severity: 'warning' });
      return;
    }

    const patient = patients.find((p) => p.id === selectedPatientId);
    if (!patient) return;

    setIsSavingOnly(true);
    try {
      // Save in clinic prescriptions collection
      const ref = getPrescriptionsRef(clinic.id);
      await addDoc(ref, {
        patientId: patient.id,
        patientName: patient.name,
        patientAge,
        date: new Date().toISOString(),
        medications,
        notes: recommendationsOn ? notes.trim() : '',
        prescriptionStyle: pStyle,
        prescriptionLayout: pLayout
      });

      setSuccessMsg(isEn ? 'Prescription saved successfully to patient record without printing.' : 'تم حفظ الروشتة بنجاح في سجل المريض دون طباعة.');
      setTimeout(() => setSuccessMsg(''), 4000);

      dialogs.alert(isEn ? 'Prescription saved successfully to patient record, redirecting to appointments...' : 'تم حفظ الروشتة بنجاح في سجل المريض، جاري الانتقال إلى جدول المواعيد...', { severity: 'success' });
      if (onSaveSuccess) {
        onSaveSuccess();
      }

      // Reset medications list or keep it? Keeping it allows editing or printing later if needed, which matches standard flow.
    } catch (e) {
      console.error(e);
      dialogs.alert((isEn ? 'Failed to save prescription: ' : 'فشل حفظ الروشتة: ') + e, { severity: 'error' });
    } finally {
      setIsSavingOnly(false);
    }
  };

  const medicationForm = (
<div className={editingIndex !== null ? 'border-t border-slate-100 pt-3' : 'bg-emerald-50/40 p-5 rounded-2xl border border-dashed border-emerald-300/70'}>
          {/* Add Medicine form segments */}
          <div className="space-y-4">
            {editingIndex === null && <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs text-slate-700 flex items-center gap-1">
                <Plus className="h-4 w-4 text-emerald-600" />
                {editingIndex !== null
                  ? (isEn ? 'Edit Current Medication:' : 'تعديل بند العلاج الحالي:')
                  : (isEn ? 'Add custom medication (not in the pharmacy)' : 'إضافة علاج مخصص (دواء مش موجود في الصيدلية)')}
              </h4>
              {editingIndex !== null && (
                <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                  {isEn ? `Editing Item #${editingIndex + 1}` : `جاري تعديل البند رقم ${editingIndex + 1}`}
                </span>
              )}
            </div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Drug Name */}
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1">
                  {isEn ? 'Medication / Trade Name' : 'اسم المستحضر الدوائي أو الصنف التجاري'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? "e.g., Augmentin 1g" : "مثال: Augmentin 1g"}
                  value={medName}
                  onChange={(e) => setMedName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg text-xs bg-white text-slate-800 font-semibold shadow-2xs"
                />
              </div>

              {/* Dosage with click helpers */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">
                  {isEn ? 'Dosage' : 'الجرعة المحددة'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? "e.g., 1 Tablet" : "مثال: قرص واحد"}
                  value={medDose}
                  onChange={(e) => setMedDose(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg text-xs bg-white text-slate-800 font-semibold shadow-2xs"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(isEn
                    ? ['1 Tablet', '1 Capsule', '1 Spoon (5ml)', '2 Capsules', 'Thin layer', 'As needed']
                    : ['قرص واحد', 'كبسولة واحدة', 'ملعقة (5مل)', 'كبسولتان', 'مسحة خفيفة', 'عند اللزوم']
                  ).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setMedDose(d)}
                      className={`px-1.5 py-0.5 rounded text-[9px] transition ${medDose === d ? 'bg-emerald-600 text-white font-bold' : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200/60'}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration with click helpers */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">
                  {isEn ? 'Duration' : 'المدة المطلوبة'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? "e.g., 5 Days" : "مثال: 5 أيام"}
                  value={medDur}
                  onChange={(e) => setMedDur(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg text-xs bg-white text-slate-800 font-semibold shadow-2xs"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(isEn
                    ? ['3 Days', '5 Days', '7 Days', '10 Days', '2 Weeks', 'As needed']
                    : ['3 أيام', '5 أيام', '7 أيام', '10 أيام', 'أسبوعين', 'عند اللزوم']
                  ).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setMedDur(d)}
                      className={`px-1.5 py-0.5 rounded text-[9px] transition ${medDur === d ? 'bg-emerald-600 text-white font-bold' : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200/60'}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Frequency with click helpers */}
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 mb-1">
                  {isEn ? 'Frequency & Instructions' : 'التكرار والإرشادات الزمنية'}
                </label>
                <input
                  type="text"
                  placeholder={isEn ? "e.g., Every 12 hours after meals" : "مثال: كل 12 ساعة بعد الأكل"}
                  value={medFreq}
                  onChange={(e) => setMedFreq(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-lg text-xs bg-white text-slate-800 font-semibold shadow-2xs"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(isEn
                    ? ['Every 12 hours (after meals)', 'Every 8 hours (after meals)', 'Every 24 hours', '30 min before meals', 'As needed for pain', 'Every 6 hours']
                    : ['كل 12 ساعة (بعد الأكل)', 'كل 8 ساعات (بعد الأكل)', 'كل 24 ساعة', 'قبل الأكل بـ 30 دقيقة', 'عند اللزوم للآلام', 'كل 6 ساعات']
                  ).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setMedFreq(f)}
                      className={`px-1.5 py-0.5 rounded text-[9px] transition ${medFreq === f ? 'bg-emerald-600 text-white font-bold' : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200/60'}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200/40">
              {editingIndex !== null && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-3.5 py-1.5 text-[11px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                >
                  {isEn ? 'Cancel Edit' : 'إلغاء التعديل'}
                </button>
              )}
              <button
                type="button"
                onClick={handleAddMedication}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition flex items-center gap-1 shadow-xs"
              >
                <Check className="h-3.5 w-3.5" />
                {editingIndex !== null
                  ? (isEn ? 'Save Changes' : 'حفظ تعديلات البند')
                  : (isEn ? 'Add to Prescription' : 'إدراج بالروشتة الطبية')}
              </button>
            </div>
          </div>

          </div>
  );

  return (
    <div className="space-y-4" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Navy hero */}
      <div className="bg-[#272E40] rounded-[20px] p-4 sm:px-5 shadow-lg border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-white">{isEn ? 'Medical Prescription' : 'الروشتة العلاجية'}</h2>
            <p className="text-xs text-slate-300 mt-0.5">{isEn ? 'Write the prescription in 3 steps, without leaving the page' : 'اكتب الروشتة في 3 خطوات، من غير ما تسيب الصفحة'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white/10 rounded-full ps-1.5 pe-3 py-1.5">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${selectedPatientId ? 'bg-emerald-500 text-white' : 'bg-white/20 text-slate-200'}`}>{selectedPatientId ? '✓' : (isEn ? '1' : '١')}</span>
            <span className="text-[11px] font-bold text-slate-200">{isEn ? 'Pick the patient' : 'اختر المريض'}</span>
          </div>
          {selectedPatientId && patients.find(p => p.id === selectedPatientId) && (
            <span className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1.5 text-[11px] font-bold text-emerald-300">
              {patients.find(p => p.id === selectedPatientId)?.name}
            </span>
          )}
          <div className="flex items-center gap-1.5 bg-white/10 rounded-full ps-1.5 pe-3 py-1.5">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${medications.length > 0 ? 'bg-emerald-500 text-white' : 'bg-white/20 text-slate-200'}`}>{medications.length > 0 ? '✓' : (isEn ? '2' : '٢')}</span>
            <span className="text-[11px] font-bold text-slate-200">{isEn ? 'Add the medications' : 'أضف الأدوية'}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/10 rounded-full ps-1.5 pe-3 py-1.5">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black bg-white/20 text-slate-200">{isEn ? '3' : '٣'}</span>
            <span className="text-[11px] font-bold text-slate-200">{isEn ? 'Review & print' : 'راجع واطبع'}</span>
          </div>
        </div>
      </div>

      {/* Success Banner */}
      {successMsg && (
        <div className="bg-emerald-50 border-r-4 border-emerald-500 p-4 rounded-xl flex items-start gap-3 animate-fade-in shadow-sm">
          <Check className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-700 font-bold leading-relaxed">{successMsg}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Prescription Setup Form (Left block of controls) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">{isEn ? 'Target Patient' : 'المريض المستهدف'} <span className="text-rose-500">*</span></label>
              <PatientSearchSelect
                patients={patients}
                selectedPatientId={selectedPatientId}
                onSelectPatient={setSelectedPatientId}
                placeholder={isEn ? "Search by patient name or phone..." : "ابحث باسم المريض أو هاتفه لكتابة الروشتة..."}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">{isEn ? 'Printed Age' : 'العمر المطبوع بالروشتة'}</label>
              <input
                type="text"
                value={patientAge}
                onChange={(e) => setPatientAge(e.target.value)}
                placeholder="28"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs text-center font-bold text-slate-700"
              />
            </div>
          </div>

          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          {/* Quick Dental Drug Badges */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-[12px] font-bold text-slate-700 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                {isEn ? 'Clinic pharmacy' : 'صيدلية العيادة'}<span className="text-[10px] text-emerald-600 bg-emerald-50 rounded-lg px-2 py-1 ms-2">{isEn ? 'Tap to add · Tap again to remove' : 'دوسة تضيف · دوسة تانية تشيل'}</span>
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={isEn ? "Search drug name..." : "ابحث باسم الدواء..."}
                  value={drugSearchQuery}
                  onChange={(e) => setDrugSearchQuery(e.target.value)}
                  className="px-2.5 py-1 border border-slate-200 rounded-lg text-[11px] bg-white text-slate-800 focus:ring-1 focus:ring-emerald-500 font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowMedSettings(true)}
                  className="text-[10px] text-emerald-700 hover:text-emerald-800 font-extrabold flex items-center gap-1 transition bg-emerald-100/60 hover:bg-emerald-100 px-2 py-1 rounded-lg"
                >
                  <Settings className="h-3 w-3" />
                  {isEn ? 'Manage Pharmacy' : 'إدارة الصيدلية'}
                </button>
              </div>
            </div>

            {/* Category filter tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              <button
                type="button"
                onClick={() => setSelectedCategoryTab('الكل')}
                className={`px-3 py-1 rounded-lg text-[10px] font-bold transition whitespace-nowrap ${selectedCategoryTab === 'الكل' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
              >
                {isEn ? 'All' : 'الكل'} ({customDrugs.length})
              </button>
              {customCategories.map((cat) => {
                const count = customDrugs.filter(d => d.category === cat.name).length;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategoryTab(cat.name)}
                    className={`px-3 py-1 rounded-lg text-[10px] font-bold transition whitespace-nowrap ${selectedCategoryTab === cat.name ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                  >
                    {getCategoryDisplayName(cat.name)} ({count})
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 max-h-48 overflow-y-auto p-1">
              {(() => {
                let filtered = selectedCategoryTab === 'الكل'
                  ? customDrugs
                  : customDrugs.filter(d => d.category === selectedCategoryTab);

                if (drugSearchQuery.trim()) {
                  const query = drugSearchQuery.toLowerCase();
                  filtered = filtered.filter(d => d.name.toLowerCase().includes(query) || d.category.toLowerCase().includes(query) || getCategoryDisplayName(d.category).toLowerCase().includes(query));
                }

                if (filtered.length === 0) {
                  return (
                    <p className="text-slate-400 text-[10px] text-center col-span-2 py-4 italic">
                      {isEn ? 'No medications match your search.' : 'لا توجد أدوية مخصصة تطابق البحث حالياً.'}
                    </p>
                  );
                }

                return filtered.map((drug, idx) => (
                  <button
                    key={drug.id || idx}
                    type="button"
                    onClick={() => selectDrugTemplate(drug)}
                    data-testid="pharmacy-drug" aria-pressed={medications.some(m => m.name.trim().toLowerCase() === drug.name.trim().toLowerCase())}
                    className={`relative p-1.5 sm:p-2.5 border ${medications.some(m => m.name.trim().toLowerCase() === drug.name.trim().toLowerCase()) ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500' : 'bg-white border-slate-200/80 hover:bg-emerald-50/60 hover:border-emerald-300'} rounded-xl transition shadow-2xs flex flex-col justify-between group min-h-16 cursor-pointer ${isEn ? 'text-left' : 'text-right'}`}
                  >
                    {medications.some(m => m.name.trim().toLowerCase() === drug.name.trim().toLowerCase()) && <span className="absolute -top-2 start-2 bg-emerald-500 text-white px-2 py-0.5 rounded-full text-[9px] font-bold">✓ {isEn ? 'Added' : 'تمت الإضافة'}</span>}
                    <div className="flex items-center justify-between w-full gap-1">
                      <strong className="text-slate-800 text-[10px] sm:text-[13px] font-black group-hover:text-emerald-700 truncate">{drug.name}</strong>
                      <span className="text-[8px] sm:text-[9px] font-bold bg-emerald-50 text-emerald-700 px-1 sm:px-1.5 py-0.5 rounded-md border border-emerald-100 shrink-0 truncate max-w-[40px] sm:max-w-none">{getCategoryDisplayName(drug.category)}</span>
                    </div>
                    <div className="text-[9px] text-slate-400 font-bold truncate mt-1">
                      {translateDoseValue(drug.dose)} • {translateFreqValue(drug.frequency)} • {translateDurValue(drug.duration)}
                    </div>
                  </button>
                ));
              })()}
              {customDrugs.length === 0 && (
                <p className="text-slate-400 text-[10px] text-center col-span-2 py-2">
                  {isEn ? 'No custom medications. Click "Manage Pharmacy" to add medications.' : 'لا توجد أدوية مخصصة. انقر فوق "إدارة الصيدلية" لإضافة أدويتك وسرعة صياغتها.'}
                </p>
              )}
            </div>
          </div>

          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          {/* List of currently drafted medications in form side */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Clipboard className="h-4 w-4 text-indigo-600" />
                {isEn ? `Medications added to prescription (${medications.length})` : `الأدوية المضافة للروشتة (${medications.length})`}
              </span>
              {medications.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    dialogs.confirm(
                      isEn ? 'Do you want to clear all current medications and start over?' : 'هل تريد مسح جميع الأدوية الحالية والبدء من جديد؟',
                      { severity: 'warning' }
                    )
                      .then((confirmed) => {
                        if (confirmed) {
                          setMedications([]);
                          setEditingIndex(null);
                        }
                      });
                  }}
                  className="text-[10px] text-rose-500 hover:text-rose-700 font-extrabold flex items-center gap-0.5 hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  {isEn ? 'Clear All' : 'حذف الكل'}
                </button>
              )}
            </div>

            {medications.length === 0 ? (
              <div className="text-center text-slate-400 text-xs py-6 border border-dashed border-slate-100 rounded-lg bg-slate-50/50">
                {isEn
                  ? 'No medications added yet. Use the quick clinic pharmacy or write a new item above.'
                  : 'لم تقم بإدراج أي دواء للروشتة حتى الآن. استخدم صيدلية العيادة السريعة أو اكتب بنداً جديداً أعلاه.'}
              </div>
            ) : (
              <div className="space-y-2">
                {medications.map((med, index) => {
                  const isBeingEdited = editingIndex === index;
                  return (
                    <div
                      key={index}
                      data-testid="rx-medication-row" className={`flex flex-wrap justify-between items-center gap-2 p-3 rounded-xl transition border text-xs ${isBeingEdited ? 'bg-white border-emerald-500 ring-1 ring-emerald-500' : 'bg-slate-50 hover:bg-slate-100 border-slate-200/60'}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 shrink-0 bg-slate-200 rounded-full flex items-center justify-center font-bold text-slate-600 text-[10px] mt-0.5">{index + 1}</span>
                        <div>
                          <strong className="text-slate-900 font-extrabold block text-sm">{med.name}</strong>
                          <div className="text-slate-500 font-semibold mt-0.5 text-[10px]">
                            {isEn ? 'Dose: ' : 'الجرعة: '}{med.dose} <span className="text-slate-300">•</span> {isEn ? 'Frequency: ' : 'التكرار: '}{med.frequency} <span className="text-slate-300">•</span> {isEn ? 'Duration: ' : 'المدة: '}{med.duration}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1 shrink-0">
                        {/* Move Up */}
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => {
                            const updated = [...medications];
                            const temp = updated[index];
                            updated[index] = updated[index - 1];
                            updated[index - 1] = temp;
                            setMedications(updated);
                            if (editingIndex === index) setEditingIndex(index - 1);
                            else if (editingIndex === index - 1) setEditingIndex(index);
                          }}
                          className="text-slate-400 hover:text-slate-600 hover:bg-white p-1 rounded-md border border-transparent hover:border-slate-200 disabled:opacity-30 transition"
                          title={isEn ? "Move Up" : "نقل لأعلى"}
                        >
                          ▲
                        </button>
                        {/* Move Down */}
                        <button
                          type="button"
                          disabled={index === medications.length - 1}
                          onClick={() => {
                            const updated = [...medications];
                            const temp = updated[index];
                            updated[index] = updated[index + 1];
                            updated[index + 1] = temp;
                            setMedications(updated);
                            if (editingIndex === index) setEditingIndex(index + 1);
                            else if (editingIndex === index + 1) setEditingIndex(index);
                          }}
                          className="text-slate-400 hover:text-slate-600 hover:bg-white p-1 rounded-md border border-transparent hover:border-slate-200 disabled:opacity-30 transition"
                          title={isEn ? "Move Down" : "نقل لأسفل"}
                        >
                          ▼
                        </button>
                        {/* Edit */}
                        <button
                          type="button"
                          onClick={() => handleEditMedication(index)}
                          className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 p-1.5 rounded-lg border border-transparent hover:border-emerald-100 transition"
                          title={isEn ? "Edit item" : "تعديل هذا البند"}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        {/* Remove */}
                        <button
                          type="button"
                          onClick={() => handleRemoveMedication(index)}
                          className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-lg border border-transparent hover:border-rose-100 transition"
                          title={isEn ? "Delete" : "حذف"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {isBeingEdited && <div className="w-full sm:col-span-2">{medicationForm}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </div>
          <button type="button" data-testid="custom-drug-toggle" onClick={() => { handleCancelEdit(); setShowCustomDrug(!showCustomDrug); }} className="w-full flex items-center gap-2 text-xs font-bold text-slate-500 border border-dashed border-slate-300 rounded-xl px-4 py-3 hover:bg-white"><Plus size={15} className="text-emerald-600" />{isEn ? 'Add a medication outside the pharmacy' : 'إضافة دواء مش موجود في الصيدلية'}<span className="ms-auto text-[9px] text-amber-700 bg-amber-100 rounded px-2 py-0.5">{isEn ? 'Optional' : 'اختياري'}</span></button>
          {showCustomDrug && editingIndex === null && medicationForm}
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-xs text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-emerald-600" />
                  {isEn ? 'Patient Recommendations' : 'توصيات للمريض'}
                </h4>
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">{isEn ? 'Optional' : 'اختياري'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500">{isEn ? 'Show on prescription' : 'تظهر في الروشتة'}</span>
                <button
                  type="button"
                  onClick={() => setRecommendationsOn(!recommendationsOn)}
                  className={`w-9 h-5 rounded-full transition relative shrink-0 cursor-pointer ${recommendationsOn ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  title={isEn ? 'Toggle recommendations on the prescription' : 'تفعيل أو قفل التوصيات في الروشتة'}
                >
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ insetInlineStart: recommendationsOn ? 'calc(100% - 1.125rem)' : '0.125rem' }} />
                </button>
              </div>
            </div>
            {recommendationsOn && <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!recommendationsOn}
              placeholder={recommendationsOn
                ? (isEn ? "e.g., Warm salt water rinse, avoid hot foods and beverages..." : "مثال: المضمضة بماء وملح دافئ، الامتناع عن المشروبات الساخنة...")
                : (isEn ? "Recommendations are off and won't appear on the printed prescription. Turn on the switch to write them." : "التوصيات مقفولة، مش هتظهر في الروشتة المطبوعة. فعّل المفتاح لو عايز تكتب توصيات للمريض.")}
              className={`w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs font-semibold ${!recommendationsOn ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
            />}
          </div>
        </div>

        {/* Live WYSIWYG A4 Preview (Right block of layout) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <Printer className="h-4 w-4 text-emerald-600" />
                {isEn ? 'Preview & Print' : 'المعاينة والطباعة'}
              </h3>
              <button type="button" data-testid="print-style-toggle" aria-expanded={showPrintStyle} onClick={() => setShowPrintStyle(!showPrintStyle)} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 bg-slate-100 px-3 py-2 rounded-lg"><Settings size={13} />{isEn ? 'Print appearance' : 'شكل الطباعة'}</button>
            </div>
            {showPrintStyle && <div className="space-y-3">
        {/* Style selection pill indicators */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200/60 self-start sm:self-auto">
          <span className="text-[10px] font-bold text-slate-400 px-2">{t('prescriptions.prescriptionIdentity')}:</span>
          <button
            onClick={() => setPStyle('classic')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${pStyle === 'classic' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {t('prescriptions.classic')}
          </button>
          <button
            onClick={() => setPStyle('modern')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${pStyle === 'modern' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {t('prescriptions.modern')}
          </button>
          <button
            onClick={() => setPStyle('minimal')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${pStyle === 'minimal' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {t('prescriptions.minimal')}
          </button>
          <button
            onClick={() => setPStyle('elegant')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${pStyle === 'elegant' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {t('prescriptions.elegant')}
          </button>
          <button
            type="button"
            onClick={() => {
              setPStyle('custom_pad');
              setShowPadEditor(true);
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${pStyle === 'custom_pad' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            🎨 {t('prescriptions.customPad')}
          </button>
        </div>
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400">{isEn ? 'Format:' : 'التنسيق:'}</span>
              <button
                type="button"
                onClick={() => setPLayout('traditional')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${pLayout === 'traditional' ? 'bg-slate-200 text-slate-800' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              >
                {isEn ? 'Rx List' : 'قائمة Rx'}
              </button>
              <button
                type="button"
                onClick={() => setPLayout('table')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${pLayout === 'table' ? 'bg-slate-200 text-slate-800' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              >
                {isEn ? 'Ruled Table' : 'جدول مسطر'}
              </button>
            </div>
            </div>
            </div>}
          </div>
          {/* Visual Paper Canvas */}
          {pStyle === 'custom_pad' ? (
            <div
              className="w-full bg-white rounded-2xl shadow-xl relative overflow-hidden flex flex-col min-h-[520px] select-none border-2 border-amber-300"
              style={{ aspectRatio: '1 / 1.414' }}
            >
              {/* Background prescription image if uploaded */}
              {effectivePadConfig.backgroundImage && effectivePadConfig.backgroundImage.trim() !== '' ? (
                <img
                  src={effectivePadConfig.backgroundImage}
                  alt="Custom Prescription Background"
                  className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none z-0"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-b from-amber-50/20 via-white to-amber-50/10 border-2 border-dashed border-amber-200 flex flex-col items-center justify-center p-6 text-center text-amber-800/60 z-0 pointer-events-none">
                  <p className="text-sm font-bold">{isEn ? 'No prescription pad image uploaded yet' : 'لم يتم رفع صورة الروشتة المطبوعة بعد'}</p>
                  <p className="text-xs text-slate-400 mt-1">{isEn ? 'Upload your prescription design and drag boxes above' : 'يمكنك رفع صورة تصميم روشتتك وسحب الخانات بالأعلى'}</p>
                </div>
              )}

              {/* Absolute elements based on customPrescriptionPadConfig */}
              {(['patientName', 'patientAge', 'date', 'medicationsBox', 'notesBox'] as ElementKey[]).map((key) => {
                const el = effectivePadConfig[key];
                const isBox = key === 'medicationsBox' || key === 'notesBox';

                return (
                  <div
                    key={key}
                    style={{
                      position: 'absolute',
                      top: `${el.top}%`,
                      left: `${el.left}%`,
                      width: isBox ? `${el.width || 84}%` : 'auto',
                      height: isBox ? `${el.height || 20}%` : 'auto',
                      fontSize: `${el.fontSize || 13}px`,
                    }}
                    className="pointer-events-none z-10"
                  >
                      <>
                        {/* Real Content Rendering */}
                        {key === 'patientName' && (
                          <div className="font-black text-slate-900">
                            {patientNameText}
                          </div>
                        )}

                        {key === 'patientAge' && (
                          <div className="font-bold text-slate-800">
                            {patientAge ? `${patientAge} ${isEn ? 'Years' : 'سنة'}` : ''}
                          </div>
                        )}

                        {key === 'date' && (
                          <div className="font-bold text-slate-800">
                            {todayDateString}
                          </div>
                        )}

                        {key === 'medicationsBox' && (
                          <div className="overflow-y-auto h-full w-full">
                            {pLayout === 'table' ? (
                              <table className={`w-full border-collapse ${isEn ? 'text-left' : 'text-right'}`} style={{ fontSize: '0.9em' }}>
                                <thead>
                                  <tr className="border-b-2 border-slate-900 font-extrabold text-slate-900">
                                    <th className={`p-1 ${isEn ? 'text-left' : 'text-right'}`}>{isEn ? 'Medication' : 'الدواء'}</th>
                                    <th className="p-1 text-center">{isEn ? 'Dose' : 'الجرعة'}</th>
                                    <th className="p-1 text-center">{isEn ? 'Frequency & Duration' : 'التكرار والمدة'}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {medications.length > 0 ? (
                                    medications.map((m, i) => (
                                      <tr key={i} className="border-b border-dashed border-slate-300">
                                        <td className="p-1 font-extrabold text-slate-900 font-mono text-left" dir="ltr">{m.name}</td>
                                        <td className="p-1 text-center font-bold text-slate-800">{m.dose}</td>
                                        <td className="p-1 text-center font-bold text-slate-800">{m.frequency} • {m.duration}</td>
                                      </tr>
                                    ))
                                  ) : (
                                    <tr><td colSpan={3} className="p-3 text-slate-300 text-center">{isEn ? 'No medications added yet' : 'لم تتم إضافة أدوية بعد'}</td></tr>
                                  )}
                                </tbody>
                              </table>
                            ) : (
                              <div className={`space-y-1 ${isEn ? 'text-left' : 'text-right'}`} dir={isEn ? "ltr" : "rtl"}>
                                {medications.length > 0 ? (
                                  medications.map((m, i) => (
                                    <div key={i} className="border-b border-dashed border-slate-300 pb-1">
                                      <div className="font-extrabold text-slate-900 font-mono text-left" dir="ltr" style={{ fontSize: '1.05em' }}>
                                        {i + 1}. {m.name}
                                      </div>
                                      <div className={`font-bold text-slate-700 mt-0.5 ${isEn ? 'pl-2' : 'pr-2'}`} style={{ fontSize: '0.85em' }}>
                                        {m.dose} • {m.frequency} • {m.duration}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-slate-300 text-center text-xs">{isEn ? 'No medications added yet' : 'لم تتم إضافة أدوية بعد'}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {key === 'notesBox' && recommendationsOn && (
                          <div className={`overflow-y-auto font-bold text-slate-700 h-full w-full ${isEn ? 'text-left' : 'text-right'}`} dir={isEn ? "ltr" : "rtl"}>
                            <div>
                              <span className="font-extrabold text-slate-900">{isEn ? 'Instructions & Notes: ' : 'ملاحظات وطريقة الاستعمال: '}</span>
                              <span>{notes || (isEn ? 'Rinse with warm salt water, avoid hot food and drinks.' : 'المضمضة بالماء الدافئ والملح، وتجنب المأكولات الساخنة.')}</span>
                            </div>
                          </div>
                        )}
                      </>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className="w-full bg-white rounded-2xl shadow-xl border border-slate-200/80 p-8 relative overflow-hidden flex flex-col min-h-[520px]"
              style={{
                borderColor: colors.primary + '30',
                borderWidth: pStyle === 'classic' || pStyle === 'elegant' ? '4px' : '2px',
                borderStyle: pStyle === 'classic' || pStyle === 'elegant' ? 'double' : 'solid'
              }}
            >
              {/* Watermark in background */}
              <div
                className="absolute inset-0 pointer-events-none opacity-[0.15] z-0 flex items-center justify-center"
                style={{
                  backgroundImage: clinic.logoUrl ? `url('${clinic.logoUrl}')` : undefined,
                  backgroundSize: '380px',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center'
                }}
              >
                {!clinic.logoUrl && (
                  <div className="text-[250px] font-bold text-slate-800">⚕</div>
                )}
              </div>

              {/* Header layout */}
              <div
                className="grid grid-cols-12 items-center gap-2 p-5 rounded-2xl mb-5 z-10 text-white"
                style={{ backgroundColor: colors.primary }}
              >
                {/* Right: Arabic Header */}
                <div className="col-span-5 text-right space-y-1">
                  <h4 className="text-sm font-black text-white">{clinic.nameAr || clinic.name}</h4>
                  <p className="text-[11px] font-extrabold text-slate-100">
                    {isEn ? `Dr. ${clinic.doctorName || 'Dental Specialist'}` : `دكتور: ${clinic.doctorName || 'أخصائي الأسنان'}`}
                  </p>
                  <p className="text-[9px] text-slate-200 font-bold leading-relaxed">{clinic.doctorSpecialtyAr || (isEn ? 'Oral and Maxillofacial Surgery, Cosmetics & Dental Implants' : 'طب وجراحة الفم والأسنان وتجميل وزراعة الأسنان')}</p>
                </div>

                {/* Center: Clinic Logo */}
                <div className="col-span-2 flex justify-center">
                  {clinic.logoUrl && clinic.logoUrl.trim() !== '' ? (
                    <img src={clinic.logoUrl} alt="Logo" className="w-20 h-20 object-contain" />
                  ) : (
                    <div className="w-16 h-16 flex items-center justify-center text-3xl font-bold text-white">⚕</div>
                  )}
                </div>

                {/* Left: English Header */}
                <div className="col-span-5 text-left space-y-1" dir="ltr">
                  <h4 className="text-sm font-black tracking-tight text-white">{clinic.nameEn || 'Dental Clinic'}</h4>
                  <p className="text-[11px] font-extrabold text-slate-100">Dr. {clinic.doctorNameEn || clinic.doctorName || 'Dental Specialist'}</p>
                  <p className="text-[9px] text-slate-200 font-bold leading-relaxed">{clinic.doctorSpecialtyEn || 'Specialist of Oral & Dental Surgery'}</p>
                </div>
              </div>

              {/* Patient card details */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl mb-6 text-[11px] z-10" style={{ backgroundColor: colors.bg, border: `1px solid ${colors.primary}20` }}>
                <div className={isEn ? "text-left" : "text-right"}>
                  <span className="font-bold" style={{ color: colors.primary }}>{isEn ? 'Patient: ' : 'اسم المريض: '}</span>
                  <span className="font-semibold text-slate-800">{patientNameText}</span>
                </div>
                <div className="text-center">
                  <span className="font-bold" style={{ color: colors.primary }}>{isEn ? 'Age: ' : 'السن: '}</span>
                  <span className="font-semibold text-slate-800">{patientAge} {isEn ? 'Years' : 'سنة'}</span>
                </div>
                <div className={isEn ? "text-right" : "text-left"} dir="ltr">
                  <span className="font-bold" style={{ color: colors.primary }}>{isEn ? 'Date: ' : 'التاريخ: '}</span>
                  <span className="font-semibold text-slate-800">{todayDateString}</span>
                </div>
              </div>

              {/* Prescription body */}
              <div className="flex-1 z-10">
                {/* Medications listing in WYSIWYG */}
                {pLayout === 'traditional' ? (
                  <div className="space-y-4">
                    {medications.map((med, index) => (
                      <div key={index} className="pb-3 border-b border-dashed border-slate-100 last:border-b-0">
                        <div className="text-sm font-bold text-slate-800 text-left tracking-wide" dir="ltr">
                          {index + 1}. {med.name}
                        </div>
                        <div className={`text-[11px] font-bold text-slate-500 mt-1 ${isEn ? 'text-left pl-4' : 'text-right pr-4'}`} dir={isEn ? "ltr" : "rtl"}>
                          {med.dose} • {med.frequency} • {med.duration}
                        </div>
                      </div>
                    ))}
                    {medications.length === 0 && (
                      <p className="text-center text-slate-300 text-xs italic py-8">
                        {isEn ? 'No medications added yet...' : 'لم يتم إدراج أي علاج طبي بعد...'}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="overflow-hidden border border-slate-200 rounded-xl">
                    <table className={`w-full border-collapse ${isEn ? 'text-left' : 'text-right'}`}>
                      <thead>
                        <tr className="text-white text-[11px]" style={{ backgroundColor: colors.primary }}>
                          <th className={`p-2 ${isEn ? 'border-r border-white/10' : 'border-l border-white/10'}`}>{isEn ? 'Medication Name' : 'اسم المستحضر الطبي'}</th>
                          <th className={`p-2 ${isEn ? 'border-r border-white/10' : 'border-l border-white/10'}`}>{isEn ? 'Dose' : 'الجرعة'}</th>
                          <th className={`p-2 ${isEn ? 'border-r border-white/10' : 'border-l border-white/10'}`}>{isEn ? 'Frequency & Instructions' : 'التكرار والتعليمات'}</th>
                          <th className="p-2">{isEn ? 'Duration' : 'المدة'}</th>
                        </tr>
                      </thead>
                      <tbody className="text-[11px] font-semibold text-slate-700">
                        {medications.map((med, idx) => (
                          <tr key={idx} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                            <td className={`p-2 font-bold ${isEn ? 'border-r border-slate-100' : 'border-l border-slate-100'}`} dir="ltr">{med.name}</td>
                            <td className={`p-2 ${isEn ? 'border-r border-slate-100' : 'border-l border-slate-100'}`}>{med.dose}</td>
                            <td className={`p-2 ${isEn ? 'border-r border-slate-100' : 'border-l border-slate-100'}`}>{med.frequency}</td>
                            <td className="p-2">{med.duration}</td>
                          </tr>
                        ))}
                        {medications.length === 0 && (
                          <tr>
                            <td colSpan={4} className="p-4 text-center text-slate-300 italic">
                              {isEn ? 'No medications added yet...' : 'لم يتم إدراج أي علاج طبي بعد...'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recommendations/Notes block - Placed at the very bottom above footer */}
              {recommendationsOn && (
              <div
                className={`mt-8 p-3 rounded-lg text-[11px] leading-relaxed z-10 ${isEn ? 'text-left' : 'text-right'}`}
                style={{
                  borderRightWidth: isEn ? '0px' : '4px',
                  borderLeftWidth: isEn ? '4px' : '0px',
                  borderStyle: 'solid',
                  borderColor: colors.primary,
                  backgroundColor: '#f8fafc'
                }}
              >
                <strong className="text-slate-800 block mb-1">
                  {isEn ? 'Medical Instructions & Advice:' : 'التوصيات الطبية والتعليمات للمريض:'}
                </strong>
                <p className="text-slate-600 font-semibold">{notes || (isEn ? 'Strict adherence to prescribed instructions is required.' : 'يلتزم المريض بالمواعيد المحددة أعلاه بدقة تامة.')}</p>
              </div>
              )}

              {/* Bottom stamp area & details footer */}
              <div className="border-t-2 mt-8 pt-4 flex justify-between items-end text-[9px] text-slate-500 z-10" style={{ borderColor: colors.primary + '30' }}>
                <div className="text-center">
                  <p className="font-semibold text-slate-600">{isEn ? "Doctor's Signature & Stamp" : 'توقيع وختم الطبيب'}</p>
                  <div className="w-28 border-b border-slate-300 mt-10"></div>
                </div>

                {clinic.clinicHours ? (
                  <div className="text-center text-slate-600 font-bold bg-slate-50 border border-slate-100 px-3 py-1 rounded-full text-[8.5px]">
                    {isEn ? 'Working Hours: ' : 'مواعيد العمل: '}{clinic.clinicHours}
                  </div>
                ) : null}

                <div className={isEn ? "text-right space-y-1" : "text-left space-y-1"}>
                  <p className="font-semibold"><strong>{isEn ? 'Address: ' : 'العنوان: '}</strong>{clinic.address || (isEn ? 'Official Clinic Address' : 'عنوان العيادة الرسمي')}</p>
                  <p className="font-semibold"><strong>{isEn ? 'Tel: ' : 'للاتصال: '}</strong>{clinic.doctorPhone || (isEn ? 'Not recorded' : 'غير مسجل')}{clinic.additionalPhones && clinic.additionalPhones.length > 0 ? ` - ${clinic.additionalPhones.filter(Boolean).join(' - ')}` : ''}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleSaveOnly}
              disabled={medications.length === 0 || loading || isSavingOnly}
              className="bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 font-bold py-3 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-md shadow-slate-100 disabled:opacity-50 cursor-pointer"
            >
              <Save className="h-4 w-4" />
              {isSavingOnly ? (isEn ? 'Saving...' : 'جاري الحفظ...') : (isEn ? 'Save without printing' : 'حفظ بدون طباعة')}
            </button>

            <button
              type="button"
              onClick={handleSaveAndPrint}
              disabled={medications.length === 0 || loading || isSavingOnly}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-md shadow-emerald-50 disabled:opacity-50 cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              {loading ? (isEn ? 'Saving & Preparing Print...' : 'جاري حفظ وطباعة الروشتة...') : (isEn ? 'Save & Print' : 'حفظ وطباعة')}
            </button>
          </div>
        </div>
      </div>

      {showPadEditor && <PrescriptionPadModal config={effectivePadConfig} isEn={!!isEn} onChange={updatePadElementConfig} onClose={() => setShowPadEditor(false)} onReset={handleResetPadPositions} onUpload={handlePadImageUpload} onRemoveImage={handleRemovePadImage} onTogglePrint={handleToggleHideOnPrint} uploading={isCompressingImage} saveStatus={padSaveStatus} onRetry={() => persistPadConfig(effectivePadConfig)} />}
      {/* Custom Medications Management Modal */}
      {showMedSettings && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4" dir={isEn ? "ltr" : "rtl"}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-fade-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-800">
                  {isEn ? 'Clinic Pharmacy & Medication Categories' : 'إدارة صيدلية العيادة وأقسام الأدوية'}
                </h3>
              </div>
              <button
                onClick={() => setShowMedSettings(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-slate-100 bg-slate-50/50 px-6">
              <button
                type="button"
                onClick={() => setSettingsTab('drugs')}
                className={`py-3 px-4 text-xs font-bold transition-all border-b-2 -mb-[1px] flex items-center gap-1.5 ${settingsTab === 'drugs' ? 'border-emerald-600 text-emerald-600 font-extrabold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                {isEn ? `💊 Medication Management (${customDrugs.length})` : `💊 إدارة الأدوية والمستحضرات (${customDrugs.length})`}
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab('categories')}
                className={`py-3 px-4 text-xs font-bold transition-all border-b-2 -mb-[1px] flex items-center gap-1.5 ${settingsTab === 'categories' ? 'border-emerald-600 text-emerald-600 font-extrabold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                {isEn ? `🗂️ Category Management (${customCategories.length})` : `🗂️ إدارة الأقسام والتصنيفات (${customCategories.length})`}
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {settingsTab === 'drugs' ? (
                <div className="space-y-6">
                  {/* Form to Add New Medication to Clinic Dictionary */}
                  <form onSubmit={handleAddCustomDrug} className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-4">
                    <h4 className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                      <Plus className="h-4 w-4" />
                      {isEn ? 'Add New Medication to Clinic List:' : 'إضافة دواء جديد لقائمة العيادة:'}
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="sm:col-span-2 md:col-span-1">
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          {isEn ? 'Medication Name' : 'اسم الدواء'}
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={isEn ? "e.g., Augmentin 1g" : "مثال: Augmentin 1g"}
                          value={newCustomDrug.name}
                          onChange={(e) => setNewCustomDrug(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          {isEn ? 'Default Dose' : 'الجرعة الافتراضية'}
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={isEn ? "e.g. 1 Tablet" : "مثال: قرص واحد"}
                          value={newCustomDrug.dose}
                          onChange={(e) => setNewCustomDrug(prev => ({ ...prev, dose: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          {isEn ? 'Frequency & Instructions' : 'التكرار والتعليمات'}
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={isEn ? "e.g. Every 12 hours" : "مثال: كل 12 ساعة"}
                          value={newCustomDrug.frequency}
                          onChange={(e) => setNewCustomDrug(prev => ({ ...prev, frequency: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          {isEn ? 'Default Duration' : 'المدة الافتراضية'}
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={isEn ? "e.g. 5 days" : "مثال: 5 أيام"}
                          value={newCustomDrug.duration}
                          onChange={(e) => setNewCustomDrug(prev => ({ ...prev, duration: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 font-semibold"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">
                          {isEn ? 'Category / Section' : 'القسم / التصنيف'}
                        </label>
                        <select
                          required
                          value={newCustomDrug.category}
                          onChange={(e) => setNewCustomDrug(prev => ({ ...prev, category: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 font-semibold"
                        >
                          {customCategories.map(cat => (
                            <option key={cat.id} value={cat.name}>{getCategoryDisplayName(cat.name)}</option>
                          ))}
                          {customCategories.length === 0 && (
                            <option value="أخرى">{isEn ? 'Other' : 'أخرى'}</option>
                          )}
                        </select>
                      </div>
                    </div>

                    <div className={`flex pt-2 ${isEn ? 'justify-end' : 'justify-end'}`}>
                      <button
                        type="submit"
                        disabled={medSettingsLoading}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl text-xs transition flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {medSettingsLoading ? (isEn ? 'Adding...' : 'جاري الإضافة...') : (isEn ? 'Add to List' : 'إضافة للقائمة')}
                      </button>
                    </div>
                  </form>

                  {/* Table / List of Current Custom Medications */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-500">
                      {isEn ? `Current Clinic Medications List (${customDrugs.length}):` : `قائمة الأدوية والمستحضرات الحالية (${customDrugs.length}):`}
                    </h4>

                    <div className="border border-slate-100 rounded-xl overflow-hidden bg-white">
                      <div className="overflow-x-auto max-h-[350px]">
                        <table className={`w-full border-collapse text-xs ${isEn ? 'text-left' : 'text-right'}`}>
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                              <th className="p-3">{isEn ? 'Medication Name' : 'اسم الدواء'}</th>
                              <th className="p-3">{isEn ? 'Default Dose' : 'الجرعة الافتراضية'}</th>
                              <th className="p-3">{isEn ? 'Frequency & Instructions' : 'التكرار والتعليمات'}</th>
                              <th className="p-3">{isEn ? 'Category' : 'القسم / التصنيف'}</th>
                              <th className="p-3 text-center">{isEn ? 'Actions' : 'إجراءات'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {customDrugs.map((drug) => {
                              const isEditing = editingDrugId === drug.id;
                              return isEditing ? (
                                <tr key={drug.id} className="bg-emerald-50/30">
                                  <td className="p-3">
                                    <input
                                      type="text"
                                      className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-bold"
                                      value={editingDrugData.name}
                                      onChange={(e) => setEditingDrugData(prev => ({ ...prev, name: e.target.value }))}
                                    />
                                  </td>
                                  <td className="p-3">
                                    <input
                                      type="text"
                                      className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                                      value={editingDrugData.dose}
                                      onChange={(e) => setEditingDrugData(prev => ({ ...prev, dose: e.target.value }))}
                                    />
                                  </td>
                                  <td className="p-3">
                                    <div className="flex gap-1">
                                      <input
                                        type="text"
                                        className="w-1/2 px-2 py-1 border border-slate-200 rounded text-xs"
                                        placeholder={isEn ? "Every 12 hours..." : "كل 12 ساعة..."}
                                        value={editingDrugData.frequency}
                                        onChange={(e) => setEditingDrugData(prev => ({ ...prev, frequency: e.target.value }))}
                                      />
                                      <input
                                        type="text"
                                        className="w-1/2 px-2 py-1 border border-slate-200 rounded text-xs"
                                        placeholder={isEn ? "5 days..." : "5 أيام..."}
                                        value={editingDrugData.duration}
                                        onChange={(e) => setEditingDrugData(prev => ({ ...prev, duration: e.target.value }))}
                                      />
                                    </div>
                                  </td>
                                  <td className="p-3">
                                    <select
                                      className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                                      value={editingDrugData.category}
                                      onChange={(e) => setEditingDrugData(prev => ({ ...prev, category: e.target.value }))}
                                    >
                                      {customCategories.map(cat => (
                                        <option key={cat.id} value={cat.name}>{getCategoryDisplayName(cat.name)}</option>
                                      ))}
                                      {customCategories.length === 0 && (
                                        <option value="أخرى">{isEn ? 'Other' : 'أخرى'}</option>
                                      )}
                                    </select>
                                  </td>
                                  <td className="p-3 text-center flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEditDrug(drug.id)}
                                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition"
                                      title={isEn ? "Save" : "حفظ"}
                                    >
                                      <Save className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingDrugId(null)}
                                      className="p-1.5 text-slate-400 hover:bg-slate-50 rounded transition"
                                      title={isEn ? "Cancel" : "إلغاء"}
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              ) : (
                                <tr key={drug.id} className="hover:bg-slate-50/50">
                                  <td className="p-3 font-semibold text-slate-800">{drug.name}</td>
                                  <td className="p-3 text-slate-600">{drug.dose}</td>
                                  <td className="p-3 text-slate-600">{drug.frequency} ({drug.duration})</td>
                                  <td className="p-3">
                                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">
                                      {getCategoryDisplayName(drug.category)}
                                    </span>
                                  </td>
                                  <td className="p-3 text-center flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditDrug(drug)}
                                      className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg transition"
                                      title={isEn ? "Edit" : "تعديل"}
                                    >
                                      <Edit className="h-4 w-4" />
                                    </button>
                                    {!isStaff && (
                                      <button
                                        type="button"
                                        disabled={medSettingsLoading}
                                        onClick={() => handleDeleteCustomDrug(drug.id)}
                                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition disabled:opacity-50"
                                        title={isEn ? "Delete" : "حذف"}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {customDrugs.length === 0 && (
                              <tr>
                                <td colSpan={5} className="p-8 text-center text-slate-400 italic">
                                  {isEn ? 'No custom medications added to your list yet.' : 'لا توجد أدوية مضافه لقائمتك حتى الآن.'}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Form to Add Category */}
                  <form onSubmit={handleAddCategory} className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 flex flex-col sm:flex-row gap-3 items-end">
                    <div className="flex-1 w-full">
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">
                        {isEn ? 'New Category Name (e.g., Analgesics, Antibiotics, Mouthwash)' : 'اسم القسم الجديد (مثل: مسكنات، مضادات حيوية، غسول فم)'}
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={isEn ? "e.g. Local Anesthesia" : "مثال: مخدر موضعي"}
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 font-semibold"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={medSettingsLoading}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-5 rounded-lg text-xs transition flex items-center justify-center gap-1 disabled:opacity-50 h-[34px] w-full sm:w-auto"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isEn ? 'Add Category' : 'إضافة القسم'}
                    </button>
                  </form>

                  {/* Categories list table with Edit and Delete */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-500">
                      {isEn ? `Current Clinic Categories (${customCategories.length}):` : `قائمة الأقسام والتصنيفات الحالية بالعيادة (${customCategories.length}):`}
                    </h4>
                    <div className="border border-slate-100 rounded-xl overflow-hidden bg-white">
                      <table className={`w-full border-collapse text-xs ${isEn ? 'text-left' : 'text-right'}`}>
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                            <th className="p-3">{isEn ? 'Category Name' : 'اسم القسم'}</th>
                            <th className="p-3 text-center">{isEn ? 'Medications Count' : 'عدد الأدوية به'}</th>
                            <th className="p-3 text-center">{isEn ? 'Actions' : 'إجراءات'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {customCategories.map((cat) => {
                            const count = customDrugs.filter(d => d.category === cat.name).length;
                            const isEditing = editingCategoryId === cat.id;
                            return (
                              <tr key={cat.id} className="hover:bg-slate-50/50">
                                <td className="p-3">
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      required
                                      className="w-full max-w-xs px-2 py-1 border border-slate-200 rounded text-xs font-semibold"
                                      value={editingCategoryName}
                                      onChange={(e) => setEditingCategoryName(e.target.value)}
                                    />
                                  ) : (
                                    <span className="font-bold text-slate-800">{getCategoryDisplayName(cat.name)}</span>
                                  )}
                                </td>
                                <td className="p-3 text-center text-slate-500 font-semibold">{count} {isEn ? 'medications' : 'أدوية'}</td>
                                <td className="p-3 text-center flex items-center justify-center gap-2">
                                  {isEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleEditCategory(cat.id)}
                                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                                        title={isEn ? "Save" : "حفظ"}
                                      >
                                        <Save className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCategoryId(null);
                                          setEditingCategoryName('');
                                        }}
                                        className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg transition"
                                        title={isEn ? "Cancel" : "إلغاء"}
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCategoryId(cat.id);
                                          setEditingCategoryName(cat.name);
                                        }}
                                        className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg transition"
                                        title={isEn ? "Edit" : "تعديل"}
                                      >
                                        <Edit className="h-4 w-4" />
                                      </button>
                                      {!isStaff && (
                                        <button
                                          type="button"
                                          disabled={medSettingsLoading}
                                          onClick={() => handleDeleteCategory(cat.id, cat.name)}
                                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition disabled:opacity-50"
                                          title={isEn ? "Delete" : "حذف"}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {customCategories.length === 0 && (
                            <tr>
                              <td colSpan={3} className="p-8 text-center text-slate-400 italic">
                                {isEn ? 'No categories defined in the clinic yet.' : 'لا توجد أقسام معرفة بالعيادة حتى الآن.'}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-100 flex justify-end bg-slate-50">
              <button
                type="button"
                onClick={() => setShowMedSettings(false)}
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 px-5 rounded-xl text-xs transition"
              >
                {isEn ? 'Close' : 'إغلاق'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prescription Print Preview Modal */}
      <PrintPreviewModal
        isOpen={!!previewHtml}
        onClose={() => setPreviewHtml(null)}
        title={isEn ? "Prescription Print Preview" : "معاينة وطباعة الروشتة الطبية"}
        htmlContent={previewHtml || ''}
      />
    </div>
  );
}
