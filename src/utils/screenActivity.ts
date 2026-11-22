// Request ownership belongs to the visible screen. Broadcast polling is separate.
let activeScreen = '';
let generation = 0;
export function requestScope() {
  const owner = generation;
  return () => owner === generation && isPageVisible();
}
export function setActiveRequestScreen(screen: string) { if (activeScreen !== screen) generation++; activeScreen = screen; }
export function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
export function screenOwnsPath(path: string, screen = activeScreen) {
  if (!screen) return true; // Non-UI callers and isolated integration tests.
  const parts = path.split('/');
  const table = parts[2] === 'patients' && parts.length >= 5 ? parts[4] : parts[2];
  if (!table) return true;
  const owners: Record<string, string[]> = {
    appointments: ['calendar', 'financials', 'medical_files'],
    records: ['medical_files'], xrays: ['medical_files'], teeth: ['medical_files'],
    prescriptions: ['prescriptions', 'medical_files'],
    lab_orders: ['patients', 'laboratory', 'financials'],
    laboratories: ['laboratory', 'settings'], lab_work_types: ['laboratory', 'settings'],
    custom_medications: ['prescriptions'], custom_categories: ['prescriptions'],
    inventory: ['settings'], billing: ['financials'], closings: ['financials'],
    expenses: ['financials'], shifts: ['patients', 'calendar', 'medical_files', 'laboratory', 'financials'],
  };
  return !owners[table] || owners[table].includes(screen);
}
export function canRunScreenRequest(path = '') { return isPageVisible() && (!path || screenOwnsPath(path)); }

export function getActiveRequestScreen() { return activeScreen; }
