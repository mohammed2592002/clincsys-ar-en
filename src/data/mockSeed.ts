import { Clinic, Patient, Appointment, InventoryItem, Invoice } from '../types/dental';

export const INITIAL_CLINIC: Clinic = {
  id: 'PDS-441',
  name: 'Pearl Dental Studio',
  ownerEmail: 'sarah.ahmed@pearldental.com',
  isActive: true,
  plan: 'Pro Plan',
  clinicCode: 'clinics/PDS-441',
  phone: '+966 50 123 4567',
  address: 'الرياض، طريق الملك فهد',
  createdAt: '2025-01-15',
  renewDays: 14
};

export const MOCK_PATIENTS: Patient[] = [];

export const MOCK_APPOINTMENTS: Appointment[] = [];

export const MOCK_INVENTORY: InventoryItem[] = [];

export const MOCK_INVOICES: Invoice[] = [];
