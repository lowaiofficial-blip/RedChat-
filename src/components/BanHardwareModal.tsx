import React, { useState, useEffect } from 'react';
import type { UserProfile } from '../types';
import { banDeviceAndIp } from '../services/adminService';
import { UserAvatar } from './UserAvatar';
import {
  ShieldAlert,
  X,
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  Cpu,
  FileText,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface BanHardwareModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser?: UserProfile | null;
  adminUser: UserProfile;
  onSuccess?: () => void;
}

export const BanHardwareModal: React.FC<BanHardwareModalProps> = ({
  isOpen,
  onClose,
  targetUser,
  adminUser,
  onSuccess,
}) => {
  const [deviceType, setDeviceType] = useState<'desktop' | 'tablet' | 'mobile' | 'unknown'>('desktop');
  const [ip, setIp] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [reason, setReason] = useState('Topluluk kurallarını ciddi ihlal / Ağ ve cihaz engeli');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (targetUser) {
      setDeviceType(targetUser.deviceType || 'desktop');
      setIp(targetUser.lastIp || '');
      // Eğer kullanıcının kayıtlı bir lastDeviceId'si yoksa temsili bir HWID ata
      if (targetUser.lastDeviceId) {
        setDeviceId(targetUser.lastDeviceId);
      } else {
        const hashSeed = targetUser.uid.substring(0, 8).toUpperCase();
        setDeviceId(`HWID-USR-${hashSeed}-AUTO`);
      }
    } else {
      setDeviceType('desktop');
      setIp('');
      setDeviceId('');
    }
    setError(null);
  }, [targetUser, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim() && !deviceId.trim()) {
      setError('Lütfen en az bir IP adresi veya Donanım Kimliği (HWID) girin.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await banDeviceAndIp(adminUser, {
        deviceId: deviceId.trim() || `HWID-MANUAL-${Date.now().toString(36).toUpperCase()}`,
        ip: ip.trim() || null,
        deviceType,
        hardwareFingerprint: targetUser?.lastDeviceId || deviceId.trim(),
        targetUid: targetUser?.uid || null,
        targetUsername: targetUser?.username || null,
        targetDisplayName: targetUser?.displayName || null,
        targetEmail: targetUser?.email || null,
        reason: reason.trim() || 'Ağ ve cihaz güvenlik kısıtlaması',
      });

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Ban uygulanırken bir hata meydana geldi.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-900 border border-red-900/60 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Başlığı */}
        <div className="px-6 py-4 bg-red-950/40 border-b border-red-900/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-red-400">
            <div className="w-8 h-8 rounded-lg bg-red-900/50 border border-red-700/50 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Cihaz & IP Banı Uygula</h2>
              <p className="text-xs text-red-300/80">Bu cihazdan giriş ve hesap açma engellenecektir</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal İçeriği */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Hedef Kullanıcı Kartı (Varsa) */}
          {targetUser && (
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center gap-3">
              <UserAvatar
                photoURL={targetUser.photoURL}
                name={targetUser.displayName}
                username={targetUser.username}
                size="md"
                className="ring-1 ring-red-500/40"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {targetUser.displayName}
                </div>
                <div className="text-xs text-zinc-400 truncate">
                  @{targetUser.username} {targetUser.email ? `• ${targetUser.email}` : ''}
                </div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-red-950 text-red-400 border border-red-800/50 font-medium">
                Hedef Kullanıcı
              </span>
            </div>
          )}

          {/* Cihaz Türü Seçimi */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-2">
              Yasaklanacak Cihaz Türü
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setDeviceType('desktop')}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  deviceType === 'desktop'
                    ? 'bg-red-950/50 border-red-500 text-white shadow-md shadow-red-950/30'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <Monitor className="w-5 h-5 text-red-400" />
                <span className="text-xs font-medium">Bilgisayar (PC)</span>
              </button>

              <button
                type="button"
                onClick={() => setDeviceType('tablet')}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  deviceType === 'tablet'
                    ? 'bg-red-950/50 border-red-500 text-white shadow-md shadow-red-950/30'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <Tablet className="w-5 h-5 text-red-400" />
                <span className="text-xs font-medium">Tablet</span>
              </button>

              <button
                type="button"
                onClick={() => setDeviceType('mobile')}
                className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition-all cursor-pointer ${
                  deviceType === 'mobile'
                    ? 'bg-red-950/50 border-red-500 text-white shadow-md shadow-red-950/30'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <Smartphone className="w-5 h-5 text-red-400" />
                <span className="text-xs font-medium">Telefon (Mobil)</span>
              </button>
            </div>
          </div>

          {/* IP Adresi */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-red-400" />
              <span>Engellenecek IP Adresi</span>
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="Örn: 195.175.22.45"
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-red-500 focus:ring-1 focus:ring-red-500 text-white text-sm font-mono outline-none transition-colors"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Bu IP adresinden gelen tüm bağlantı istekleri bloke edilecektir.
            </p>
          </div>

          {/* Donanım Kimliği (HWID) */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-red-400" />
              <span>Donanım / Cihaz Kimliği (HWID)</span>
            </label>
            <input
              type="text"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Örn: HWID-A78F-992C-E01B"
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-red-500 focus:ring-1 focus:ring-red-500 text-white text-sm font-mono outline-none transition-colors"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Fiziksel cihazın tarayıcı ve donanım parmak izini kilitler.
            </p>
          </div>

          {/* Ban Gerekçesi */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-red-400" />
              <span>Engelleme Nedeni</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Kural ihlali, spam, taciz vb."
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-red-500 focus:ring-1 focus:ring-red-500 text-white text-sm outline-none transition-colors"
            />
          </div>

          {/* Katı Uyarı Notu */}
          <div className="p-3 bg-red-950/20 border border-red-900/40 rounded-xl text-[11px] text-red-300/90 leading-relaxed">
            ⚠️ <strong>Katı Yasak Kuralı:</strong> Bu işlem tamamlandığında hedef cihazda katı kırmızı kilit ekranı açılır. Kullanıcı ne giriş yapabilir ne de yeni bir hesap açabilir. Bu engeli istediğiniz zaman admin panelindeki <em>"IP Ban Kaldır"</em> butonundan kaldırabilirsiniz.
          </div>

          {/* Butonlar */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium text-xs transition-colors cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-all shadow-lg shadow-red-900/40 flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>İşleniyor...</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4" />
                  <span>Cihazı ve IP'yi Kalıcı Olarak Banla</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
