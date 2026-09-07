import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy,
  limit,
  db,
  cleanDbData
} from '../dbClient';
import { safeStorage } from '../utils/storage';
import { Patient, Appointment, InventoryItem, Invoice, DailyClosing, Laboratory, LabOrder, LabWorkType } from '../types/dental';
import { MOCK_PATIENTS, MOCK_APPOINTMENTS, MOCK_INVENTORY, MOCK_INVOICES } from '../data/mockSeed';

const MOCK_LABORATORIES: Laboratory[] = [];

const MOCK_LAB_ORDERS: LabOrder[] = [];

// Helper to get local data fallback
const getLocal = <T>(key: string, initial: T[]): T[] => {
  try {
    const saved = safeStorage.getItem(`dentsaas_${key}`);
    if (!saved) {
      safeStorage.setItem(`dentsaas_${key}`, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      // Clean out any legacy seed/mock records if present
      const cleaned = parsed.filter((item: any) => {
        if (!item || !item.id) return true;
        const idStr = String(item.id);
        if (idStr === 'pat-1' || idStr === 'pat-2' || idStr === 'pat-3' || idStr === 'pat-4' || idStr === 'pat-5' || idStr === 'order-1' || idStr === 'order-2' || idStr === 'lab-1' || idStr === 'lab-2' || idStr === 'apt-1' || idStr === 'apt-2' || idStr === 'apt-3' || idStr === 'apt-4' || idStr === 'inv-1' || idStr === 'inv-2' || idStr === 'inv-3' || idStr === 'inv-4' || idStr.startsWith('inv-num-10')) {
          return false;
        }
        return true;
      });
      if (cleaned.length !== parsed.length) {
        safeStorage.setItem(`dentsaas_${key}`, JSON.stringify(cleaned));
      }
      return cleaned;
    }
    return parsed;
  } catch (e) {
    return initial;
  }
};

const setLocal = <T>(key: string, data: T[]) => {
  try {
    safeStorage.setItem(`dentsaas_${key}`, JSON.stringify(data));
  } catch (e) {
    console.error('Error saving local storage', e);
  }
};

export const dentalService = {
  // --- PATIENTS ---
  async getPatients(clinicId: string, isDemo: boolean): Promise<Patient[]> {
    if (isDemo) return getLocal(`patients_${clinicId}`, MOCK_PATIENTS);
    try {
      const ref = collection(db, `clinics/${clinicId}/patients`);
      const q = query(ref, orderBy('createdAt', 'desc'), limit(150));
      const snap = await getDocs(q);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Patient));
    } catch (err) {
      console.warn('Firestore fallback to local for patients:', err);
      return getLocal(`patients_${clinicId}`, MOCK_PATIENTS);
    }
  },

  async addPatient(clinicId: string, patient: Omit<Patient, 'id'>, isDemo: boolean): Promise<Patient> {
    const newPat: Patient = { ...patient, id: `pat-${Date.now()}` };
    if (isDemo) {
      const current = getLocal(`patients_${clinicId}`, MOCK_PATIENTS);
      const updated = [newPat, ...current];
      setLocal(`patients_${clinicId}`, updated);
      return newPat;
    }
    try {
      const ref = collection(db, `clinics/${clinicId}/patients`);
      const docRef = await addDoc(ref, cleanDbData(patient));
      return { ...patient, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addPatient:", err);
      const current = getLocal(`patients_${clinicId}`, MOCK_PATIENTS);
      setLocal(`patients_${clinicId}`, [newPat, ...current]);
      return newPat;
    }
  },

  async deletePatient(clinicId: string, patientId: string, isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<Patient>(`patients_${clinicId}`, MOCK_PATIENTS);
      setLocal(`patients_${clinicId}`, current.filter(p => p.id !== patientId));
      return;
    }
    try {
      await deleteDoc(doc(db, `clinics/${clinicId}/patients`, patientId));
    } catch (err) {
      const current = getLocal<Patient>(`patients_${clinicId}`, MOCK_PATIENTS);
      setLocal(`patients_${clinicId}`, current.filter(p => p.id !== patientId));
    }
  },

  // --- APPOINTMENTS ---
  async getAppointments(clinicId: string, isDemo: boolean): Promise<Appointment[]> {
    if (isDemo) return getLocal(`appointments_${clinicId}`, MOCK_APPOINTMENTS);
    try {
      const ref = collection(db, `clinics/${clinicId}/appointments`);
      const snap = await getDocs(ref);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Appointment));
    } catch (err) {
      return getLocal(`appointments_${clinicId}`, MOCK_APPOINTMENTS);
    }
  },

  async addAppointment(clinicId: string, apt: Omit<Appointment, 'id'>, isDemo: boolean): Promise<Appointment> {
    const newApt: Appointment = { ...apt, id: `apt-${Date.now()}` };
    if (isDemo) {
      const current = getLocal(`appointments_${clinicId}`, MOCK_APPOINTMENTS);
      setLocal(`appointments_${clinicId}`, [newApt, ...current]);
      return newApt;
    }
    try {
      const ref = collection(db, `clinics/${clinicId}/appointments`);
      const docRef = await addDoc(ref, cleanDbData(apt));
      return { ...apt, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addAppointment:", err);
      const current = getLocal(`appointments_${clinicId}`, MOCK_APPOINTMENTS);
      setLocal(`appointments_${clinicId}`, [newApt, ...current]);
      return newApt;
    }
  },

  async updateAppointmentStatus(clinicId: string, id: string, status: Appointment['status'], isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<Appointment>(`appointments_${clinicId}`, MOCK_APPOINTMENTS);
      const updated = current.map(a => a.id === id ? { ...a, status } : a);
      setLocal(`appointments_${clinicId}`, updated);
      return;
    }
    try {
      await updateDoc(doc(db, `clinics/${clinicId}/appointments`, id), { status });
    } catch (err) {
      const current = getLocal<Appointment>(`appointments_${clinicId}`, MOCK_APPOINTMENTS);
      setLocal(`appointments_${clinicId}`, current.map(a => a.id === id ? { ...a, status } : a));
    }
  },

  // --- INVENTORY ---
  async getInventory(clinicId: string, isDemo: boolean): Promise<InventoryItem[]> {
    if (isDemo) return getLocal(`inventory_${clinicId}`, MOCK_INVENTORY);
    try {
      const ref = collection(db, `clinics/${clinicId}/inventory`);
      const q = query(ref, limit(150));
      const snap = await getDocs(q);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
    } catch (err) {
      return getLocal(`inventory_${clinicId}`, MOCK_INVENTORY);
    }
  },

  async addInventoryItem(clinicId: string, item: Omit<InventoryItem, 'id'>, isDemo: boolean): Promise<InventoryItem> {
    const newItem: InventoryItem = { ...item, id: `inv-${Date.now()}` };
    if (isDemo) {
      const current = getLocal(`inventory_${clinicId}`, MOCK_INVENTORY);
      setLocal(`inventory_${clinicId}`, [...current, newItem]);
      return newItem;
    }
    try {
      const ref = collection(db, `clinics/${clinicId}/inventory`);
      const docRef = await addDoc(ref, cleanDbData(item));
      return { ...item, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addInventoryItem:", err);
      const current = getLocal(`inventory_${clinicId}`, MOCK_INVENTORY);
      setLocal(`inventory_${clinicId}`, [...current, newItem]);
      return newItem;
    }
  },

  async updateInventoryQuantity(clinicId: string, id: string, quantity: number, isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<InventoryItem>(`inventory_${clinicId}`, MOCK_INVENTORY);
      setLocal(`inventory_${clinicId}`, current.map(i => i.id === id ? { ...i, quantity } : i));
      return;
    }
    try {
      await updateDoc(doc(db, `clinics/${clinicId}/inventory`, id), { quantity });
    } catch (err) {
      const current = getLocal<InventoryItem>(`inventory_${clinicId}`, MOCK_INVENTORY);
      setLocal(`inventory_${clinicId}`, current.map(i => i.id === id ? { ...i, quantity } : i));
    }
  },

  // --- BILLING / INVOICES ---
  async getInvoices(clinicId: string, isDemo: boolean): Promise<Invoice[]> {
    if (isDemo) return getLocal(`billing_${clinicId}`, MOCK_INVOICES);
    try {
      const ref = collection(db, `clinics/${clinicId}/billing`);
      const snap = await getDocs(ref);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
    } catch (err) {
      return getLocal(`billing_${clinicId}`, MOCK_INVOICES);
    }
  },

  async addInvoice(clinicId: string, inv: Omit<Invoice, 'id'>, isDemo: boolean): Promise<Invoice> {
    const newInv: Invoice = { ...inv, id: `inv-num-${Date.now().toString().slice(-4)}` };
    if (isDemo) {
      const current = getLocal(`billing_${clinicId}`, MOCK_INVOICES);
      setLocal(`billing_${clinicId}`, [newInv, ...current]);
      return newInv;
    }
    try {
      const ref = collection(db, `clinics/${clinicId}/billing`);
      const docRef = await addDoc(ref, cleanDbData(inv));
      return { ...inv, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addInvoice:", err);
      const current = getLocal(`billing_${clinicId}`, MOCK_INVOICES);
      setLocal(`billing_${clinicId}`, [newInv, ...current]);
      return newInv;
    }
  },

  async updateInvoice(clinicId: string, id: string, updatedFields: Partial<Invoice>, isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<Invoice>(`billing_${clinicId}`, MOCK_INVOICES);
      const updated = current.map(inv => inv.id === id ? { ...inv, ...updatedFields } : inv);
      setLocal(`billing_${clinicId}`, updated);
      return;
    }
    try {
      await updateDoc(doc(db, `clinics/${clinicId}/billing`, id), cleanDbData(updatedFields));
    } catch (err) {
      console.error("Firestore error in updateInvoice:", err);
      const current = getLocal<Invoice>(`billing_${clinicId}`, MOCK_INVOICES);
      const updated = current.map(inv => inv.id === id ? { ...inv, ...updatedFields } : inv);
      setLocal(`billing_${clinicId}`, updated);
    }
  },

  async getDailyClosings(clinicId: string, isDemo: boolean): Promise<DailyClosing[]> {
    if (isDemo) return getLocal(`closings_${clinicId}`, []);
    try {
      const ref = collection(db, `clinics/${clinicId}/closings`);
      const q = query(ref, orderBy('closedAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyClosing));
    } catch (err) {
      return getLocal(`closings_${clinicId}`, []);
    }
  },

  async addDailyClosing(clinicId: string, closing: Omit<DailyClosing, 'id'>, isDemo: boolean): Promise<DailyClosing> {
    const newClosing: DailyClosing = { ...closing, id: `close-${Date.now()}` };
    if (isDemo) {
      const current = getLocal<DailyClosing>(`closings_${clinicId}`, []);
      setLocal(`closings_${clinicId}`, [newClosing, ...current]);
      return newClosing;
    }
    try {
      const ref = collection(db, `clinics/${clinicId}/closings`);
      const docRef = await addDoc(ref, cleanDbData(closing));
      return { ...closing, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addDailyClosing:", err);
      const current = getLocal<DailyClosing>(`closings_${clinicId}`, []);
      setLocal(`closings_${clinicId}`, [newClosing, ...current]);
      return newClosing;
    }
  },

  // --- LABORATORIES ---
  async getLaboratories(clinicId: string, isDemo: boolean): Promise<Laboratory[]> {
    if (isDemo) return getLocal(`laboratories_${clinicId}`, MOCK_LABORATORIES);
    try {
      const ref = collection(db, `clinics/${clinicId}/laboratories`);
      const snap = await getDocs(ref);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Laboratory));
    } catch (err) {
      return getLocal(`laboratories_${clinicId}`, MOCK_LABORATORIES);
    }
  },

  async addLaboratory(clinicId: string, lab: Omit<Laboratory, 'id'>, isDemo: boolean): Promise<Laboratory> {
    const newLab: Laboratory = { ...lab, id: `lab-${Date.now()}` };
    if (isDemo) {
      const current = getLocal(`laboratories_${clinicId}`, MOCK_LABORATORIES);
      const updated = [newLab, ...current];
      setLocal(`laboratories_${clinicId}`, updated);
      return newLab;
    }
    try {
      const ref = collection(db, `clinics/${clinicId}/laboratories`);
      const docRef = await addDoc(ref, cleanDbData(lab));
      return { ...lab, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addLaboratory:", err);
      const current = getLocal(`laboratories_${clinicId}`, MOCK_LABORATORIES);
      const updated = [newLab, ...current];
      setLocal(`laboratories_${clinicId}`, updated);
      return newLab;
    }
  },

  async updateLaboratory(clinicId: string, id: string, updatedFields: Partial<Laboratory>, isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<Laboratory>(`laboratories_${clinicId}`, MOCK_LABORATORIES);
      const updated = current.map(lab => lab.id === id ? { ...lab, ...updatedFields } : lab);
      setLocal(`laboratories_${clinicId}`, updated);
      return;
    }
    try {
      await updateDoc(doc(db, `clinics/${clinicId}/laboratories`, id), cleanDbData(updatedFields));
    } catch (err) {
      console.error("Firestore error in updateLaboratory:", err);
      const current = getLocal<Laboratory>(`laboratories_${clinicId}`, MOCK_LABORATORIES);
      const updated = current.map(lab => lab.id === id ? { ...lab, ...updatedFields } : lab);
      setLocal(`laboratories_${clinicId}`, updated);
    }
  },

  async deleteLaboratory(clinicId: string, id: string, isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<Laboratory>(`laboratories_${clinicId}`, MOCK_LABORATORIES);
      setLocal(`laboratories_${clinicId}`, current.filter(lab => lab.id !== id));
      return;
    }
    try {
      await deleteDoc(doc(db, `clinics/${clinicId}/laboratories`, id));
    } catch (err) {
      const current = getLocal<Laboratory>(`laboratories_${clinicId}`, MOCK_LABORATORIES);
      setLocal(`laboratories_${clinicId}`, current.filter(lab => lab.id !== id));
    }
  },

  // --- LAB ORDERS ---
  async getLabOrders(clinicId: string, isDemo: boolean): Promise<LabOrder[]> {
    if (isDemo) return getLocal(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
    try {
      const ref = collection(db, `clinics/${clinicId}/lab_orders`);
      const q = query(ref, orderBy('createdAt', 'desc'), limit(150));
      const snap = await getDocs(q);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LabOrder));
    } catch (err) {
      return getLocal(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
    }
  },

  async addLabOrder(clinicId: string, order: Omit<LabOrder, 'id'>, isDemo: boolean): Promise<LabOrder> {
    const newOrder: LabOrder = { ...order, id: `order-${Date.now()}` };
    if (isDemo) {
      const current = getLocal(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
      const updated = [newOrder, ...current];
      setLocal(`lab_orders_${clinicId}`, updated);
      return newOrder;
    }
    try {
      const ref = collection(db, `clinics/${clinicId}/lab_orders`);
      const docRef = await addDoc(ref, cleanDbData(order));
      return { ...order, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addLabOrder:", err);
      const current = getLocal(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
      const updated = [newOrder, ...current];
      setLocal(`lab_orders_${clinicId}`, updated);
      return newOrder;
    }
  },

  async updateLabOrder(clinicId: string, id: string, updatedFields: Partial<LabOrder>, isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<LabOrder>(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
      const updated = current.map(order => order.id === id ? { ...order, ...updatedFields } : order);
      setLocal(`lab_orders_${clinicId}`, updated);
      return;
    }
    try {
      await updateDoc(doc(db, `clinics/${clinicId}/lab_orders`, id), cleanDbData(updatedFields));
    } catch (err) {
      console.error("Firestore error in updateLabOrder:", err);
      const current = getLocal<LabOrder>(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
      const updated = current.map(order => order.id === id ? { ...order, ...updatedFields } : order);
      setLocal(`lab_orders_${clinicId}`, updated);
    }
  },

  async deleteLabOrder(clinicId: string, id: string, isDemo: boolean): Promise<void> {
    if (isDemo) {
      const current = getLocal<LabOrder>(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
      setLocal(`lab_orders_${clinicId}`, current.filter(order => order.id !== id));
      return;
    }
    try {
      await deleteDoc(doc(db, `clinics/${clinicId}/lab_orders`, id));
    } catch (err) {
      const current = getLocal<LabOrder>(`lab_orders_${clinicId}`, MOCK_LAB_ORDERS);
      setLocal(`lab_orders_${clinicId}`, current.filter(order => order.id !== id));
    }
  },

  // --- LAB WORK TYPES ---
  async getLabWorkTypes(clinicId: string, isDemo: boolean): Promise<LabWorkType[]> {
    const defaultNames = [
      'Zircon cladding',
      'Porcelain cladding',
      'Cosmetic veneer',
      'Lumineer',
      'Dentures',
      'Orthodontic treatment',
      'Dental bridge',
      'Implant abutment'
    ];
    const defaultList: LabWorkType[] = defaultNames.map((name, index) => ({
      id: `default-wt-${index}`,
      clinicId,
      name,
      createdAt: new Date().toISOString()
    }));

    if (isDemo) return getLocal(`lab_work_types_${clinicId}`, defaultList);

    try {
      const ref = collection(db, `clinics/${clinicId}/lab_work_types`);
      const snap = await getDocs(ref);

      if (snap.empty) {
        return defaultList;
      }

      const allItems = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LabWorkType));
      const uniqueItems: LabWorkType[] = [];
      const seenNames = new Set<string>();

      for (const item of allItems) {
        const cleanKey = (item.name || '').trim().toLowerCase();
        if (!cleanKey) continue;
        if (!seenNames.has(cleanKey)) {
          seenNames.add(cleanKey);
          uniqueItems.push(item);
        } else {
          // Delete duplicate document from Firestore in background
          deleteDoc(doc(db, `clinics/${clinicId}/lab_work_types`, item.id)).catch(e => {
            console.error("Error cleaning up duplicate lab work type:", e);
          });
        }
      }

      return uniqueItems.length > 0 ? uniqueItems : defaultList;
    } catch (err) {
      console.error("Error getting lab work types:", err);
      return getLocal(`lab_work_types_${clinicId}`, defaultList);
    }
  },

  async addLabWorkType(clinicId: string, workType: Omit<LabWorkType, 'id'>, isDemo: boolean): Promise<LabWorkType> {
    const newWt: LabWorkType = { ...workType, id: `wt-${Date.now()}` };
    const defaultNames = [
      'Zircon cladding',
      'Porcelain cladding',
      'Cosmetic veneer',
      'Lumineer',
      'Dentures',
      'Orthodontic treatment',
      'Dental bridge',
      'Implant abutment'
    ];
    const defaultList: LabWorkType[] = defaultNames.map((name, index) => ({
      id: `default-wt-${index}`,
      clinicId,
      name,
      createdAt: new Date().toISOString()
    }));

    if (isDemo) {
      const current = getLocal<LabWorkType>(`lab_work_types_${clinicId}`, defaultList);
      const updated = [...current, newWt];
      setLocal(`lab_work_types_${clinicId}`, updated);
      return newWt;
    }

    try {
      const ref = collection(db, `clinics/${clinicId}/lab_work_types`);
      const snap = await getDocs(ref);
      if (snap.empty) {
        // Seed initial defaults so they aren't lost when adding a custom item
        for (const defName of defaultNames) {
          await addDoc(ref, {
            clinicId,
            name: defName,
            createdAt: new Date().toISOString()
          });
        }
      }
      const docRef = await addDoc(ref, cleanDbData(workType));
      return { ...workType, id: docRef.id };
    } catch (err) {
      console.error("Firestore error in addLabWorkType:", err);
      const current = getLocal<LabWorkType>(`lab_work_types_${clinicId}`, defaultList);
      const updated = [...current, newWt];
      setLocal(`lab_work_types_${clinicId}`, updated);
      return newWt;
    }
  },

  async updateLabWorkType(clinicId: string, id: string, updatedFields: Partial<LabWorkType>, isDemo: boolean): Promise<void> {
    const defaultNames = [
      'Zircon cladding',
      'Porcelain cladding',
      'Cosmetic veneer',
      'Lumineer',
      'Dentures',
      'Orthodontic treatment',
      'Dental bridge',
      'Implant abutment'
    ];
    const defaultList: LabWorkType[] = defaultNames.map((name, index) => ({
      id: `default-wt-${index}`,
      clinicId,
      name,
      createdAt: new Date().toISOString()
    }));

    if (isDemo) {
      const current = getLocal<LabWorkType>(`lab_work_types_${clinicId}`, defaultList);
      const updated = current.map(wt => wt.id === id ? { ...wt, ...updatedFields } : wt);
      setLocal(`lab_work_types_${clinicId}`, updated);
      return;
    }

    try {
      const ref = collection(db, `clinics/${clinicId}/lab_work_types`);
      if (id.startsWith('default-wt-')) {
        const itemIdx = parseInt(id.replace('default-wt-', ''), 10);
        const snap = await getDocs(ref);
        if (snap.empty) {
          for (let i = 0; i < defaultNames.length; i++) {
            const nameToSave = i === itemIdx ? (updatedFields.name || defaultNames[i]) : defaultNames[i];
            await addDoc(ref, {
              clinicId,
              name: nameToSave,
              createdAt: new Date().toISOString()
            });
          }
          return;
        } else {
          await addDoc(ref, cleanDbData({
            clinicId,
            name: updatedFields.name || 'Custom Procedure',
            createdAt: new Date().toISOString()
          }));
          return;
        }
      }

      await updateDoc(doc(db, `clinics/${clinicId}/lab_work_types`, id), cleanDbData(updatedFields));
    } catch (err) {
      console.error("Firestore error in updateLabWorkType:", err);
      const current = getLocal<LabWorkType>(`lab_work_types_${clinicId}`, defaultList);
      const updated = current.map(wt => wt.id === id ? { ...wt, ...updatedFields } : wt);
      setLocal(`lab_work_types_${clinicId}`, updated);
    }
  },

  async deleteLabWorkType(clinicId: string, id: string, isDemo: boolean): Promise<void> {
    const defaultNames = [
      'Zircon cladding',
      'Porcelain cladding',
      'Cosmetic veneer',
      'Lumineer',
      'Dentures',
      'Orthodontic treatment',
      'Dental bridge',
      'Implant abutment'
    ];
    const defaultList: LabWorkType[] = defaultNames.map((name, index) => ({
      id: `default-wt-${index}`,
      clinicId,
      name,
      createdAt: new Date().toISOString()
    }));

    if (isDemo) {
      const current = getLocal<LabWorkType>(`lab_work_types_${clinicId}`, defaultList);
      setLocal(`lab_work_types_${clinicId}`, current.filter(wt => wt.id !== id));
      return;
    }

    try {
      const ref = collection(db, `clinics/${clinicId}/lab_work_types`);
      if (id.startsWith('default-wt-')) {
        const itemIdx = parseInt(id.replace('default-wt-', ''), 10);
        const snap = await getDocs(ref);
        if (snap.empty) {
          for (let i = 0; i < defaultNames.length; i++) {
            if (i === itemIdx) continue;
            await addDoc(ref, {
              clinicId,
              name: defaultNames[i],
              createdAt: new Date().toISOString()
            });
          }
          return;
        }
      } else {
        await deleteDoc(doc(db, `clinics/${clinicId}/lab_work_types`, id));
      }
    } catch (err) {
      console.error("Firestore error in deleteLabWorkType:", err);
      const current = getLocal<LabWorkType>(`lab_work_types_${clinicId}`, defaultList);
      setLocal(`lab_work_types_${clinicId}`, current.filter(wt => wt.id !== id));
    }
  }
};

