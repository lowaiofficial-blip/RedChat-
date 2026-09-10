import React, { useState, useEffect } from 'react';
import { X, Book, Trash2, Loader2, Edit2, Check } from 'lucide-react';
import { db } from '../services/firebase';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc } from 'firebase/firestore';

interface MemoryModalProps {
  userId: string;
  onClose: () => void;
}

export const MemoryModal: React.FC<MemoryModalProps> = ({ userId, onClose }) => {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  useEffect(() => {
    const q = query(
      collection(db, `users/${userId}/memories`),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const ms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMemories(ms);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });
    return () => unsub();
  }, [userId]);

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, `users/${userId}/memories/${id}`));
    } catch (e) {
      console.error(e);
    }
  };

  const handleEdit = (m: any) => {
    setEditingId(m.id);
    setEditVal(m.text);
  };

  const saveEdit = async (id: string) => {
    try {
      if (!editVal.trim()) return;
      await updateDoc(doc(db, `users/${userId}/memories/${id}`), {
        text: editVal.trim(),
        updatedAt: new Date()
      });
      setEditingId(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-3xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100">
            <Book className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-bold">RedChat AI Belleği</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>
        
        <div className="p-6 flex-1 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
            Yapay zekanın senin hakkında hatırlamasını istediğin tüm bilgiler burada tutulur. Sohbet ederken "bunu belleğe al" diyerek buraya not düşebilirsin.
          </p>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-red-500" />
            </div>
          ) : memories.length === 0 ? (
            <div className="text-center py-10">
              <Book className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500 dark:text-zinc-400 font-medium">Bellek şu an boş.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {memories.map((m) => (
                <div key={m.id} className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800 group">
                  {editingId === m.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                        rows={3}
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">İptal</button>
                        <button onClick={() => saveEdit(m.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-500 text-white rounded-lg hover:bg-red-600">
                          <Check className="w-3 h-3" /> Kaydet
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap flex-1">{m.text}</p>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleEdit(m)} className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(m.id)} className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
