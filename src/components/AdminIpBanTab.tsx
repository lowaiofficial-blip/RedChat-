import React, { useState, useEffect } from 'react';
import type { UserProfile, BannedDevice } from '../types';
import {
  listenToBannedDevices,
  unbanDeviceAndIp,
} from '../services/adminService';
import { getDeviceTypeInfo } from '../services/deviceService';
import { BanHardwareModal } from './BanHardwareModal';
import { UserAvatar } from './UserAvatar';
import {
  ShieldAlert,
  Search,
  Plus,
  Monitor,
  Tablet,
  Smartphone,
  Globe,
  Cpu,
  Trash2,
  Copy,
  Check,
  Loader2,
  AlertOctagon,
  RefreshCw,
  Lock,
} from 'lucide-react';

interface AdminIpBanTabProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
}

export const AdminIpBanTab: React.FC<AdminIpBanTabProps> = ({ currentUser, allUsers }) => {
  const [bannedList, setBannedList] = useState<BannedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [targetUserForModal, setTargetUserForModal] = useState<UserProfile | null>(null);
  const [unbanningId, setUnbanningId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);
  const [selectedUserToBanUid, setSelectedUserToBanUid] = useState<string>('');

  // Gerçek zamanlı Firestore dinleyicisi
  useEffect(() => {
    setLoading(true);
    const unsubscribe = listenToBannedDevices((bans) => {
      setBannedList(bans);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleUnban = async (ban: BannedDevice) => {
    const confirmText = `${ban.ip || ban.deviceId} için IP ve Donanım banını kaldırmak istediğinize emin misiniz?\n\nBan kaldırıldığında cihazdaki kilit kalkacak ve kullanıcı tekrar hesap açıp giriş yapabilecektir.`;
    if (!window.confirm(confirmText)) return;

    setUnbanningId(ban.id);
    try {
      await unbanDeviceAndIp(currentUser, ban.id, ban.targetUid);
      setActionSuccessMessage(`Ban başarıyla kaldırıldı. Cihazın kilidi açıldı.`);
      setTimeout(() => setActionSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(`Ban kaldırma hatası: ${err?.message || 'Bilinmeyen hata'}`);
    } finally {
      setUnbanningId(null);
    }
  };

  // Filtreleme
  const filteredBans = bannedList.filter((b) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (b.ip && b.ip.toLowerCase().includes(q)) ||
      (b.deviceId && b.deviceId.toLowerCase().includes(q)) ||
      (b.targetUsername && b.targetUsername.toLowerCase().includes(q)) ||
      (b.targetDisplayName && b.targetDisplayName.toLowerCase().includes(q)) ||
      (b.reason && b.reason.toLowerCase().includes(q)) ||
      (b.deviceType && b.deviceType.toLowerCase().includes(q))
    );
  });

  const desktopCount = bannedList.filter((b) => b.deviceType === 'desktop').length;
  const tabletCount = bannedList.filter((b) => b.deviceType === 'tablet').length;
  const mobileCount = bannedList.filter((b) => b.deviceType === 'mobile').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Üst Bilgi ve Buton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/60 border border-zinc-800 p-5 rounded-2xl">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-950/60 border border-red-800/60 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-white">IP & Donanım (Hardware) Banları</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Bu bölümdeki banlar doğrudan cihazı (PC/Tablet/Telefon) ve IP adresini kilitler. Hesap açma ve giriş engellenir.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto shrink-0">
          {/* Otomatik Kullanıcı Seç & Banla */}
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl p-1">
            <select
              value={selectedUserToBanUid}
              onChange={(e) => setSelectedUserToBanUid(e.target.value)}
              className="bg-transparent text-white text-xs px-2.5 py-1.5 outline-none max-w-[180px] sm:max-w-[220px] truncate"
            >
              <option value="" className="bg-zinc-900 text-zinc-400">
                👤 Kullanıcı Seç (Otomatik Ban)
              </option>
              {allUsers
                .filter((u) => u.uid !== currentUser.uid)
                .map((u) => (
                  <option key={u.uid} value={u.uid} className="bg-zinc-900 text-white">
                    @{u.username || u.displayName} {u.lastIp ? `[${u.lastIp}]` : ''}
                  </option>
                ))}
            </select>
            <button
              onClick={() => {
                const target = allUsers.find((u) => u.uid === selectedUserToBanUid);
                if (!target) {
                  alert('Lütfen önce listeden bir kullanıcı seçin.');
                  return;
                }
                setTargetUserForModal(target);
                setModalOpen(true);
              }}
              disabled={!selectedUserToBanUid}
              className="px-3 py-1.5 rounded-lg bg-red-600/90 hover:bg-red-600 disabled:opacity-40 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Otomatik Banla</span>
            </button>
          </div>

          <button
            onClick={() => {
              setTargetUserForModal(null);
              setModalOpen(true);
            }}
            className="px-3.5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-xs transition-all border border-zinc-700 flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Manuel IP/HWID</span>
          </button>
        </div>
      </div>

      {actionSuccessMessage && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* İstatistik Sayaçları */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="text-xs text-zinc-400 font-medium">Toplam Yasaklı Cihaz</div>
          <div className="text-2xl font-bold text-red-500 mt-1">{bannedList.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5 text-blue-400" />
            <span>Bilgisayar (PC)</span>
          </div>
          <div className="text-2xl font-bold text-white mt-1">{desktopCount}</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
            <Tablet className="w-3.5 h-3.5 text-purple-400" />
            <span>Tablet</span>
          </div>
          <div className="text-2xl font-bold text-white mt-1">{tabletCount}</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            <span>Telefon (Mobil)</span>
          </div>
          <div className="text-2xl font-bold text-white mt-1">{mobileCount}</div>
        </div>
      </div>

      {/* Arama Alanı */}
      <div className="relative">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="IP adresi, HWID, kullanıcı adı veya sebep ara..."
          className="w-full pl-10 pr-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-red-500 transition-colors"
        />
      </div>

      {/* Ban Listesi */}
      {loading ? (
        <div className="p-12 text-center text-zinc-500 flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-red-500" />
          <span className="text-xs">IP & Donanım ban listesi yükleniyor...</span>
        </div>
      ) : filteredBans.length === 0 ? (
        <div className="p-12 text-center bg-zinc-900/40 border border-zinc-800/80 rounded-2xl flex flex-col items-center gap-3">
          <AlertOctagon className="w-10 h-10 text-zinc-600" />
          <div className="text-sm font-semibold text-zinc-400">
            {searchQuery ? 'Arama kriterlerine uygun ban bulunamadı.' : 'Henüz aktif bir IP veya Donanım Banı yok.'}
          </div>
          <p className="text-xs text-zinc-500 max-w-sm">
            Kullanıcılar sekmesinden bir kullanıcıyı seçerek veya yukarıdaki "Manuel IP / Cihaz Banla" butonuyla yeni engel uygulayabilirsiniz.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBans.map((ban) => {
            const typeInfo = getDeviceTypeInfo(ban.deviceType);
            const isUnbanning = unbanningId === ban.id;

            let formattedDate = 'Bilinmiyor';
            if (ban.bannedAt?.toDate) {
              formattedDate = ban.bannedAt.toDate().toLocaleString('tr-TR');
            } else if (ban.bannedAt?.seconds) {
              formattedDate = new Date(ban.bannedAt.seconds * 1000).toLocaleString('tr-TR');
            }

            return (
              <div
                key={ban.id}
                className="p-4 sm:p-5 bg-zinc-900 border border-zinc-800 hover:border-red-900/50 rounded-2xl transition-all shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                {/* Sol: Cihaz ve Hedef Bilgileri */}
                <div className="space-y-3 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Cihaz Türü Rozeti */}
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-200 text-xs font-semibold border border-zinc-700">
                      {ban.deviceType === 'desktop' ? (
                        <Monitor className="w-3.5 h-3.5 text-blue-400" />
                      ) : ban.deviceType === 'tablet' ? (
                        <Tablet className="w-3.5 h-3.5 text-purple-400" />
                      ) : (
                        <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      <span>{typeInfo.label}</span>
                    </span>

                    {/* Katı Engel Etiketi */}
                    <span className="px-2 py-0.5 rounded bg-red-950/80 border border-red-800/80 text-red-400 text-[11px] font-mono font-bold">
                      KATI CİHAZ KİLİDİ
                    </span>

                    {/* Hedef Kullanıcı Bilgisi */}
                    {ban.targetUsername && (
                      <span className="text-xs text-zinc-400 flex items-center gap-1.5">
                        <span>Hedef:</span>
                        <strong className="text-white">@{ban.targetUsername}</strong>
                        {ban.targetDisplayName && <span>({ban.targetDisplayName})</span>}
                      </span>
                    )}
                  </div>

                  {/* IP ve HWID Değerleri */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    {ban.ip && (
                      <div className="flex items-center justify-between bg-zinc-950 p-2 rounded-lg border border-zinc-800/80">
                        <div className="flex items-center gap-2 truncate">
                          <Globe className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          <span className="text-zinc-400">IP:</span>
                          <span className="text-white font-bold truncate">{ban.ip}</span>
                        </div>
                        <button
                          onClick={() => handleCopy(ban.ip!, `ip-${ban.id}`)}
                          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
                          title="IP Kopyala"
                        >
                          {copiedId === `ip-${ban.id}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between bg-zinc-950 p-2 rounded-lg border border-zinc-800/80">
                      <div className="flex items-center gap-2 truncate">
                        <Cpu className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="text-zinc-400">HWID:</span>
                        <span className="text-zinc-300 truncate">{ban.deviceId}</span>
                      </div>
                      <button
                        onClick={() => handleCopy(ban.deviceId, `hwid-${ban.id}`)}
                        className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors cursor-pointer"
                        title="HWID Kopyala"
                      >
                        {copiedId === `hwid-${ban.id}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Gerekçe ve Detay */}
                  <div className="text-xs text-zinc-300">
                    <span className="text-zinc-500">Sebep: </span>
                    <span className="text-rose-300 font-medium">{ban.reason}</span>
                    <span className="text-zinc-500 ml-2">• Banlayan: {ban.bannedBy}</span>
                    <span className="text-zinc-500 ml-2">• Tarih: {formattedDate}</span>
                  </div>
                </div>

                {/* Sağ: Banı Kaldır Butonu */}
                <div className="flex items-center lg:self-center pt-2 lg:pt-0 border-t lg:border-t-0 border-zinc-800 shrink-0">
                  <button
                    onClick={() => handleUnban(ban)}
                    disabled={isUnbanning}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isUnbanning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                        <span>Kaldırılıyor...</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>IP / Cihaz Banını Kaldır</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ban Ekleme Modalı */}
      <BanHardwareModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        targetUser={targetUserForModal}
        adminUser={currentUser}
        onSuccess={() => {
          setActionSuccessMessage('IP ve Donanım banı başarıyla uygulandı.');
          setTimeout(() => setActionSuccessMessage(null), 4000);
        }}
      />
    </div>
  );
};
