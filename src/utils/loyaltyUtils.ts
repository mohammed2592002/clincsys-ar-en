import { doc, getDocSmart, setDoc, cleanDbData } from '../dbClient';
import { Clinic } from '../types';

/**
 * Calculates how many points a patient earns for a given payment amount based on clinic settings.
 * Example: 100 EGP = 1 point. If paid 1000 EGP => 10 points.
 */
export function calculateEarnedPoints(
  paymentAmount: number,
  clinic: Partial<Clinic> | null
): number {
  if (!clinic || clinic.loyaltyProgramEnabled === false) return 0;
  
  const egpThreshold = clinic.loyaltyEarnEgpThreshold !== undefined && Number(clinic.loyaltyEarnEgpThreshold) > 0
    ? Number(clinic.loyaltyEarnEgpThreshold)
    : 100;
  const pointsPerThreshold = clinic.loyaltyEarnPoints !== undefined && !isNaN(Number(clinic.loyaltyEarnPoints))
    ? Number(clinic.loyaltyEarnPoints)
    : 20;
  
  if (paymentAmount <= 0 || egpThreshold <= 0 || pointsPerThreshold <= 0) return 0;

  const batches = Math.floor(paymentAmount / egpThreshold);
  return batches * pointsPerThreshold;
}

/**
 * Calculates redemption details for a patient's current points.
 * Example: 1000 points = 250 EGP discount.
 */
export function calculatePointsRedemption(
  currentPoints: number,
  clinic: Partial<Clinic> | null
): {
  isEligible: boolean;
  pointsToDeduct: number;
  totalDiscountAmount: number;
  remainingPoints: number;
} {
  if (!clinic || clinic.loyaltyProgramEnabled === false) {
    return { isEligible: false, pointsToDeduct: 0, totalDiscountAmount: 0, remainingPoints: currentPoints };
  }

  const redeemThreshold = clinic.loyaltyRedeemPointsThreshold !== undefined && Number(clinic.loyaltyRedeemPointsThreshold) > 0
    ? Number(clinic.loyaltyRedeemPointsThreshold)
    : 1000;
  const discountEgp = clinic.loyaltyRedeemDiscountEgp !== undefined && Number(clinic.loyaltyRedeemDiscountEgp) > 0
    ? Number(clinic.loyaltyRedeemDiscountEgp)
    : 250;

  const minPoints = clinic.loyaltyMinRedeemPoints !== undefined && clinic.loyaltyMinRedeemPoints !== null && Number(clinic.loyaltyMinRedeemPoints) > 0
    ? Number(clinic.loyaltyMinRedeemPoints)
    : 0;

  if (currentPoints <= 0 || (minPoints > 0 && currentPoints < minPoints) || redeemThreshold <= 0 || discountEgp <= 0) {
    return { isEligible: false, pointsToDeduct: 0, totalDiscountAmount: 0, remainingPoints: currentPoints };
  }

  const egpPerPoint = discountEgp / redeemThreshold;
  const pointsToDeduct = currentPoints;
  const totalDiscountAmount = Math.floor(currentPoints * egpPerPoint * 100) / 100;
  const remainingPoints = 0;

  return {
    isEligible: true,
    pointsToDeduct,
    totalDiscountAmount,
    remainingPoints
  };
}

/**
 * Adds points to a patient's total loyalty points in Firestore.
 */
export async function awardLoyaltyPoints(
  clinicId: string,
  patientId: string,
  pointsToAdd: number
): Promise<number> {
  if (!clinicId || !patientId || pointsToAdd <= 0) return 0;

  const patientRef = doc(null, `clinics/${clinicId}/patients`, patientId);
  const snap = await getDocSmart(patientRef);

  let currentPoints = 0;
  if (snap.exists()) {
    currentPoints = Number(snap.data()?.loyaltyPoints) || 0;
  }

  const newPoints = currentPoints + pointsToAdd;

  await setDoc(patientRef, cleanDbData({
    loyaltyPoints: newPoints,
    updatedAt: new Date().toISOString()
  }), { merge: true });

  return newPoints;
}

/**
 * Deducts redeemed points from a patient's loyalty balance in Firestore.
 */
export async function redeemLoyaltyPoints(
  clinicId: string,
  patientId: string,
  pointsToDeduct: number
): Promise<number> {
  if (!clinicId || !patientId || pointsToDeduct <= 0) return 0;

  const patientRef = doc(null, `clinics/${clinicId}/patients`, patientId);
  const snap = await getDocSmart(patientRef);

  let currentPoints = 0;
  if (snap.exists()) {
    currentPoints = Number(snap.data()?.loyaltyPoints) || 0;
  }

  const newPoints = Math.max(0, currentPoints - pointsToDeduct);

  await setDoc(patientRef, cleanDbData({
    loyaltyPoints: newPoints,
    updatedAt: new Date().toISOString()
  }), { merge: true });

  return newPoints;
}
