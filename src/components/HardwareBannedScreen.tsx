import React, { useState } from 'react';
import type { BannedDevice } from '../types';
import { getDeviceTypeInfo } from '../services/deviceService';
import {
  ShieldAlert,
  RotateCw,
  Lock,
  Cpu,
  Globe,
  Smartphone,
  Monitor,
  Tablet,
  AlertOctagon,
  Ban,
  Radio,
} from 'lucide-react';

interface HardwareBannedScreenProps {
  banInfo: BannedDevice;
  currentIp?: string | null;
  currentDeviceId?: string | null;
  currentDeviceType?: 'desktop' | 'tablet' | 'mobile' | 'unknown';
  onCheckStatus: () => Promise<void>;
}

export const HardwareBannedScreen: React.FC<HardwareBannedScreenProps> = ({
  banInfo,
  currentIp,
  currentDeviceId,
  currentDeviceType,
  onCheckStatus,
}) => {
  const [checking, setChecking] = useState(false);
  const [lastCheckMessage, setLastCheckMessage] = useState<string | null>(null);

  const deviceTypeKey = banInfo.deviceType || currentDeviceType || 'unknown';
  const typeInfo = getDeviceTypeInfo(deviceTypeKey);

  const handleManualCheck = async () => {
    setChecking(true);
    setLastCheckMessage(null);
    try {
      await onCheckStatus();
      setLastCheckMessage('Engelleme durumu halen aktif. Yönetici henüz banı kaldırmadı.');
    } catch {
      setLastCheckMessage('Sunucuyla bağlantı kurulurken hata oluştu.');
    } finally {
      setChecking(false);
    }
  };

  const displayIp = banInfo.ip || currentIp || 'Bilinmiyor';
  const displayHwid = banInfo.deviceId || currentDeviceId || 'HWID-UNKNOWN';

  return (
    <div
      id="hardware-banned-screen-container"
      className="fixed inset-0 z-[99999] bg-[#0a0507] text-[#f2f2f2] flex flex-col items-center justify-between p-4 sm:p-8 select-none overflow-y-auto font-sans"
    >
      {/* Üst Güvenlik Çubuğu */}
      <div className="w-full max-w-2xl flex items-center justify-between border-b border-red-900/40 pb-3 pt-2">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
          </span>
          <span className="text-red-500 font-mono text-xs uppercase tracking-widest font-bold">
            KATI GÜVENLİK PROTOKOLÜ // HARDWARE & IP LOCKOUT
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-500 text-xs font-mono">
          <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span>PORT 403 BLOCKED</span>
        </div>
      </div>

      {/* Orta Ana Blok */}
      <div className="w-full max-w-2xl flex flex-col items-center text-center my-auto py-6 sm:py-8">
        {/* Görsel Uyarı Amblemi */}
        <div className="relative mb-6">
          {/* Dış Kırmızı Radar Halesi */}
          <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-3xl bg-red-950/40 border-2 border-red-600/50 flex items-center justify-center shadow-[0_0_50px_rgba(239,68,68,0.3)] backdrop-blur-sm relative">
            {/* İç Kalkan & Kilit */}
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-red-600 to-rose-900 flex items-center justify-center shadow-2xl relative">
              <ShieldAlert className="w-12 h-12 sm:w-14 sm:h-14 text-white animate-pulse" />
            </div>

            {/* Köşe Küçük Kilit Rozeti */}
            <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-black border-2 border-red-500 flex items-center justify-center shadow-lg">
              <Lock className="w-5 h-5 text-red-400" />
            </div>
          </div>
        </div>

        {/* Ana Başlık */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/60 border border-red-800/60 text-red-400 text-xs font-semibold uppercase tracking-wider mb-3">
          <AlertOctagon className="w-3.5 h-3.5" />
          <span>Fiziksel Cihaz ve IP Erişimi Durduruldu</span>
        </div>

        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tracking-tight mb-3 uppercase">
          Bu Cihaz ve IP Engellendi
        </h1>

        <p className="text-sm sm:text-base text-zinc-300 max-w-lg mb-6 leading-relaxed">
          Güvenlik denetimleri sonucunda kullandığınız <strong className="text-red-400 font-bold">{typeInfo.label}</strong> ve bağlı olduğunuz IP adresi RedChat ağından <span className="underline decoration-red-500 underline-offset-4 font-semibold text-white">tamamen men edilmiştir</span>.
        </p>

        {/* Katı Bilgi Paneli */}
        <div className="w-full bg-zinc-950/90 border border-red-900/50 rounded-2xl p-4 sm:p-5 text-left mb-6 shadow-2xl space-y-3 font-mono text-xs sm:text-sm">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
            <span className="text-zinc-400 flex items-center gap-2">
              {deviceTypeKey === 'desktop' ? (
                <Monitor className="w-4 h-4 text-red-400" />
              ) : deviceTypeKey === 'tablet' ? (
                <Tablet className="w-4 h-4 text-red-400" />
              ) : (
                <Smartphone className="w-4 h-4 text-red-400" />
              )}
              Yasaklı Cihaz Türü:
            </span>
            <span className="font-bold text-white bg-zinc-900 px-2.5 py-1 rounded border border-zinc-700">
              {typeInfo.label}
            </span>
          </div>

          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
            <span className="text-zinc-400 flex items-center gap-2">
              <Globe className="w-4 h-4 text-red-400" />
              Engellenen Ağ IP:
            </span>
            <span className="font-bold text-red-400 bg-red-950/40 px-2.5 py-1 rounded border border-red-900/60">
              {displayIp}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/80 pb-2.5 gap-1">
            <span className="text-zinc-400 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-red-400" />
              Donanım Kimliği (HWID):
            </span>
            <span className="text-zinc-300 font-mono text-xs truncate max-w-[260px] bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
              {displayHwid}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-1 gap-1">
            <span className="text-zinc-400 flex items-center gap-2">
              <Ban className="w-4 h-4 text-red-400" />
              Engelleme Gerekçesi:
            </span>
            <span className="font-semibold text-rose-300 text-xs sm:text-sm">
              {banInfo.reason || 'Kalıcı Ağ ve Cihaz Güvenlik İhlali'}
            </span>
          </div>
        </div>

        {/* Katı Kısıtlamalar Listesi */}
        <div className="w-full bg-red-950/20 border border-red-900/40 rounded-xl p-3.5 sm:p-4 text-left text-xs sm:text-xs text-zinc-300 space-y-1.5 mb-6">
          <div className="font-bold text-red-400 flex items-center gap-1.5 uppercase text-[11px] tracking-wide mb-1">
            <Lock className="w-3.5 h-3.5" />
            <span>KATI GÜVENLİK KURALLARI (BYPASS EDİLEMEZ)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-500 font-bold">•</span>
            <span>Bu cihaz üzerinden <strong>yeni bir hesap açılamaz</strong> ve kayıt olunamaz.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-500 font-bold">•</span>
            <span>Mevcut hiçbir kullanıcı hesabı bu cihazdan sisteme giriş yapamaz.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-red-500 font-bold">•</span>
            <span>Yönetici Admin Panelinden <strong>IP ve Donanım Banını kaldırmadığı</strong> sürece bu kilit kalkmaz.</span>
          </div>
        </div>

        {lastCheckMessage && (
          <div className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3.5 py-2 rounded-lg mb-4 animate-fade-in">
            {lastCheckMessage}
          </div>
        )}
      </div>

      {/* Alt Aksiyon Butonu */}
      <div className="w-full max-w-md flex flex-col items-center gap-3 pb-4">
        <button
          onClick={handleManualCheck}
          disabled={checking}
          className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-red-700 to-rose-700 hover:from-red-600 hover:to-rose-600 text-white font-bold text-sm transition-all shadow-xl shadow-red-950/50 flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-60 active:scale-98"
        >
          <RotateCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
          <span>{checking ? 'Yönetici İzni Denetleniyor...' : 'Ban Durumunu Yeniden Sorgula'}</span>
        </button>

        <p className="text-[11px] text-zinc-500 text-center leading-normal">
          Yönetici Admin Panelinden bu cihazın veya IP adresinin banını kaldırdığında kilit anında otomatik olarak açılacaktır.
        </p>
      </div>
    </div>
  );
};
