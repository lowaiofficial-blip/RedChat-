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
  
  // Check pending using single-field query to prevent composite index issues
  const targetField = data.type === 'user' ? 'userId' : 'channelId';
  const targetVal = data.type === 'user' ? data.userId : data.channelId;

  const reqQuery = query(
    collection(db, 'verificationRequests'),
    where(targetField, '==', targetVal)
  );
  
  const snapshot = await getDocs(reqQuery);
  const hasPending = snapshot.docs.some(d => d.data().status === 'pending');
  if (hasPending) {
    throw new Error('Halihazırda bekleyen bir doğrulama başvurunuz bulunuyor.');
  }

  const reqRef = doc(collection(db, 'verificationRequests'));
  // Remove any undefined keys to satisfy Firestore constraints
  const cleanData: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      cleanData[key] = value;
    }
  }

  await setDoc(reqRef, {
    ...cleanData,
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
  
  const targetField = type === 'user' ? 'userId' : 'channelId';
  const reqQuery = query(
    collection(db, 'verificationRequests'),
    where(targetField, '==', id)
  );

  return onSnapshot(reqQuery, (snapshot) => {
    const requests = snapshot.docs
      .map(d => d.data() as VerificationRequest)
      .filter(r => r.type === type);

    requests.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return timeB - timeA;
    });
    onUpdate(requests);
  }, (err) => {
    console.error("Verification req error", err);
    onUpdate([]);
  });
}

export function subscribeToAllVerificationRequests(
  onUpdate: (requests: VerificationRequest[]) => void
) {
  if (!db) return () => {};
  
  const reqQuery = collection(db, 'verificationRequests');

  return onSnapshot(reqQuery, (snapshot) => {
    const requests = snapshot.docs.map(d => d.data() as VerificationRequest);
    requests.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      return timeB - timeA;
    });
    onUpdate(requests);
  }, (err) => {
    console.error("Verification admin fetch error", err);
    onUpdate([]);
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
