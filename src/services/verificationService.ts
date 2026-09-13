import { db } from './firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  serverTimestamp,
  orderBy,
  onSnapshot
} from 'firebase/firestore';
import type { VerificationRequest } from '../types';

export async function submitVerificationRequest(data: Omit<VerificationRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  
  // Check pending
  const reqQuery = query(
    collection(db, 'verificationRequests'),
    where('type', '==', data.type),
    where(data.type === 'user' ? 'userId' : 'channelId', '==', data.type === 'user' ? data.userId : data.channelId),
    where('status', '==', 'pending')
  );
  
  const snapshot = await getDocs(reqQuery);
  if (!snapshot.empty) {
    throw new Error('Halihazırda bekleyen bir doğrulama başvurunuz bulunuyor.');
  }

  const reqRef = doc(collection(db, 'verificationRequests'));
  await setDoc(reqRef, {
    ...data,
    id: reqRef.id,
    status: 'pending',
    createdAt: serverTimestamp()
  });
}

export function subscribeToMyVerificationRequests(
  type: 'user' | 'channel',
  id: string,
  onUpdate: (requests: VerificationRequest[]) => void
) {
  if (!db) return () => {};
  
  const reqQuery = query(
    collection(db, 'verificationRequests'),
    where('type', '==', type),
    where(type === 'user' ? 'userId' : 'channelId', '==', id),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(reqQuery, (snapshot) => {
    const requests = snapshot.docs.map(d => d.data() as VerificationRequest);
    onUpdate(requests);
  }, (err) => {
    console.error("Verification req error", err);
  });
}

export function subscribeToAllVerificationRequests(
  onUpdate: (requests: VerificationRequest[]) => void
) {
  if (!db) return () => {};
  
  const reqQuery = query(
    collection(db, 'verificationRequests'),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(reqQuery, (snapshot) => {
    const requests = snapshot.docs.map(d => d.data() as VerificationRequest);
    onUpdate(requests);
  }, (err) => {
    console.error("Verification admin fetch error", err);
  });
}

export async function updateVerificationRequestStatus(
  requestId: string,
  status: 'approved' | 'rejected',
  rejectionReason?: string
): Promise<void> {
  if (!db) throw new Error('Firestore hazır değil');
  
  const reqRef = doc(db, 'verificationRequests', requestId);
  const reqSnap = await getDoc(reqRef);
  
  if (!reqSnap.exists()) {
    throw new Error('Başvuru bulunamadı.');
  }
  
  const data = reqSnap.data() as VerificationRequest;
  
  await updateDoc(reqRef, {
    status,
    rejectionReason: rejectionReason || null,
    updatedAt: serverTimestamp()
  });

  if (status === 'approved') {
    if (data.type === 'user' && data.userId) {
      await updateDoc(doc(db, 'users', data.userId), {
        isVerified: true,
        updatedAt: serverTimestamp()
      });
    } else if (data.type === 'channel' && data.channelId) {
      await updateDoc(doc(db, 'channels', data.channelId), {
        isVerified: true,
        updatedAt: serverTimestamp()
      });
    }
  }
}
