import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Beaker, 
  Plus, 
  Trash2, 
  Edit, 
  Check, 
  Clock, 
  AlertTriangle, 
  Coins, 
  Search, 
  User, 
  Phone, 
  MapPin, 
  Mail, 
  SlidersHorizontal,
  X,
  RefreshCw
} from 'lucide-react';
import { dentalService } from '../services/dentalService';
import { Patient, Appointment, Laboratory, LabOrder, LabWorkType } from '../types/dental';
import { Clinic } from '../types';
import { useDialogs } from './DialogContext';
import { checkSubscriptionBlocked } from '../utils/timeUtils';
import { db, collection, addDoc } from '../dbClient';
import { formatEgyptianPhoneInput, isValidEgyptianPhone, getEgyptianPhoneError } from '../utils/phoneUtils';

interface LabTrackingViewProps {
  clinic: { id: string } & Record<string, any>;
  isDemoMode: boolean;
  isStaff?: boolean;
  operatorName?: string;
  activeShift?: any;
}

export default function LabTrackingView({ clinic, isDemoMode, isStaff, operatorName, activeShift }: LabTrackingViewProps) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.startsWith('en');
  const dialogs = useDialogs();
  
  const [activeSubTab, setActiveSubTab] = useState<'dashboard_orders' | 'laboratories' | 'lab_work_types'>('dashboard_orders');
  
  // Data States
  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [labWorkTypes, setLabWorkTypes] = useState<LabWorkType[]>([]);
  
  const [_loading, setLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);

  // Filters
  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('sent');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [labFilter, setLabFilter] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<'all' | 'delayed' | 'critical'>('all');
  const [ordersLimit, setOrdersLimit] = useState<number>(5);

  // Reset pagination on filter or search changes
  useEffect(() => {
    setOrdersLimit(5);
  }, [orderSearch, statusFilter, paymentFilter, labFilter, timeFilter]);

  // Modals States
  const [isLabModalOpen, setIsLabModalOpen] = useState(false);
  const [selectedLab, setSelectedLab] = useState<Laboratory | null>(null);
  
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<LabOrder | null>(null);

  const [isWorkTypeModalOpen, setIsWorkTypeModalOpen] = useState(false);
  const [selectedWorkType, setSelectedWorkType] = useState<LabWorkType | null>(null);
  const [workTypeForm, setWorkTypeForm] = useState({ name: '' });

  // Lab Form States
  const [labForm, setLabForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: ''
  });

  // Order Form States
  const [orderForm, setOrderForm] = useState({
    patientId: '',
    laboratoryId: '',
    appointmentId: '',
    workType: 'Zircon cladding',
    toothNumbers: '',
    shadeColor: 'A1',
    sentDate: new Date().toISOString().split('T')[0],
    expectedDeliveryDate: '',
    cost: 0,
    paymentStatus: 'unpaid' as 'paid' | 'unpaid' | 'partial',
    paidAmount: 0,
    paymentMethod: isEn ? 'Cash' : 'كاش',
    status: 'sent' as 'sent' | 'received' | 'installed' | 'cancelled',
    notes: ''
  });

  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [editingPaidAmounts, setEditingPaidAmounts] = useState<Record<string, string>>({});
  const [editingPaymentMethods, setEditingPaymentMethods] = useState<Record<string, string>>({});

  const paymentMethodsList = React.useMemo(() => {
    return (clinic as any)?.paymentMethods?.length
      ? (clinic as any).paymentMethods
      : (isEn ? ['Cash', 'Visa', 'InstaPay', 'Wallet'] : ['كاش', 'فيزا', 'إنستاباي', 'محفظة']);
  }, [(clinic as any)?.paymentMethods, isEn]);

  // Load All Data
  const loadAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [labsData, ordersData, patientsData, apptsData, workTypesData] = await Promise.all([
        dentalService.getLaboratories(clinic.id, isDemoMode),
        dentalService.getLabOrders(clinic.id, isDemoMode),
        dentalService.getPatients(clinic.id, isDemoMode),
        dentalService.getAppointments(clinic.id, isDemoMode),
        dentalService.getLabWorkTypes(clinic.id, isDemoMode)
      ]);
      setLaboratories(labsData);
      setLabOrders(ordersData);
      setPatients(patientsData);
      setAppointments(apptsData);
      setLabWorkTypes(workTypesData);
    } catch (err: any) {
      console.error(err);
      setError((isEn ? 'Failed to load laboratory data and orders: ' : 'فشل في تحميل بيانات المعامل والطلبات: ') + (err.message || err.toString()));
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    loadAllData();

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { table } = customEvent.detail || {};
      
      const relevantTables = ['laboratories', 'lab_orders', 'lab_work_types', 'patients'];
      if (
        relevantTables.includes(table) &&
        !isLabModalOpen &&
        !isOrderModalOpen &&
        !isWorkTypeModalOpen
      ) {
        console.log(`[LabTrackingView] Instant laboratory tracking sync triggered for table: ${table}`);
        loadAllData();
      }
    };

    window.addEventListener('clinic-sync', handleSync);
    return () => window.removeEventListener('clinic-sync', handleSync);
  }, [clinic.id, isDemoMode, isLabModalOpen, isOrderModalOpen, isWorkTypeModalOpen]);

  // Helpers for calendar-day differences to avoid timezone shifts and hours bugs
  const parseLocalYMD = (dateStr: string): Date => {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(dateStr);
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // 0-indexed
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  };

  const getDaysDifference = (dateStr: string): number => {
    const target = parseLocalYMD(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    
    const diffTime = target.getTime() - today.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  };

  // Helper: check if order is overdue/delayed (strictly before today)
  const isOrderDelayed = (order: LabOrder) => {
    if (order.status === 'received' || order.status === 'installed' || order.status === 'cancelled') {
      return false;
    }

    if (order.expectedDeliveryDate) {
      const diff = getDaysDifference(order.expectedDeliveryDate);
      if (diff < 0) return true;
    }
    return false;
  };

  // Helper: check if order is critical (deadline is today or tomorrow, i.e., 0 or 1 day, and not delayed)
  const isOrderCritical = (order: LabOrder) => {
    if (order.status === 'received' || order.status === 'installed' || order.status === 'cancelled') {
      return false;
    }
    
    // If it's already delayed, it is NOT critical (it is delayed)
    if (isOrderDelayed(order)) {
      return false;
    }

    // Fallback: check expected delivery date
    if (order.expectedDeliveryDate) {
      const diff = getDaysDifference(order.expectedDeliveryDate);
      if (diff === 0 || diff === 1) return true;
    }

    return false;
  };

  // Financial Calculations
  const clinicCompletedRevenue = React.useMemo(() => {
    // Total from completed appointments
    return appointments
      .filter(a => a.status === 'Completed')
      .reduce((sum, a) => sum + 1500, 0); // fallback value or 1500 per completed appt if invoice is not loaded
  }, [appointments]);

  const totalLabExpenses = React.useMemo(() => {
    return labOrders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + (Number(o.cost) || 0), 0);
  }, [labOrders]);

  const labDebt = React.useMemo(() => {
    return labOrders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => {
        if (o.paymentStatus === 'unpaid') return sum + o.cost;
        if (o.paymentStatus === 'partial') return sum + (o.cost - (o.paidAmount ?? (o.cost / 2)));
        return sum;
      }, 0);
  }, [labOrders]);

  // Handle Lab Submission
  const handleLabSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic as Clinic, dialogs)) return;
    if (!labForm.name.trim()) {
      dialogs.alert(isEn ? 'Please fill in the lab name' : 'يرجى ملء اسم المعمل', { severity: 'warning' });
      return;
    }

    const cleanPhone = formatEgyptianPhoneInput(labForm.phone);
    const phoneErr = getEgyptianPhoneError(cleanPhone, true, isEn ? 'Laboratory phone' : 'رقم هاتف المعمل');
    if (phoneErr) {
      dialogs.alert(phoneErr, { severity: 'warning' });
      return;
    }

    setLoading(true);
    try {
      if (selectedLab) {
        // Edit Lab
        await dentalService.updateLaboratory(clinic.id, selectedLab.id, { ...labForm, phone: cleanPhone }, isDemoMode);
        dialogs.alert(isEn ? 'Laboratory details updated successfully' : 'تم تعديل بيانات المعمل بنجاح', { severity: 'success' });
      } else {
        // Add Lab
        const newLab: Omit<Laboratory, 'id'> = {
          clinicId: clinic.id,
          name: labForm.name,
          phone: cleanPhone,
          email: labForm.email || undefined,
          address: labForm.address || undefined,
          createdAt: new Date().toISOString()
        };
        await dentalService.addLaboratory(clinic.id, newLab, isDemoMode);
        dialogs.alert(isEn ? 'New laboratory registered successfully' : 'تم تسجيل المعمل الجديد بنجاح', { severity: 'success' });
      }
      setIsLabModalOpen(false);
      setSelectedLab(null);
      setLabForm({ name: '', phone: '', email: '', address: '' });
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Error saving laboratory: ' : 'خطأ أثناء حفظ المعمل: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Open Edit Lab
  const handleEditLab = (lab: Laboratory) => {
    setSelectedLab(lab);
    setLabForm({
      name: lab.name,
      phone: lab.phone,
      email: lab.email || '',
      address: lab.address || ''
    });
    setIsLabModalOpen(true);
  };

  // Delete Lab
  const handleDeleteLab = async (id: string) => {
    if (checkSubscriptionBlocked(clinic as Clinic, dialogs)) return;
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete items. Delete is available for doctors only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    const confirm = await dialogs.confirm(isEn ? 'Are you sure you want to delete this laboratory? This may affect associated lab orders.' : 'هل أنت متأكد من حذف هذا المعمل؟ قد يؤثر ذلك على تتبع طلبات المعمل المرتبطة به.', { severity: 'danger' });
    if (!confirm) return;

    setLoading(true);
    try {
      await dentalService.deleteLaboratory(clinic.id, id, isDemoMode);
      dialogs.alert(isEn ? 'Laboratory deleted successfully' : 'تم حذف المعمل بنجاح', { severity: 'success' });
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Error deleting laboratory: ' : 'خطأ أثناء حذف المعمل: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Handle Order Submission
  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkSubscriptionBlocked(clinic as Clinic, dialogs)) return;
    if (!orderForm.patientId || !orderForm.laboratoryId || !orderForm.workType || !orderForm.expectedDeliveryDate) {
      dialogs.alert(isEn ? 'Please select patient, laboratory, work type, and expected delivery date' : 'يرجى تحديد المريض والمعمل ونوع العمل وتاريخ الاستلام المتوقع', { severity: 'warning' });
      return;
    }

    setLoading(true);
    try {
      const selectedPatient = patients.find(p => p.id === orderForm.patientId);
      const selectedLabObj = laboratories.find(l => l.id === orderForm.laboratoryId);
      const selectedAppt = appointments.find(a => a.id === orderForm.appointmentId);

      const orderPayload = {
        clinicId: clinic.id,
        doctorId: operatorName || 'dentist_user',
        doctorName: operatorName || (isEn ? 'Clinic Doctor' : 'طبيب العيادة'),
        patientId: orderForm.patientId,
        patientName: selectedPatient ? selectedPatient.name : (isEn ? 'Unknown Patient' : 'مريض غير معروف'),
        patientPhone: selectedPatient ? selectedPatient.phone : '',
        laboratoryId: orderForm.laboratoryId,
        laboratoryName: selectedLabObj ? selectedLabObj.name : (isEn ? 'Unknown Laboratory' : 'معمل غير معروف'),
        appointmentId: orderForm.appointmentId || undefined,
        appointmentDate: selectedAppt ? selectedAppt.date : undefined,
        workType: orderForm.workType,
        toothNumbers: orderForm.toothNumbers,
        shadeColor: orderForm.shadeColor,
        sentDate: orderForm.sentDate,
        expectedDeliveryDate: orderForm.expectedDeliveryDate,
        actualDeliveryDate: selectedOrder?.actualDeliveryDate || undefined,
        cost: Number(orderForm.cost) || 0,
        paymentStatus: orderForm.paymentStatus,
        paidAmount: orderForm.paymentStatus === 'unpaid' ? 0 : (orderForm.paymentStatus === 'paid' ? (Number(orderForm.paidAmount) || Number(orderForm.cost) || 0) : (Number(orderForm.paidAmount) || 0)),
        paymentMethod: orderForm.paymentMethod || (isEn ? 'Cash' : 'كاش'),
        status: orderForm.status,
        notes: orderForm.notes,
        createdAt: selectedOrder ? selectedOrder.createdAt : new Date().toISOString()
      };

      if (selectedOrder) {
        const oldPaid = Number(selectedOrder.paidAmount) || 0;
        const newPaid = Number(orderPayload.paidAmount) || 0;
        if (newPaid < oldPaid) {
          dialogs.alert(isEn ? `Error: Paid amount cannot be reduced (previously paid: ${oldPaid} EGP, new amount: ${newPaid} EGP).` : `خطأ: لا يمكن تعديل المبلغ المدفوع بالنقصان (المدفوع سابقاً: ${oldPaid} ج.م والمطلوب حفظه حالياً: ${newPaid} ج.م). يجب الإبقاء عليه أو زيادته فقط ليتم ترحيل الفارق كمنصرف إضافي في الحسابات والمصاريف.`, { severity: 'warning' });
          setLoading(false);
          return;
        }
      }

      if (selectedOrder) {
        // Edit Order
        await dentalService.updateLabOrder(clinic.id, selectedOrder.id, orderPayload, isDemoMode);
        dialogs.alert(isEn ? 'Lab order updated successfully' : 'تم تعديل طلب المعمل بنجاح', { severity: 'success' });
      } else {
        // Create Order
        await dentalService.addLabOrder(clinic.id, orderPayload, isDemoMode);
        dialogs.alert(isEn ? 'Lab order sent and recorded successfully' : 'تم إرسال طلب المعمل وتسجيله بنجاح', { severity: 'success' });
      }

      // Record Expense in Financials
      let difference = 0;
      const newPaid = Number(orderPayload.paidAmount) || 0;
      if (selectedOrder) {
        const oldPaid = Number(selectedOrder.paidAmount) || 0;
        difference = newPaid - oldPaid;
      } else {
        difference = newPaid;
      }

      if (difference !== 0) {
        try {
          const expensePayload = {
            title: difference > 0 ? (isEn ? `Lab Payment: ${orderPayload.laboratoryName}` : `دفعة معمل: ${orderPayload.laboratoryName}`) : (isEn ? `Lab Adjustment: ${orderPayload.laboratoryName}` : `تعديل بالخصم معمل: ${orderPayload.laboratoryName}`),
            amount: difference,
            category: isEn ? 'Lab Expenses' : 'مصاريف معامل',
            date: (() => {
              const d = new Date();
              const pad = (n: number) => String(n).padStart(2, '0');
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            })(),
            notes: difference > 0
              ? (isEn ? `Lab order payment for ${orderPayload.workType} - Patient: ${orderPayload.patientName} [Payment Method: ${orderPayload.paymentMethod}]. ${activeShift ? 'Deducted from open shift' : 'Personal funds'}` : `طلب معمل لـ ${orderPayload.workType} - مريض: ${orderPayload.patientName} [طريقة الدفع: ${orderPayload.paymentMethod}]. ${activeShift ? 'مخصوم من الوردية المفتوحة' : 'مال خاص'}`).trim()
              : (isEn ? `Lab order deduction adjustment for ${orderPayload.workType} - Patient: ${orderPayload.patientName} [Payment Method: ${orderPayload.paymentMethod}]. ${activeShift ? 'Adjusted in open shift' : 'Personal funds'}` : `تعديل خفض قيمة الدفعة لطلب معمل لـ ${orderPayload.workType} - مريض: ${orderPayload.patientName} [طريقة الدفع: ${orderPayload.paymentMethod}]. ${activeShift ? 'مصحح بالوردية المفتوحة' : 'مال خاص'}`).trim(),
            type: activeShift ? 'shift' : 'personal',
            shiftId: activeShift ? activeShift.id : null,
            paymentMethod: orderPayload.paymentMethod || (isEn ? 'Cash' : 'كاش'),
            createdAt: new Date().toISOString()
          };
          await addDoc(collection(db, 'clinics', clinic.id, 'expenses'), expensePayload);
          if (difference > 0) {
            dialogs.alert(isEn ? `Lab payment (${difference} EGP - ${orderPayload.paymentMethod}) automatically recorded under "Lab Expenses"` : `تم ترحيل دفعة المعمل (${difference} ج.م - ${orderPayload.paymentMethod}) تلقائياً كمنصرف في الحسابات تحت تصنيف "مصاريف معامل"`, { severity: 'info' });
          } else {
            dialogs.alert(isEn ? `Lab deduction adjustment (${Math.abs(difference)} EGP - ${orderPayload.paymentMethod}) automatically recorded in lab expenses` : `تم تسجيل تسوية بالخصم (${Math.abs(difference)} ج.م - ${orderPayload.paymentMethod}) تلقائياً في حسابات المعامل لتصحيح الخزينة والمصروفات`, { severity: 'info' });
          }
        } catch (expErr) {
          console.error("Failed to automatically record lab expense:", expErr);
        }
      }

      setIsOrderModalOpen(false);
      setSelectedOrder(null);
      resetOrderForm();
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Error saving order: ' : 'خطأ أثناء حفظ الطلب: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (labWorkTypes.length > 0 && (!orderForm.workType || orderForm.workType === 'Zircon cladding' && !labWorkTypes.some(wt => wt.name === 'Zircon cladding'))) {
      setOrderForm(prev => ({ ...prev, workType: labWorkTypes[0].name }));
    }
  }, [labWorkTypes]);

  const resetOrderForm = () => {
    setOrderForm({
      patientId: '',
      laboratoryId: '',
      appointmentId: '',
      workType: labWorkTypes[0]?.name || 'Zircon cladding',
      toothNumbers: '',
      shadeColor: 'A1',
      sentDate: new Date().toISOString().split('T')[0],
      expectedDeliveryDate: '',
      cost: 0,
      paymentStatus: 'unpaid',
      paidAmount: 0,
      paymentMethod: paymentMethodsList[0] || (isEn ? 'Cash' : 'كاش'),
      status: 'sent',
      notes: ''
    });
    setPatientSearchQuery('');
    setIsPatientDropdownOpen(false);
  };

  // Lab Work Type Handlers
  const handleAddOrEditWorkType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workTypeForm.name.trim()) return;

    setLoading(true);
    try {
      if (selectedWorkType) {
        // Edit
        await dentalService.updateLabWorkType(clinic.id, selectedWorkType.id, {
          name: workTypeForm.name.trim()
        }, isDemoMode);
        dialogs.alert(isEn ? 'Work type updated successfully' : 'تم تعديل نوع الإجراء والعمل المطلوب بنجاح', { severity: 'success' });
      } else {
        // Add
        await dentalService.addLabWorkType(clinic.id, {
          clinicId: clinic.id,
          name: workTypeForm.name.trim(),
          createdAt: new Date().toISOString()
        }, isDemoMode);
        dialogs.alert(isEn ? 'Work type added successfully' : 'تم إضافة نوع الإجراء والعمل المطلوب بنجاح', { severity: 'success' });
      }
      setIsWorkTypeModalOpen(false);
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Error saving work type: ' : 'خطأ أثناء حفظ نوع الإجراء: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorkType = async (id: string) => {
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete items. Delete is available for doctors only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    const confirm = await dialogs.confirm(isEn ? 'Are you sure you want to delete this work type? It will be removed from future selection lists.' : 'هل أنت متأكد من حذف نوع الإجراء هذا؟ سيتم إزالته من قائمة الاختيارات للطلبات الجديدة.', { severity: 'danger' });
    if (!confirm) return;

    setLoading(true);
    try {
      await dentalService.deleteLabWorkType(clinic.id, id, isDemoMode);
      dialogs.alert(isEn ? 'Work type deleted successfully' : 'تم حذف نوع الإجراء والعمل المطلوب بنجاح', { severity: 'success' });
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Error deleting work type: ' : 'خطأ أثناء حذف نوع الإجراء: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };


  // Open Edit Order
  const handleEditOrder = (order: LabOrder) => {
    setSelectedOrder(order);
    setOrderForm({
      patientId: order.patientId,
      laboratoryId: order.laboratoryId,
      appointmentId: order.appointmentId || '',
      workType: order.workType,
      toothNumbers: order.toothNumbers || '',
      shadeColor: order.shadeColor || 'A1',
      sentDate: order.sentDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      cost: order.cost,
      paymentStatus: order.paymentStatus,
      paidAmount: order.paidAmount || 0,
      paymentMethod: order.paymentMethod || paymentMethodsList[0] || 'كاش',
      status: order.status,
      notes: order.notes || ''
    });
    const selectedPat = patients.find(p => p.id === order.patientId);
    setPatientSearchQuery(selectedPat ? selectedPat.name : order.patientName || '');
    setIsPatientDropdownOpen(false);
    setIsOrderModalOpen(true);
  };

  // Quick Change status of lab order
  const handleUpdateOrderStatus = async (order: LabOrder, newStatus: LabOrder['status']) => {
    const isReceived = newStatus === 'received' || newStatus === 'installed';
    const actualDeliveryDate = isReceived ? new Date().toISOString().split('T')[0] : undefined;
    
    setLoading(true);
    try {
      await dentalService.updateLabOrder(clinic.id, order.id, { 
        status: newStatus,
        actualDeliveryDate
      }, isDemoMode);
      const statusLabel = newStatus === 'sent' ? (isEn ? 'Sent' : 'تم الإرسال') :
        newStatus === 'received' ? (isEn ? 'Received' : 'تم الاستلام') :
        newStatus === 'installed' ? (isEn ? 'Installed' : 'تم التركيب للمريض') : (isEn ? 'Cancelled' : 'ملغي');
      dialogs.alert(isEn ? `Order status updated to [${statusLabel}] successfully` : `تم تحديث حالة الطلب إلى [${statusLabel}] بنجاح`, { severity: 'success' });
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Failed to update order status: ' : 'فشل في تحديث حالة الطلب: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Handle paid amount change in local state
  const handlePaidAmountChange = (orderId: string, value: string) => {
    setEditingPaidAmounts(prev => ({
      ...prev,
      [orderId]: value
    }));
  };

  // Save the custom paid amount and auto-determine payment status based on cost
  const handleSavePaidAmount = async (order: LabOrder) => {
    const enteredValue = editingPaidAmounts[order.id];
    // If they haven't typed anything yet but pressed save, use current fallback or paid amount
    const rawVal = enteredValue !== undefined ? enteredValue : (order.paidAmount ?? 0);
    const amount = Number(rawVal) || 0;
    const selectedMethod = editingPaymentMethods[order.id] || order.paymentMethod || (isEn ? 'Cash' : 'كاش');
    
    if (amount > order.cost) {
      dialogs.alert(isEn ? `Paid amount (${amount} EGP) cannot exceed total order cost (${order.cost} EGP).` : `المبلغ المدفوع (${amount} ج.م) لا يمكن أن يكون أكبر من التكلفة الكلية للطلب (${order.cost} ج.م). يرجى إعادة إدخال قيمة صحيحة.`, { severity: 'warning' });
      return;
    }

    const oldPaid = Number(order.paidAmount) || 0;
    if (amount < oldPaid) {
      dialogs.alert(isEn ? `Error: Paid amount cannot be reduced (previously paid: ${oldPaid} EGP, attempting to save: ${amount} EGP).` : `خطأ: لا يمكن تعديل المبلغ المدفوع بالنقصان (المدفوع سابقاً: ${oldPaid} ج.م والمطلوب حفظه حالياً: ${amount} ج.م). يجب الإبقاء على المبلغ أو زيادته فقط ليتم ترحيل الزيادة كمصروف في الحسابات.`, { severity: 'warning' });
      return;
    }

    let newStatus: LabOrder['paymentStatus'] = 'unpaid';
    let finalAmount = Math.max(0, amount);

    if (finalAmount >= order.cost) {
      newStatus = 'paid';
      finalAmount = order.cost;
    } else if (finalAmount > 0) {
      newStatus = 'partial';
    } else {
      newStatus = 'unpaid';
      finalAmount = 0;
    }

    setLoading(true);
    try {
      await dentalService.updateLabOrder(clinic.id, order.id, {
        paymentStatus: newStatus,
        paidAmount: finalAmount,
        paymentMethod: selectedMethod
      }, isDemoMode);
      
      // Compute difference to log expense
      const difference = finalAmount - oldPaid;
      if (difference !== 0) {
        try {
          const expensePayload = {
            title: difference > 0 ? (isEn ? `Lab Payment: ${order.laboratoryName}` : `دفعة معمل: ${order.laboratoryName}`) : (isEn ? `Lab Adjustment: ${order.laboratoryName}` : `تعديل بالخصم معمل: ${order.laboratoryName}`),
            amount: difference,
            category: isEn ? 'Lab Expenses' : 'مصاريف معامل',
            date: (() => {
              const d = new Date();
              const pad = (n: number) => String(n).padStart(2, '0');
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            })(),
            notes: difference > 0
              ? (isEn ? `Recorded lab payment for order ${order.workType} - Patient: ${order.patientName}` : `دفعة معمل مسجلة لطلب ${order.workType} - مريض: ${order.patientName} [طريقة الدفع: ${selectedMethod}]. ${activeShift ? 'مخصوم من الوردية المفتوحة' : 'مال خاص'}`).trim()
              : (isEn ? `Deduction adjustment for lab order ${order.workType} - Patient: ${order.patientName}` : `تعديل خفض قيمة الدفعة لطلب معمل لـ ${order.workType} - مريض: ${order.patientName} [طريقة الدفع: ${selectedMethod}]. ${activeShift ? 'مصحح بالوردية المفتوحة' : 'مال خاص'}`).trim(),
            type: activeShift ? 'shift' : 'personal',
            shiftId: activeShift ? activeShift.id : null,
            paymentMethod: selectedMethod,
            createdAt: new Date().toISOString()
          };
          await addDoc(collection(db, 'clinics', clinic.id, 'expenses'), expensePayload);
        } catch (expErr) {
          console.error("Failed to automatically record lab expense:", expErr);
        }
      }

      const newStatusText = newStatus === 'paid' ? (isEn ? 'Fully Paid' : 'مدفوع بالكامل') : newStatus === 'partial' ? (isEn ? 'Partially Paid' : 'مدفوع جزئياً') : (isEn ? 'Unpaid' : 'غير مدفوع');
      dialogs.alert(isEn ? `Payment updated for patient [${order.patientName}] successfully with ${finalAmount} EGP (New status: ${newStatusText})` : `تم تحديث الدفعة للمريض [${order.patientName}] بنجاح بقيمة ${finalAmount} ج.م [طريقة الدفع: ${selectedMethod}] (الحالة الجديدة: ${newStatusText})${difference > 0 ? ` وتم ترحيل ${difference} ج.م إلى المصاريف (${selectedMethod}) تلقائياً` : (difference < 0 ? ` وتم تسجيل تسوية بالخصم بقيمة ${Math.abs(difference)} ج.م تلقائياً` : '')}`, { severity: 'success' });
      
      // Clear editing state for this order
      setEditingPaidAmounts(prev => {
        const copy = { ...prev };
        delete copy[order.id];
        return copy;
      });
      setEditingPaymentMethods(prev => {
        const copy = { ...prev };
        delete copy[order.id];
        return copy;
      });
      
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Failed to save paid amount: ' : 'فشل في حفظ المبلغ المدفوع: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Quick Change payment status of lab order
  const handleUpdateOrderPaymentStatus = async (order: LabOrder, newPaymentStatus: LabOrder['paymentStatus']) => {
    const updatedPaidAmount = newPaymentStatus === 'paid' ? order.cost : (newPaymentStatus === 'unpaid' ? 0 : (order.paidAmount || (order.cost / 2)));
    const oldPaid = Number(order.paidAmount) || 0;
    const selectedMethod = editingPaymentMethods[order.id] || order.paymentMethod || (isEn ? 'Cash' : 'كاش');

    if (updatedPaidAmount < oldPaid) {
      dialogs.alert(isEn ? `Error: Paid amount cannot be reduced automatically by changing status.` : `خطأ: لا يمكن تقليل المبلغ المدفوع بالنقصان بتغيير الحالة تلقائياً (المدفوع حالياً: ${oldPaid} ج.م والمطلوب للحالة الجديدة: ${updatedPaidAmount} ج.م). يرجى تعديل أو زيادة المبلغ يدوياً.`, { severity: 'warning' });
      return;
    }

    setLoading(true);
    try {
      await dentalService.updateLabOrder(clinic.id, order.id, { 
        paymentStatus: newPaymentStatus,
        paidAmount: updatedPaidAmount,
        paymentMethod: selectedMethod
      }, isDemoMode);
      
      // Compute difference to log expense
      const difference = updatedPaidAmount - oldPaid;
      if (difference !== 0) {
        try {
          const expensePayload = {
            title: difference > 0 ? (isEn ? `Lab Payment: ${order.laboratoryName}` : `دفعة معمل: ${order.laboratoryName}`) : (isEn ? `Lab Adjustment: ${order.laboratoryName}` : `تعديل بالخصم معمل: ${order.laboratoryName}`),
            amount: difference,
            category: isEn ? 'Lab Expenses' : 'مصاريف معامل',
            date: (() => {
              const d = new Date();
              const pad = (n: number) => String(n).padStart(2, '0');
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            })(),
            notes: difference > 0
              ? (isEn ? `Lab payment recorded on changing payment status to [${newPaymentStatus}] for ${order.workType} - Patient: ${order.patientName}` : `دفعة معمل مسجلة عند تغيير حالة الدفع إلى [${
                  newPaymentStatus === 'paid' ? 'مدفوع بالكامل' : 'مدفوع جزئياً'
                }] لطلب ${order.workType} - مريض: ${order.patientName} [طريقة الدفع: ${selectedMethod}]. ${activeShift ? 'مخصوم من الوردية المفتوحة' : 'مال خاص'}`).trim()
              : (isEn ? `Deduction adjustment recorded for ${order.workType} - Patient: ${order.patientName}` : `تعديل خفض قيمة الدفعة لطلب معمل عند تغيير حالة الدفع إلى [${
                  newPaymentStatus === 'unpaid' ? 'غير مدفوع' : 'مدفوع جزئياً'
                }] لـ ${order.workType} - مريض: ${order.patientName} [طريقة الدفع: ${selectedMethod}]. ${activeShift ? 'مصحح بالوردية المفتوحة' : 'مال خاص'}`).trim(),
            type: activeShift ? 'shift' : 'personal',
            shiftId: activeShift ? activeShift.id : null,
            paymentMethod: selectedMethod,
            createdAt: new Date().toISOString()
          };
          await addDoc(collection(db, 'clinics', clinic.id, 'expenses'), expensePayload);
        } catch (expErr) {
          console.error("Failed to automatically record lab expense:", expErr);
        }
      }

      // Clear local editing state for this order to stay in sync
      setEditingPaidAmounts(prev => {
        const copy = { ...prev };
        delete copy[order.id];
        return copy;
      });
      setEditingPaymentMethods(prev => {
        const copy = { ...prev };
        delete copy[order.id];
        return copy;
      });

      const paymentStatusLabel = newPaymentStatus === 'paid' ? (isEn ? 'Fully Paid' : 'مدفوع بالكامل') : newPaymentStatus === 'partial' ? (isEn ? 'Partially Paid' : 'مدفوع جزئياً') : (isEn ? 'Unpaid' : 'غير مدفوع');
      dialogs.alert(isEn ? `Payment status updated to [${paymentStatusLabel}] successfully` : `تم تحديث حالة الدفع إلى [${paymentStatusLabel}] بنجاح${difference > 0 ? ` وتم ترحيل ${difference} ج.م إلى المصاريف تلقائياً` : (difference < 0 ? ` وتم تسجيل تسوية بالخصم بقيمة ${Math.abs(difference)} ج.م تلقائياً` : '')}`, { severity: 'success' });
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Failed to update payment status: ' : 'فشل في تحديث حالة الدفع: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Delete Order
  const handleDeleteOrder = async (id: string) => {
    if (isStaff) {
      dialogs.alert(isEn ? 'Sorry, you do not have permission to delete items. Delete is available for doctors only!' : 'عفواً، لا توجد لديك صلاحيات لحذف أي عنصر. الحذف متاح للطبيب فقط!', { severity: 'error' });
      return;
    }
    const orderToDelete = labOrders.find(o => o.id === id);
    const confirm = await dialogs.confirm(isEn ? 'Are you sure you want to permanently delete this lab order?' : 'هل أنت متأكد من حذف طلب المعمل هذا نهائياً؟', { severity: 'danger' });
    if (!confirm) return;

    setLoading(true);
    try {
      await dentalService.deleteLabOrder(clinic.id, id, isDemoMode);

      // If order had a paid amount, reverse it in clinic expenses
      if (orderToDelete && Number(orderToDelete.paidAmount) > 0) {
        try {
          const refundAmt = Number(orderToDelete.paidAmount);
          const expensePayload = {
            title: isEn ? `Lab Payment Cancelled (Order Deleted): ${orderToDelete.laboratoryName}` : `إلغاء دفعة معمل (حذف طلب): ${orderToDelete.laboratoryName}`,
            amount: -refundAmt,
            category: isEn ? 'Lab Expenses' : 'مصاريف معامل',
            date: (() => {
              const d = new Date();
              const pad = (n: number) => String(n).padStart(2, '0');
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            })(),
            notes: isEn ? `Deduction adjustment due to deletion of lab order ${orderToDelete.workType} - Patient: ${orderToDelete.patientName}` : `تسوية بالخصم بسبب حذف طلب معمل ${orderToDelete.workType} - مريض: ${orderToDelete.patientName} [طريقة الدفع: ${orderToDelete.paymentMethod || 'كاش'}]`,
            type: activeShift ? 'shift' : 'personal',
            shiftId: activeShift ? activeShift.id : null,
            paymentMethod: orderToDelete.paymentMethod || paymentMethodsList[0] || (isEn ? 'Cash' : 'كاش'),
            createdAt: new Date().toISOString()
          };
          await addDoc(collection(db, 'clinics', clinic.id, 'expenses'), expensePayload);
        } catch (expErr) {
          console.error("Failed to record expense reversal on order delete:", expErr);
        }
      }

      dialogs.alert(isEn ? 'Lab order deleted and expenses adjusted successfully' : 'تم حذف طلب المعمل وتصحيح المصاريف بنجاح', { severity: 'success' });
      await loadAllData();
    } catch (err: any) {
      dialogs.alert((isEn ? 'Error deleting order: ' : 'خطأ أثناء حذف الطلب: ') + err.toString(), { severity: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Filter Orders
  const filteredOrders = React.useMemo(() => {
    return labOrders.filter(order => {
      // Search text matches patient name or work type or lab name
      const matchesSearch = 
        order.patientName.toLowerCase().includes(orderSearch.toLowerCase()) ||
        order.workType.toLowerCase().includes(orderSearch.toLowerCase()) ||
        order.laboratoryName.toLowerCase().includes(orderSearch.toLowerCase()) ||
        (order.toothNumbers && order.toothNumbers.includes(orderSearch));

      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      const matchesPayment = paymentFilter === 'all' || order.paymentStatus === paymentFilter;
      const matchesLab = labFilter === 'all' || order.laboratoryId === labFilter;

      let matchesTime = true;
      if (timeFilter === 'delayed') {
        matchesTime = isOrderDelayed(order);
      } else if (timeFilter === 'critical') {
        matchesTime = isOrderCritical(order);
      }

      return matchesSearch && matchesStatus && matchesPayment && matchesLab && matchesTime;
    });
  }, [labOrders, orderSearch, statusFilter, paymentFilter, labFilter, timeFilter]);

  // Critical alerts count
  const criticalOrdersCount = React.useMemo(() => {
    return labOrders.filter(o => isOrderCritical(o)).length;
  }, [labOrders]);

  // Delayed orders count
  const delayedOrdersCount = React.useMemo(() => {
    return labOrders.filter(o => isOrderDelayed(o)).length;
  }, [labOrders]);

  return (
    <div className="space-y-6">
      {/* Header section - Compact & Light Theme */}
      <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
            <Beaker className="h-5 w-5 text-slate-600 animate-pulse" />
            <span>{isEn ? 'Dental Laboratory Tracking & Orders' : 'متابعة وإدارة طلبات المعامل'}</span>
          </h2>
        </div>
        
        <div className="shrink-0 flex flex-row gap-2 w-full md:w-auto">
          <button 
            onClick={() => {
              resetOrderForm();
              setIsOrderModalOpen(true);
            }}
            className="flex-1 md:flex-none px-4 py-2.5 bg-slate-800 hover:bg-slate-950 text-white font-black rounded-xl text-xs sm:text-sm shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>{isEn ? 'Create New Lab Order' : 'إنشاء طلب معمل جديد'}</span>
          </button>
          <button 
            onClick={() => {
              setLabForm({ name: '', phone: '', email: '', address: '' });
              setSelectedLab(null);
              setIsLabModalOpen(true);
            }}
            className="flex-1 md:flex-none px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-black rounded-xl text-xs sm:text-sm shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>+ {isEn ? 'Register Partner Lab' : 'تسجيل معمل جديد'}</span>
          </button>
        </div>
      </div>

      {/* Compact Sub-Tabs Bar */}
      <div className="flex flex-wrap gap-2 pb-1.5 border-b border-slate-200">
        <button
          onClick={() => setActiveSubTab('dashboard_orders')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 cursor-pointer border ${
            activeSubTab === 'dashboard_orders'
              ? 'bg-slate-200 text-slate-800 border-slate-300 shadow-xs'
              : 'bg-transparent text-slate-500 border-transparent hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          <span>📋</span>
          <span>{isEn ? 'Lab Orders' : 'طلبات المعامل'}</span>
          <span className={`font-mono text-xs px-2 py-0.5 rounded-md font-bold ${
            activeSubTab === 'dashboard_orders' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'
          }`}>{labOrders.length}</span>
        </button>
        
        <button
          onClick={() => setActiveSubTab('laboratories')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 cursor-pointer border ${
            activeSubTab === 'laboratories'
              ? 'bg-slate-200 text-slate-800 border-slate-300 shadow-xs'
              : 'bg-transparent text-slate-500 border-transparent hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          <span>🏢</span>
          <span>{isEn ? 'Partner Labs Directory' : 'دليل المعامل'}</span>
          <span className={`font-mono text-xs px-2 py-0.5 rounded-md font-bold ${
            activeSubTab === 'laboratories' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'
          }`}>{laboratories.length}</span>
        </button>

        <button
          onClick={() => setActiveSubTab('lab_work_types')}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all flex items-center gap-2 cursor-pointer border ${
            activeSubTab === 'lab_work_types'
              ? 'bg-slate-200 text-slate-800 border-slate-300 shadow-xs'
              : 'bg-transparent text-slate-500 border-transparent hover:bg-slate-100 hover:text-slate-800'
          }`}
        >
          <span>⚙️</span>
          <span>{isEn ? 'Work Types & Procedures' : 'أنواع التركيبات والإجراءات'}</span>
          <span className={`font-mono text-xs px-2 py-0.5 rounded-md font-bold ${
            activeSubTab === 'lab_work_types' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-700'
          }`}>{labWorkTypes.length}</span>
        </button>
      </div>

      {/* Financial Statistics Row - Beautiful, Light & Inline side-by-side */}
      <div className="bg-slate-100 border border-slate-200 p-4 rounded-2xl shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="p-2 bg-slate-200 text-slate-600 rounded-xl border border-slate-300">
            <Coins className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-black text-xs sm:text-sm text-slate-700 flex items-center gap-1.5">
              <span>{isEn ? 'Lab Costs & Dues' : 'تكاليف ومستحقات المعامل'}</span>
              <span>💰</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Details of lab expenses, payments, and remaining balances' : 'تفاصيل المصروفات والمدفوعات والمستحقات المتبقية'}</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-stretch gap-3 w-full lg:w-auto">
          {/* Total Cost */}
          <div className="flex-1 lg:flex-none min-w-[120px] bg-white px-4 py-2 rounded-xl border border-slate-200/60 text-right">
            <p className="text-xs text-slate-400 font-bold mb-0.5">{isEn ? 'Total Lab Costs' : 'إجمالي تكاليف المعامل'}</p>
            <span className="font-sans text-xs sm:text-sm font-black text-slate-700">{totalLabExpenses.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
          </div>

          {/* Paid Amount */}
          <div className="flex-1 lg:flex-none min-w-[120px] bg-white px-4 py-2 rounded-xl border border-slate-200/60 text-right">
            <p className="text-xs text-slate-400 font-bold mb-0.5">{isEn ? 'Paid Amount' : 'المبلغ المسدد'}</p>
            <span className="font-sans text-xs sm:text-sm font-black text-emerald-600">{(totalLabExpenses - labDebt).toLocaleString()} {isEn ? 'EGP' : 'ج.م'}</span>
          </div>

          {/* Remaining (Unpaid) */}
          <div className={`flex-1 lg:flex-none min-w-[160px] px-4 py-2 rounded-xl border text-right transition-all duration-300 bg-white ${
            labDebt > 0 
              ? 'border-rose-200 text-rose-700' 
              : 'border-emerald-200 text-emerald-700'
          }`}>
            <p className="text-xs text-slate-400 font-bold mb-0.5">{isEn ? 'Remaining Balance' : 'متبقي غير مدفوع'}</p>
            <div className="flex items-center justify-between gap-1.5">
              <span className={`font-sans text-xs sm:text-sm font-black ${labDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {labDebt.toLocaleString()} {isEn ? 'EGP' : 'ج.م'}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-black ${
                labDebt > 0 ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'
              }`}>
                {labDebt > 0 ? (isEn ? '⚠️ Overdue Dues' : '⚠️ مستحقات متأخرة') : (isEn ? '✓ Fully Paid' : '✓ خالص تماماً')}
              </span>
            </div>
          </div>
        </div>
      </div>



      {/* SUB TAB: LAB ORDERS LIST */}
      {activeSubTab === 'dashboard_orders' && (
        <div className="space-y-4">
          
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row gap-4 items-center justify-between">
            {/* Search Input & Total Badge next to it */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
              <div className="relative w-full sm:w-80">
                <span className={`absolute inset-y-0 ${isEn ? 'left-3' : 'right-3'} flex items-center pointer-events-none text-slate-400`}>
                  <Search className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder={isEn ? "Search patient, restoration type, lab..." : "ابحث باسم المريض، نوع التركيبة، المعمل..."}
                  className={`w-full ${isEn ? 'pl-10 pr-3' : 'pl-3 pr-10'} py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 focus:bg-white text-slate-800 font-bold`}
                />
              </div>
              <div className="shrink-0 px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center gap-2 h-10">
                <Beaker className="h-4 w-4 text-slate-600" />
                <span className="text-xs text-slate-500 font-bold">{isEn ? 'Total Lab Orders:' : 'إجمالي طلبات المعامل:'}</span>
                <span className="text-xs font-black text-slate-700 font-mono bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">{labOrders.length}</span>
              </div>
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              {/* Lab Filter */}
              <select
                value={labFilter}
                onChange={(e) => setLabFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 focus:bg-white text-slate-700 font-bold cursor-pointer"
              >
                <option value="all">{isEn ? 'All Laboratories' : 'كل المعامل'}</option>
                {laboratories.map(lab => (
                  <option key={lab.id} value={lab.id}>{lab.name}</option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 focus:bg-white text-slate-700 font-bold cursor-pointer"
              >
                <option value="all">{isEn ? 'All Order Statuses' : 'كل حالات الطلب'}</option>
                <option value="sent">{isEn ? 'Sent to Lab' : 'تم الإرسال للمعمل'}</option>
                <option value="received">{isEn ? 'Received at Clinic' : 'تم الاستلام بالعيادة'}</option>
                <option value="installed">{isEn ? 'Installed on Patient' : 'تم التركيب للمريض'}</option>
                <option value="cancelled">{isEn ? 'Cancelled' : 'ملغي'}</option>
              </select>

              {/* Payment Filter */}
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-slate-400 focus:bg-white text-slate-700 font-bold cursor-pointer"
              >
                <option value="all">{isEn ? 'All Payment Statuses' : 'كل حالات الدفع'}</option>
                <option value="unpaid">{isEn ? 'Unpaid' : 'غير مدفوع'}</option>
                <option value="partial">{isEn ? 'Partially Paid' : 'مدفوع جزئياً'}</option>
                <option value="paid">{isEn ? 'Fully Paid' : 'مدفوع بالكامل'}</option>
              </select>

              {/* Critical Alerts Filter Buttons */}
              <button
                onClick={() => setTimeFilter(timeFilter === 'critical' ? 'all' : 'critical')}
                className={`px-3 py-2 border rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  timeFilter === 'critical'
                    ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                    : 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{isEn ? `Critical (${criticalOrdersCount})` : `حرِج (${criticalOrdersCount})`}</span>
              </button>

              <button
                onClick={() => setTimeFilter(timeFilter === 'delayed' ? 'all' : 'delayed')}
                className={`px-3 py-2 border rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  timeFilter === 'delayed'
                    ? 'bg-red-600 border-red-600 text-white shadow-sm'
                    : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>{isEn ? `Delayed (${delayedOrdersCount})` : `متأخر (${delayedOrdersCount})`}</span>
              </button>
            </div>
          </div>

          {/* Critical Orders Banner Alert */}
          {criticalOrdersCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3 text-amber-800">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-xs sm:text-sm">{isEn ? 'Active Critical Delivery Warning!' : 'تنبيه مواعيد حرجة نشطة!'}</h4>
                <p className="text-xs text-amber-700 mt-1">
                  {isEn 
                    ? `There are ${criticalOrdersCount} orders not yet received from the lab with patient appointments in less than 24 hours. Please contact the lab immediately.`
                    : `هناك ${criticalOrdersCount} طلبات لم تصل بعد من المعمل وموعد جلسة المريض المحددة لها أقل من 24 ساعة. يرجى مراجعة المعمل المعني بالسرعة القصوى لتجنب إحراج المريض وتأجيل الجلسة.`
                  }
                </p>
              </div>
            </div>
          )}

          {/* Orders Table/Cards */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className={`w-full ${isEn ? 'text-left' : 'text-right'} border-collapse`}>
                <thead className="bg-slate-50 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-4">{isEn ? 'Patient & Tooth Details' : 'المريض وتفاصيل السن'}</th>
                    <th className="px-5 py-4">{isEn ? 'Laboratory & Work Type' : 'المعمل والتركيبة'}</th>
                    <th className="px-5 py-4">{isEn ? 'Dates & Appointments' : 'التواريخ والمواعيد'}</th>
                    <th className="px-5 py-4">{isEn ? 'Finances & Payment' : 'الحسابات والدفع'}</th>
                    <th className="px-5 py-4 text-center">{isEn ? 'Status & Controls' : 'حالة الطلب والتحكم'}</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-slate-100">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-slate-400 font-bold">
                        {isEn ? 'No lab orders matching the selected filters.' : 'لا توجد طلبات معمل مطابقة للفلاتر المحددة حالياً.'}
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.slice(0, ordersLimit).map((order) => {
                      const critical = isOrderCritical(order);
                      const delayed = isOrderDelayed(order);
                      
                      return (
                        <tr key={order.id} className={`hover:bg-slate-50/50 transition border-b border-slate-100 ${critical ? 'bg-amber-50/25' : delayed ? 'bg-red-50/25' : ''}`}>
                          {/* Col 1: Patient & Tooth Details */}
                          <td className="px-5 py-4">
                            <div className="flex flex-col gap-1">
                              <p className="font-black text-slate-800 text-sm">{order.patientName}</p>
                              {order.patientPhone && <p className="text-xs text-slate-400 font-mono">{order.patientPhone}</p>}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                {order.toothNumbers && (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-bold font-mono border border-slate-200/50">
                                    {isEn ? 'Teeth: ' : 'الأسنان: '}{order.toothNumbers}
                                  </span>
                                )}
                                {order.shadeColor && (
                                  <span className="px-2 py-0.5 bg-indigo-50/70 text-indigo-600 rounded text-xs font-bold font-mono border border-indigo-100/50">
                                    {isEn ? 'Shade: ' : 'اللون: '}{order.shadeColor}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Col 2: Laboratory & Work Type */}
                          <td className="px-5 py-4">
                            <div className="flex flex-col gap-1">
                              <p className="font-bold text-slate-700">{order.laboratoryName}</p>
                              <p className="text-xs text-slate-400">{isEn ? 'By: ' : 'بواسطة: '}{order.doctorName || (isEn ? 'Clinic Doctor' : 'طبيب العيادة')}</p>
                              <div className="mt-1">
                                <span className="inline-block px-2.5 py-0.5 bg-slate-100 text-slate-800 rounded-lg text-xs font-bold border border-slate-200/80">
                                  {order.workType}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Col 3: Dates & Alerts */}
                          <td className="px-5 py-4">
                            <div className="flex flex-col gap-1">
                              <p className="text-xs text-slate-500 font-medium">{isEn ? 'Sent: ' : 'إرسال: '}{order.sentDate}</p>
                              <p className={`text-xs font-black ${critical ? 'text-amber-600' : delayed ? 'text-red-600 animate-pulse' : 'text-slate-700'}`}>
                                {isEn ? 'Expected: ' : 'استلام متوقع: '}{order.expectedDeliveryDate}
                              </p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {critical && (
                                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded text-xs font-black border border-amber-200 flex items-center gap-0.5">
                                    <AlertTriangle className="h-2 w-2" /> {isEn ? 'Critical Date!' : 'موعد حرِج!'}
                                  </span>
                                )}
                                {delayed && !critical && (
                                  <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-xs font-black border border-red-200 animate-pulse flex items-center gap-0.5">
                                    <Clock className="h-2 w-2" /> {isEn ? 'Delayed' : 'متأخر'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Col 4: Cost & Payment */}
                          <td className="px-5 py-4">
                            <div className="flex flex-col gap-1.5 min-w-[210px] max-w-[250px]">
                              {/* Headers */}
                              <div className="grid grid-cols-3 gap-1 text-center text-xs text-slate-400 font-extrabold pb-1 border-b border-slate-100">
                                <div>{isEn ? 'Cost' : 'التكلفة'}</div>
                                <div>{isEn ? 'Paid' : 'المدفوع'}</div>
                                <div>{isEn ? 'Remaining' : 'المتبقي'}</div>
                              </div>
                              
                              {/* Values and Input */}
                              <div className="grid grid-cols-3 gap-1 items-center text-center">
                                {/* Total Cost */}
                                <div className="font-mono font-black text-slate-800 text-xs">
                                  {order.cost.toLocaleString()}
                                </div>
                                
                                {/* Paid (Editable Input) */}
                                <div className="flex items-center justify-center">
                                  <input
                                    type="number"
                                    min="0"
                                    max={order.cost}
                                    inputMode="decimal"
                                    value={editingPaidAmounts[order.id] !== undefined ? editingPaidAmounts[order.id] : (order.paidAmount ?? 0)}
                                    onChange={(e) => handlePaidAmountChange(order.id, e.target.value.replace(/[^\d.]/g, ''))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSavePaidAmount(order);
                                      }
                                    }}
                                    className="w-16 px-1 py-0.5 border border-slate-200 rounded-lg text-center text-xs font-mono font-black text-slate-700 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white"
                                    placeholder="0"
                                  />
                                </div>
                                
                                {/* Remaining (Calculated) */}
                                <div className={`font-mono font-black text-xs ${
                                  (() => {
                                    const currentPaid = editingPaidAmounts[order.id] !== undefined 
                                      ? Number(editingPaidAmounts[order.id]) || 0 
                                      : (order.paidAmount ?? 0);
                                    const remaining = Math.max(0, order.cost - currentPaid);
                                    return remaining > 0 ? 'text-rose-600' : 'text-emerald-600';
                                  })()
                                }`}>
                                  {(() => {
                                    const currentPaid = editingPaidAmounts[order.id] !== undefined 
                                      ? Number(editingPaidAmounts[order.id]) || 0 
                                      : (order.paidAmount ?? 0);
                                    return Math.max(0, order.cost - currentPaid).toLocaleString();
                                  })()}
                                </div>
                              </div>

                              {/* Payment Method Selector */}
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">{isEn ? 'Payment:' : 'طريقة الدفع:'}</span>
                                <select
                                  value={editingPaymentMethods[order.id] !== undefined ? editingPaymentMethods[order.id] : (order.paymentMethod || (isEn ? 'Cash' : 'كاش'))}
                                  onChange={(e) => setEditingPaymentMethods(prev => ({ ...prev, [order.id]: e.target.value }))}
                                  className="w-full text-[11px] px-1.5 py-0.5 border border-slate-200 rounded-md bg-slate-50 font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                  title={isEn ? 'Payment method' : 'طريقة تسديد مصروف المعمل'}
                                >
                                  {paymentMethodsList.map(method => (
                                    <option key={method} value={method}>{method}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Save Button (shows when paid amount OR payment method is modified/unsaved) */}
                              {(editingPaidAmounts[order.id] !== undefined || editingPaymentMethods[order.id] !== undefined) && (
                                <div className="flex items-center justify-center gap-1 mt-0.5">
                                  <button
                                    onClick={() => handleSavePaidAmount(order)}
                                    className="w-full py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-lg text-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-1 shadow-2xs"
                                  >
                                    <Check className="h-3 w-3" />
                                    <span>{isEn ? 'Save Payment' : 'حفظ المنصرف'}</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingPaidAmounts(prev => {
                                        const copy = { ...prev };
                                        delete copy[order.id];
                                        return copy;
                                      });
                                      setEditingPaymentMethods(prev => {
                                        const copy = { ...prev };
                                        delete copy[order.id];
                                        return copy;
                                      });
                                    }}
                                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg text-xs font-bold transition cursor-pointer"
                                  >
                                    {isEn ? 'Cancel' : 'إلغاء'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Col 5: Order Status & Control Actions */}
                          <td className="px-5 py-4 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <select
                                value={order.status}
                                onChange={(e) => handleUpdateOrderStatus(order, e.target.value as any)}
                                className={`px-2.5 py-0.5 rounded-full text-xs font-black text-center cursor-pointer border ${
                                  order.status === 'sent'
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : order.status === 'received'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : order.status === 'installed'
                                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                                    : 'bg-slate-100 text-slate-500 border-slate-300'
                                }`}
                              >
                                <option value="sent">{isEn ? 'Sent' : 'تم الإرسال'}</option>
                                <option value="received">{isEn ? 'Received' : 'تم الاستلام'}</option>
                                <option value="installed">{isEn ? 'Installed' : 'تم التركيب'}</option>
                                <option value="cancelled">{isEn ? 'Cancelled' : 'ملغي'}</option>
                              </select>

                              <div className="flex items-center gap-1 border border-slate-100 p-0.5 rounded-lg bg-slate-50/50">
                                <button
                                  onClick={() => handleEditOrder(order)}
                                  className="p-1 text-slate-500 hover:text-slate-800 hover:bg-white rounded transition cursor-pointer"
                                  title={isEn ? 'Edit' : 'تعديل'}
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </button>
                                {!isStaff && (
                                  <>
                                    <div className="w-[1px] h-3 bg-slate-200" />
                                    <button
                                      onClick={() => handleDeleteOrder(order.id)}
                                      className="p-1 text-slate-500 hover:text-red-600 hover:bg-white rounded transition cursor-pointer"
                                      title={isEn ? 'Delete' : 'حذف'}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Load More Pagination Footer */}
            {filteredOrders.length > ordersLimit && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-slate-50 border-t border-slate-200">
                <span className="text-xs font-bold text-slate-500">
                  {isEn ? (
                    <>Showing <span className="font-mono font-black text-indigo-600">{Math.min(ordersLimit, filteredOrders.length)}</span> of <span className="font-mono font-black text-slate-800">{filteredOrders.length}</span> orders</>
                  ) : (
                    <>يتم عرض <span className="font-mono font-black text-indigo-600">{Math.min(ordersLimit, filteredOrders.length)}</span> من أصل <span className="font-mono font-black text-slate-800">{filteredOrders.length}</span> طلب</>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOrdersLimit(prev => prev + 5)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>{isEn ? 'Show 5 more (+5)' : 'عرض 5 طلبات إضافية (+5)'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrdersLimit(filteredOrders.length)}
                    className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs transition border border-slate-200 cursor-pointer"
                  >
                    {isEn ? `Show All (${filteredOrders.length})` : `عرض الكل (${filteredOrders.length})`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB TAB: PARTNER LABORATORIES */}
      {activeSubTab === 'laboratories' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-sm sm:text-base">{isEn ? 'Dental Laboratories Directory' : 'دليل معامل تركيبات وتجميل الأسنان'}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Manage contracted dental lab partners' : 'إدارة بيانات ومحاضر التواصل مع المختبرات الطبية المتعاقدة'}</p>
              </div>
              <button
                onClick={() => {
                  setLabForm({ name: '', phone: '', email: '', address: '' });
                  setSelectedLab(null);
                  setIsLabModalOpen(true);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{isEn ? 'Add New Lab' : 'إضافة معمل جديد'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {laboratories.length === 0 ? (
                <div className="col-span-full text-center py-10 text-slate-400 font-bold">
                  {isEn ? 'No partner dental laboratories registered yet.' : 'لم يتم تسجيل أي معامل تجميل/تركيبات أسنان شريكة للعيادة حتى الآن.'}
                </div>
              ) : (
                laboratories.map((lab) => {
                  // Count orders for this laboratory
                  const labOrdersCount = labOrders.filter(o => o.laboratoryId === lab.id).length;
                  const activeOrdersCount = labOrders.filter(o => o.laboratoryId === lab.id && o.status === 'sent').length;

                  return (
                    <div key={lab.id} className="p-5 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-slate-50 transition flex flex-col justify-between shadow-xs">
                      <div className="space-y-3">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            <span className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                              <Beaker className="h-4.5 w-4.5" />
                            </span>
                            <h4 className="font-bold text-slate-800 text-sm sm:text-base">{lab.name}</h4>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEditLab(lab)}
                              className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                              title={isEn ? 'Edit' : 'تعديل'}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </button>
                            {!isStaff && (
                              <button
                                onClick={() => handleDeleteLab(lab.id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition cursor-pointer"
                                title={isEn ? 'Delete' : 'حذف'}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1.5 text-xs text-slate-500 font-medium">
                          <div className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            <span>{lab.phone}</span>
                          </div>
                          {lab.email && (
                            <div className="flex items-center gap-2">
                              <Mail className="h-3.5 w-3.5 text-slate-400" />
                              <span>{lab.email}</span>
                            </div>
                          )}
                          {lab.address && (
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-slate-400" />
                              <span>{lab.address}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-200/80 flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-500">{isEn ? `Total Orders: ${labOrdersCount}` : `إجمالي الطلبات: ${labOrdersCount}`}</span>
                        <span className={`px-2 py-0.5 rounded-full font-black ${
                          activeOrdersCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {isEn ? `In Progress: ${activeOrdersCount}` : `تحت التصنيع حالياً: ${activeOrdersCount}`}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB TAB: LAB WORK TYPES / PROCEDURES */}
      {activeSubTab === 'lab_work_types' && (
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-sm sm:text-base">{isEn ? 'Manage Lab Work Types & Procedures' : 'إدارة أنواع الإجراءات والعمل المطلوب'}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{isEn ? 'Add, edit, or delete dental procedure categories' : 'إضافة وتعديل وحذف أنواع التركيبات وتجهيزات المعمل المتوفرة'}</p>
              </div>
              <button
                onClick={() => {
                  setWorkTypeForm({ name: '' });
                  setSelectedWorkType(null);
                  setIsWorkTypeModalOpen(true);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{isEn ? 'Add Work Type' : 'إضافة نوع عمل جديد'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {labWorkTypes.length === 0 ? (
                <div className="col-span-full text-center py-10 text-slate-400 font-bold">
                  {isEn ? 'No lab work types registered yet.' : 'لم يتم تسجيل أي أنواع عمل مطلوب للمعمل حتى الآن.'}
                </div>
              ) : (
                labWorkTypes.map((wt) => {
                  return (
                    <div key={wt.id} className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-slate-50 transition flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-2">
                        <span className="p-2 bg-indigo-100 text-indigo-600 rounded-xl font-bold text-xs">
                          {wt.name.charAt(0)}
                        </span>
                        <h4 className="font-bold text-slate-800 text-sm">{wt.name}</h4>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setSelectedWorkType(wt);
                            setWorkTypeForm({ name: wt.name });
                            setIsWorkTypeModalOpen(true);
                          }}
                          className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                          title={isEn ? 'Edit' : 'تعديل'}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        {!isStaff && (
                          <button
                            onClick={() => handleDeleteWorkType(wt.id)}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                            title={isEn ? 'Delete' : 'حذف'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT PARTNER LABORATORY */}
      <AnimatePresence>
        {isLabModalOpen && (
          <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[999] ${isEn ? 'dir-ltr' : 'dir-rtl'}`} dir={isEn ? 'ltr' : 'rtl'}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-black text-slate-800 text-base sm:text-lg flex items-center gap-2">
                  <Beaker className="h-5 w-5 text-indigo-600" />
                  <span>{selectedLab ? (isEn ? 'Edit Partner Laboratory' : 'تعديل بيانات المعمل الشريك') : (isEn ? 'Register New Dental Lab' : 'تسجيل معمل تركيبات أسنان جديد')}</span>
                </h3>
                <button
                  onClick={() => setIsLabModalOpen(false)}
                  className="p-1.5 hover:bg-slate-200 rounded-full transition cursor-pointer"
                >
                  <X className="h-5 w-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleLabSubmit} className="p-6 space-y-4 text-xs sm:text-sm">
                <div>
                  <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Lab Name' : 'اسم المعمل'} <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={labForm.name}
                    onChange={(e) => setLabForm({...labForm, name: e.target.value})}
                    placeholder={isEn ? "e.g., Delta Digital Dental Lab" : "مثال: معمل الدلتا الرقمي للأسنان"}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1.5">
                    {isEn ? 'Contact Phone' : 'رقم هاتف التواصل'} <span className="text-red-500">*</span>
                    <span className="text-xs text-slate-400 font-normal mx-1">{isEn ? '(11 digits starting with 01)' : '(11 رقم يبدأ بـ 01)'}</span>
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={11}
                    inputMode="numeric"
                    value={labForm.phone}
                    onChange={(e) => setLabForm({...labForm, phone: formatEgyptianPhoneInput(e.target.value)})}
                    placeholder="01012345678"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold font-mono text-left"
                    dir="ltr"
                  />
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsLabModalOpen(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition cursor-pointer"
                  >
                    {isEn ? 'Cancel' : 'إلغاء'}
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition cursor-pointer"
                  >
                    {selectedLab ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? 'Register Lab' : 'تسجيل المعمل الجديد')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: ADD / EDIT LAB WORK TYPE */}
      <AnimatePresence>
        {isWorkTypeModalOpen && (
          <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[999] ${isEn ? 'dir-ltr' : 'dir-rtl'}`} dir={isEn ? 'ltr' : 'rtl'}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-black text-slate-800 text-base sm:text-lg flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-indigo-600" />
                  <span>{selectedWorkType ? (isEn ? 'Edit Work Type' : 'تعديل نوع الإجراء والعمل المطلوب') : (isEn ? 'Add New Lab Work Type' : 'إضافة نوع إجراء وعمل معملي جديد')}</span>
                </h3>
                <button
                  onClick={() => setIsWorkTypeModalOpen(false)}
                  className="p-1.5 hover:bg-slate-200 rounded-full transition cursor-pointer"
                >
                  <X className="h-5 w-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleAddOrEditWorkType} className="p-6 space-y-4 text-xs sm:text-sm">
                <div>
                  <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Work Type Name' : 'اسم الإجراء / العمل المطلوب'} <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={workTypeForm.name}
                    onChange={(e) => setWorkTypeForm({ name: e.target.value })}
                    placeholder={isEn ? "e.g., Zirconia Crown, Removable Denture..." : "مثال: تركيبات زيركون، تركيبة متحركة..."}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold"
                  />
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsWorkTypeModalOpen(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold cursor-pointer transition text-xs sm:text-sm"
                  >
                    {isEn ? 'Cancel' : 'إلغاء'}
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow cursor-pointer transition text-xs sm:text-sm"
                  >
                    {selectedWorkType ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? 'Add' : 'إضافة')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: ADD / EDIT LAB ORDER */}
      <AnimatePresence>
        {isOrderModalOpen && (
          <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-[999] ${isEn ? 'dir-ltr' : 'dir-rtl'}`} dir={isEn ? 'ltr' : 'rtl'}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="font-black text-slate-800 text-base sm:text-lg flex items-center gap-2">
                  <Beaker className="h-5 w-5 text-indigo-600" />
                  <span>{selectedOrder ? (isEn ? 'Edit Lab Order Details' : 'تعديل تفاصيل طلب المعمل') : (isEn ? 'Create New Lab Order' : 'إنشاء طلب تصنيع معملي جديد')}</span>
                </h3>
                <button
                  onClick={() => setIsOrderModalOpen(false)}
                  className="p-1.5 hover:bg-slate-200 rounded-full transition cursor-pointer"
                >
                  <X className="h-5 w-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleOrderSubmit} className="p-6 space-y-4 text-xs sm:text-sm max-h-[80vh] overflow-y-auto">
                {(() => {
                  const activeFormPatient = orderForm.patientId ? patients.find(p => p.id === orderForm.patientId) : null;
                  return (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Patient ID Selection - Searchable */}
                      <div className="relative">
                        <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Patient' : 'مريض الحالة'} <span className="text-red-500">*</span></label>
                        
                        {orderForm.patientId ? (
                          <div className="flex items-center justify-between px-3.5 py-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-900 font-bold">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-indigo-500" />
                              <span>{activeFormPatient?.name || orderForm.patientId}</span>
                              {activeFormPatient?.phone && (
                                <span className="text-xs text-slate-500 font-normal">({activeFormPatient.phone})</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setOrderForm({ ...orderForm, patientId: '', appointmentId: '' });
                                setPatientSearchQuery('');
                              }}
                              className="p-1 hover:bg-indigo-100 rounded-full text-indigo-600 transition cursor-pointer"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                      <>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder={isEn ? "Search by patient name or phone (3+ chars)..." : "ابحث باسم المريض أو هاتفه (3 أحرف على الأقل)..."}
                            value={patientSearchQuery}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPatientSearchQuery(val);
                              setIsPatientDropdownOpen(true);
                            }}
                            onFocus={() => setIsPatientDropdownOpen(true)}
                            className={`w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold ${isEn ? 'pr-10' : 'pl-10'}`}
                          />
                          <div className={`absolute inset-y-0 ${isEn ? 'right-3' : 'left-3'} flex items-center pointer-events-none text-slate-400`}>
                            <Search className="h-4 w-4" />
                          </div>
                        </div>

                        {isPatientDropdownOpen && patientSearchQuery.trim().length >= 3 && (
                          <>
                            <div 
                              className="fixed inset-0 z-40" 
                              onClick={() => setIsPatientDropdownOpen(false)} 
                            />
                            <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100">
                              {patients.filter(p => 
                                p.name.toLowerCase().includes(patientSearchQuery.toLowerCase()) ||
                                p.phone.includes(patientSearchQuery)
                              ).length > 0 ? (
                                patients.filter(p => 
                                  p.name.toLowerCase().includes(patientSearchQuery.toLowerCase()) ||
                                  p.phone.includes(patientSearchQuery)
                                ).map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      setOrderForm({ ...orderForm, patientId: p.id, appointmentId: '' });
                                      setPatientSearchQuery(p.name);
                                      setIsPatientDropdownOpen(false);
                                    }}
                                    className={`w-full ${isEn ? 'text-left' : 'text-right'} px-4 py-2.5 hover:bg-slate-50 font-semibold text-slate-800 flex justify-between items-center transition cursor-pointer`}
                                  >
                                    <span>{p.name}</span>
                                    <span className="text-xs text-slate-400 font-normal">{p.phone}</span>
                                  </button>
                                ))
                              ) : (
                                <div className="px-4 py-3 text-slate-400 text-xs text-center">{isEn ? 'No matching patients found' : 'لا توجد نتائج تطابق بحثك'}</div>
                              )}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {/* Laboratory Selection */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Destination Lab' : 'المعمل المُرسل إليه'} <span className="text-red-500">*</span></label>
                    <select
                      required
                      value={orderForm.laboratoryId}
                      onChange={(e) => setOrderForm({...orderForm, laboratoryId: e.target.value})}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold cursor-pointer"
                    >
                      <option value="">{isEn ? '-- Select Dental Lab --' : '-- اختر معمل التركيبات --'}</option>
                      {laboratories.map(lab => (
                        <option key={lab.id} value={lab.id}>{lab.name}</option>
                      ))}
                    </select>
                    {laboratories.length === 0 && (
                      <p className="text-red-500 text-xs mt-1">{isEn ? 'Please add partner labs first in the Laboratories tab' : 'يجب إضافة معامل أولاً في قسم "دليل المعامل"'}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Link with upcoming scheduled appointments for the selected patient */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Link to Upcoming Appointment (Optional)' : 'ربط الطلب بموعد قادم للمريض (اختياري)'}</label>
                    <select
                      value={orderForm.appointmentId}
                      onChange={(e) => {
                        const appt = appointments.find(a => a.id === e.target.value);
                        setOrderForm({
                          ...orderForm, 
                          appointmentId: e.target.value,
                          expectedDeliveryDate: appt 
                            ? new Date(new Date(appt.date).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0] // auto set expected delivery to 1 day before appointment!
                            : orderForm.expectedDeliveryDate
                        });
                      }}
                      disabled={!orderForm.patientId}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 cursor-pointer disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">{isEn ? '-- No Linked Appointment --' : '-- لا يوجد موعد مرتبط --'}</option>
                      {appointments
                        .filter(a => {
                          if (a.patientId !== orderForm.patientId || a.status === 'Cancelled') {
                            return false;
                          }
                          if (a.date) {
                            const apptDate = new Date(a.date);
                            apptDate.setHours(0,0,0,0);
                            const todayVal = new Date();
                            todayVal.setHours(0,0,0,0);
                            return apptDate.getTime() > todayVal.getTime();
                          }
                          return false;
                        })
                        .map(a => (
                          <option key={a.id} value={a.id}>{a.date} - {a.procedure}</option>
                        ))}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">{isEn ? 'Linking ensures expected delivery is set 24 hours prior to patient appointment.' : 'يضمن ربط الطلب وصول التركيبة تلقائياً قبل موعد الحجز بـ 24 ساعة كحد أقصى.'}</p>
                  </div>

                  {/* Work Type */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Work Type & Procedure' : 'نوع الإجراء والعمل المطلوب'} <span className="text-red-500">*</span></label>
                    <select
                      required
                      value={orderForm.workType}
                      onChange={(e) => setOrderForm({...orderForm, workType: e.target.value})}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold cursor-pointer"
                    >
                      {labWorkTypes.map((wt) => (
                        <option key={wt.id} value={wt.name}>{wt.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Tooth Numbers */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Tooth Numbers' : 'أرقام الأسنان المطلوبة'}</label>
                    <input
                      type="text"
                      value={orderForm.toothNumbers}
                      onChange={(e) => setOrderForm({...orderForm, toothNumbers: e.target.value})}
                      placeholder={isEn ? "e.g., 14, 15" : "أرقام الأسنان (مثال: 14, 15)"}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                    />
                  </div>

                  {/* Shade Color */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Shade Color' : 'درجة اللون المطلوبة (Shade)'}</label>
                    <input
                      type="text"
                      value={orderForm.shadeColor}
                      onChange={(e) => setOrderForm({...orderForm, shadeColor: e.target.value})}
                      placeholder={isEn ? "e.g., A1, A2, B1..." : "مثال: A1, A2, B1..."}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                    />
                  </div>

                  {/* Cost */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Lab Cost (EGP)' : 'تكلفة المختبر (ج.م)'} <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      required
                      min="0"
                      inputMode="decimal"
                      value={orderForm.cost || ''}
                      onChange={(e) => setOrderForm({...orderForm, cost: Number(e.target.value.replace(/[^\d.]/g, '')) || 0})}
                      placeholder={isEn ? "Lab cost" : "تكلفة المعمل"}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Sent Date */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Sent Date' : 'تاريخ الإرسال للمعمل'} <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      required
                      value={orderForm.sentDate}
                      onChange={(e) => setOrderForm({...orderForm, sentDate: e.target.value})}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold"
                    />
                  </div>

                  {/* Expected Delivery Date */}
                  <div>
                    <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Expected Delivery Date' : 'تاريخ الاستلام الفعلي المتوقع'} <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      required
                      value={orderForm.expectedDeliveryDate}
                      onChange={(e) => setOrderForm({...orderForm, expectedDeliveryDate: e.target.value})}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold"
                    />
                  </div>
                </div>

                {/* Payment & Financials Section */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/90 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-slate-800 font-extrabold text-xs sm:text-sm">
                      💳 {isEn ? 'Lab Payment & Expense Logging' : 'تسديد دفعة للمعمل وتسجيل المنصرف'}
                    </label>
                    <span className="text-[11px] text-slate-500 font-medium bg-white px-2 py-0.5 rounded-lg border border-slate-200">
                      {activeShift ? (isEn ? 'Deducted from active shift' : 'تخصم تلقائياً من حساب الوردية الحالية') : (isEn ? 'Personal/No Shift' : 'مال خاص / بدون وردية')}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Payment Status */}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">{isEn ? 'Payment Status' : 'حالة الدفع للمعمل'}</label>
                      <select
                        value={orderForm.paymentStatus}
                        onChange={(e) => {
                          const status = e.target.value as 'paid' | 'unpaid' | 'partial';
                          let newPaid = orderForm.paidAmount;
                          if (status === 'paid') newPaid = orderForm.cost || 0;
                          if (status === 'unpaid') newPaid = 0;
                          setOrderForm({ ...orderForm, paymentStatus: status, paidAmount: newPaid });
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                        <option value="unpaid">{isEn ? 'Unpaid (Credit)' : 'غير مدفوع (آجل)'}</option>
                        <option value="partial">{isEn ? 'Partially Paid' : 'مدفوع جزئياً'}</option>
                        <option value="paid">{isEn ? 'Fully Paid' : 'مدفوع بالكامل'}</option>
                      </select>
                    </div>

                    {/* Paid Amount */}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">{isEn ? 'Paid Amount (EGP)' : 'المبلغ المدفوع (ج.م)'}</label>
                      <input
                        type="number"
                        min="0"
                        max={orderForm.cost}
                        value={orderForm.paymentStatus === 'unpaid' ? 0 : orderForm.paidAmount}
                        disabled={orderForm.paymentStatus === 'unpaid'}
                        onChange={(e) => {
                          const val = Number(e.target.value.replace(/[^\d.]/g, '')) || 0;
                          let status: 'paid' | 'unpaid' | 'partial' = 'partial';
                          if (val >= (orderForm.cost || 0) && (orderForm.cost || 0) > 0) status = 'paid';
                          if (val <= 0) status = 'unpaid';
                          setOrderForm({ ...orderForm, paidAmount: val, paymentStatus: status });
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                        placeholder="0"
                      />
                    </div>

                    {/* Payment Method */}
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">{isEn ? 'Payment Method' : 'طريقة الدفع (الخصم من)'}</label>
                      <select
                        value={orderForm.paymentMethod}
                        onChange={(e) => setOrderForm({ ...orderForm, paymentMethod: e.target.value })}
                        disabled={orderForm.paymentStatus === 'unpaid' || orderForm.paidAmount <= 0}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {paymentMethodsList.map((m: string) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1.5">{isEn ? 'Notes & Instructions for Lab' : 'ملاحظات وتنبيهات المعمل الخاصة بالحالة'}</label>
                  <textarea
                    rows={3}
                    value={orderForm.notes}
                    onChange={(e) => setOrderForm({...orderForm, notes: e.target.value})}
                    placeholder={isEn ? "e.g., Lingual margin, extra glaze polish..." : "اكتب أي ملاحظات للتركيبة، مثلاً: حافة معدنية مخفية، تلميع زائد..."}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800"
                  />
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setIsOrderModalOpen(false)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition cursor-pointer"
                  >
                    {isEn ? 'Cancel' : 'إلغاء'}
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition cursor-pointer"
                  >
                    {selectedOrder ? (isEn ? 'Save Changes' : 'حفظ التعديلات') : (isEn ? 'Submit Lab Order' : 'إرسال طلب المعمل')}
                  </button>
                </div>
                    </>
                  );
                })()}
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
