import { create } from 'zustand';
import { ClinicUser, UserRole } from '../types/dental';

interface AuthState {
  user: ClinicUser | null;
  clinicId: string;
  clinicName: string;
  isAuthenticated: boolean;
  isDemoMode: boolean;
  isLoading: boolean;
  login: (email: string, role: UserRole, clinicId?: string) => void;
  logout: () => void;
  setDemoMode: (val: boolean) => void;
  setClinicId: (id: string) => void;
}

const DEFAULT_CLINIC_ID = 'PDS-441';

export const useAuthStore = create<AuthState>((set) => ({
  user: {
    uid: 'demo-doc-1',
    email: 'sarah.ahmed@pearldental.com',
    displayName: 'د. سارة أحمد (Dr. Sarah Ahmed)',
    role: 'Administrator',
    clinicId: DEFAULT_CLINIC_ID
  },
  clinicId: DEFAULT_CLINIC_ID,
  clinicName: 'Pearl Dental Studio',
  isAuthenticated: true,
  isDemoMode: false, // strictly real mode without mock data
  isLoading: false,

  login: (email, role, clinicId = DEFAULT_CLINIC_ID) => {
    const namePart = email.split('@')[0];
    const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
    set({
      user: {
        uid: 'user-' + Date.now(),
        email,
        displayName: `Dr. ${displayName}`,
        role,
        clinicId
      },
      clinicId,
      isAuthenticated: true
    });
  },

  logout: () => {
    set({ user: null, isAuthenticated: false });
  },

  setDemoMode: (val) => set({ isDemoMode: val }),
  setClinicId: (id) => set({ clinicId: id })
}));
