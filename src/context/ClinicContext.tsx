import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Patient,
  Doctor,
  Appointment,
  MedicalRecord,
  DrugItem,
  Invoice,
  LabTest,
  Language
} from '../types/clinic';
import {
  INITIAL_DOCTORS,
  INITIAL_PATIENTS,
  INITIAL_APPOINTMENTS,
  INITIAL_MEDICAL_RECORDS,
  INITIAL_DRUGS,
  INITIAL_INVOICES,
  INITIAL_LABS
} from '../data/mockData';

export type ActiveTab = 'dashboard' | 'patients' | 'appointments' | 'consultation' | 'pharmacy' | 'billing' | 'labs';

interface ClinicContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  
  // Data lists
  patients: Patient[];
  doctors: Doctor[];
  appointments: Appointment[];
  medicalRecords: MedicalRecord[];
  drugs: DrugItem[];
  invoices: Invoice[];
  labs: LabTest[];

  // Selected entities for detail views / active consultation
  selectedPatientId: string | null;
  setSelectedPatientId: (id: string | null) => void;
  activeAppointmentId: string | null;
  setActiveAppointmentId: (id: string | null) => void;

  // Actions
  addPatient: (patient: Omit<Patient, 'id' | 'fileNumber' | 'registeredDate'>) => Patient;
  updatePatient: (id: string, updated: Partial<Patient>) => void;
  deletePatient: (id: string) => void;

  addAppointment: (apt: Omit<Appointment, 'id' | 'queueNumber'>) => Appointment;
  updateAppointmentStatus: (id: string, status: Appointment['status']) => void;

  addMedicalRecord: (rec: Omit<MedicalRecord, 'id'>) => MedicalRecord;
  
  addDrug: (drug: Omit<DrugItem, 'id'>) => DrugItem;
  updateDrugStock: (id: string, deltaQuantity: number) => void;

  addInvoice: (inv: Omit<Invoice, 'id' | 'invoiceNumber'>) => Invoice;
  updateInvoiceStatus: (id: string, status: Invoice['status']) => void;

  addLabTest: (lab: Omit<LabTest, 'id'>) => LabTest;
  updateLabResults: (id: string, results: NonNullable<LabTest['results']>, status: LabTest['status']) => void;

  // AI Modal
  isAiModalOpen: boolean;
  setIsAiModalOpen: (open: boolean) => void;
  aiPromptContext: any;
  setAiPromptContext: (ctx: any) => void;
  openAiAssistantWithContext: (ctx: any) => void;

  // Print Modals
  prescriptionToPrint: MedicalRecord | null;
  setPrescriptionToPrint: (rec: MedicalRecord | null) => void;
  invoiceToPrint: Invoice | null;
  setInvoiceToPrint: (inv: Invoice | null) => void;
}

const ClinicContext = createContext<ClinicContextType | undefined>(undefined);

export const ClinicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('ar');
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');

  const [patients, setPatients] = useState<Patient[]>(() => {
    const saved = localStorage.getItem('clinic_patients');
    return saved ? JSON.parse(saved) : INITIAL_PATIENTS;
  });

  const [doctors] = useState<Doctor[]>(INITIAL_DOCTORS);

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem('clinic_appointments');
    return saved ? JSON.parse(saved) : INITIAL_APPOINTMENTS;
  });

  const [medicalRecords, setMedicalRecords] = useState<MedicalRecord[]>(() => {
    const saved = localStorage.getItem('clinic_medical_records');
    return saved ? JSON.parse(saved) : INITIAL_MEDICAL_RECORDS;
  });

  const [drugs, setDrugs] = useState<DrugItem[]>(() => {
    const saved = localStorage.getItem('clinic_drugs');
    return saved ? JSON.parse(saved) : INITIAL_DRUGS;
  });

  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    const saved = localStorage.getItem('clinic_invoices');
    return saved ? JSON.parse(saved) : INITIAL_INVOICES;
  });

  const [labs, setLabs] = useState<LabTest[]>(() => {
    const saved = localStorage.getItem('clinic_labs');
    return saved ? JSON.parse(saved) : INITIAL_LABS;
  });

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>('PAT-1001');
  const [activeAppointmentId, setActiveAppointmentId] = useState<string | null>('APT-501');

  // AI state
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiPromptContext, setAiPromptContext] = useState<any>(null);

  // Print Modals
  const [prescriptionToPrint, setPrescriptionToPrint] = useState<MedicalRecord | null>(null);
  const [invoiceToPrint, setInvoiceToPrint] = useState<Invoice | null>(null);

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem('clinic_patients', JSON.stringify(patients));
  }, [patients]);

  useEffect(() => {
    localStorage.setItem('clinic_appointments', JSON.stringify(appointments));
  }, [appointments]);

  useEffect(() => {
    localStorage.setItem('clinic_medical_records', JSON.stringify(medicalRecords));
  }, [medicalRecords]);

  useEffect(() => {
    localStorage.setItem('clinic_drugs', JSON.stringify(drugs));
  }, [drugs]);

  useEffect(() => {
    localStorage.setItem('clinic_invoices', JSON.stringify(invoices));
  }, [invoices]);

  useEffect(() => {
    localStorage.setItem('clinic_labs', JSON.stringify(labs));
  }, [labs]);

  // Actions
  const addPatient = (patientData: Omit<Patient, 'id' | 'fileNumber' | 'registeredDate'>): Patient => {
    const newId = `PAT-${Math.floor(1000 + Math.random() * 9000)}`;
    const fileNumber = `CL-2026-${String(patients.length + 1).padStart(3, '0')}`;
    const newPatient: Patient = {
      ...patientData,
      id: newId,
      fileNumber,
      registeredDate: new Date().toISOString().split('T')[0],
      avatarUrl: patientData.avatarUrl || `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`
    };
    setPatients((prev) => [newPatient, ...prev]);
    return newPatient;
  };

  const updatePatient = (id: string, updated: Partial<Patient>) => {
    setPatients((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updated } : p))
    );
  };

  const deletePatient = (id: string) => {
    setPatients((prev) => prev.filter((p) => p.id !== id));
  };

  const addAppointment = (aptData: Omit<Appointment, 'id' | 'queueNumber'>): Appointment => {
    const newId = `APT-${Math.floor(500 + Math.random() * 500)}`;
    const todayApts = appointments.filter((a) => a.date === aptData.date);
    const queueNumber = todayApts.length + 1;

    const newApt: Appointment = {
      ...aptData,
      id: newId,
      queueNumber
    };
    setAppointments((prev) => [newApt, ...prev]);
    return newApt;
  };

  const updateAppointmentStatus = (id: string, status: Appointment['status']) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );
  };

  const addMedicalRecord = (recData: Omit<MedicalRecord, 'id'>): MedicalRecord => {
    const newId = `REC-${Math.floor(900 + Math.random() * 900)}`;
    const newRec: MedicalRecord = {
      ...recData,
      id: newId
    };
    setMedicalRecords((prev) => [newRec, ...prev]);

    // Update appointment status to Completed if associated
    if (recData.appointmentId) {
      updateAppointmentStatus(recData.appointmentId, 'Completed');
    }

    return newRec;
  };

  const addDrug = (drugData: Omit<DrugItem, 'id'>): DrugItem => {
    const newId = `DRG-${String(drugs.length + 1).padStart(2, '0')}`;
    const newDrug: DrugItem = { ...drugData, id: newId };
    setDrugs((prev) => [...prev, newDrug]);
    return newDrug;
  };

  const updateDrugStock = (id: string, deltaQuantity: number) => {
    setDrugs((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, stockQuantity: Math.max(0, d.stockQuantity + deltaQuantity) } : d
      )
    );
  };

  const addInvoice = (invData: Omit<Invoice, 'id' | 'invoiceNumber'>): Invoice => {
    const count = invoices.length + 1;
    const invoiceNumber = `INV-2026-${String(count).padStart(3, '0')}`;
    const newId = `INV-${Math.floor(100 + Math.random() * 900)}`;
    const newInv: Invoice = {
      ...invData,
      id: newId,
      invoiceNumber
    };
    setInvoices((prev) => [newInv, ...prev]);
    return newInv;
  };

  const updateInvoiceStatus = (id: string, status: Invoice['status']) => {
    setInvoices((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status } : i))
    );
  };

  const addLabTest = (labData: Omit<LabTest, 'id'>): LabTest => {
    const newId = `LAB-${Math.floor(800 + Math.random() * 200)}`;
    const newLab: LabTest = { ...labData, id: newId };
    setLabs((prev) => [newLab, ...prev]);
    return newLab;
  };

  const updateLabResults = (id: string, results: NonNullable<LabTest['results']>, status: LabTest['status']) => {
    setLabs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, results, status } : l))
    );
  };

  const openAiAssistantWithContext = (ctx: any) => {
    setAiPromptContext(ctx);
    setIsAiModalOpen(true);
  };

  return (
    <ClinicContext.Provider
      value={{
        language,
        setLanguage,
        activeTab,
        setActiveTab,
        patients,
        doctors,
        appointments,
        medicalRecords,
        drugs,
        invoices,
        labs,
        selectedPatientId,
        setSelectedPatientId,
        activeAppointmentId,
        setActiveAppointmentId,
        addPatient,
        updatePatient,
        deletePatient,
        addAppointment,
        updateAppointmentStatus,
        addMedicalRecord,
        addDrug,
        updateDrugStock,
        addInvoice,
        updateInvoiceStatus,
        addLabTest,
        updateLabResults,
        isAiModalOpen,
        setIsAiModalOpen,
        aiPromptContext,
        setAiPromptContext,
        openAiAssistantWithContext,
        prescriptionToPrint,
        setPrescriptionToPrint,
        invoiceToPrint,
        setInvoiceToPrint
      }}
    >
      <div dir={language === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen font-sans bg-slate-50 text-slate-800 antialiased selection:bg-teal-500 selection:text-white">
        {children}
      </div>
    </ClinicContext.Provider>
  );
};

export const useClinic = () => {
  const context = useContext(ClinicContext);
  if (!context) {
    throw new Error('useClinic must be used within a ClinicProvider');
  }
  return context;
};
