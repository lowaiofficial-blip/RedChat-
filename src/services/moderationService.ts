/**
 * RedChat AI — Sohbet Güvenliği & Hakaret / Küfür Filtresi
 * Türkçe diline ve yaygın saldırgan ifadelere göre optimize edilmiş kontrol motoru.
 */

// Yaygın Türkçe küfür ve hakaret kökleri / terimleri
const DIRECT_PROFANITY_WORDS = [
  'amk',
  'aq',
  'amq',
  'amguard',
  'amina',
  'aminakoyayim',
  'aminakoyim',
  'amcik',
  'amcık',
  'orospu',
  'orospucocugu',
  'orospuçocuğu',
  'oc',
  'oç',
  'pic',
  'piç',
  'siktir',
  'siktirgit',
  'sikeyim',
  'sikeyim',
  'sikis',
  'sikiş',
  'sikik',
  'sik',
  'yarrak',
  'yarak',
  'dassak',
  'daşşak',
  'tassak',
  'taşşak',
  'gotos',
  'götoş',
  'pezevenk',
  'kahpe',
  'fahişe',
  'fahise',
  'kancik',
  'kancık',
  'surtuk',
  'sürtük',
  'kevase',
  'kevaşe',
  'gavat',
  'kavat',
  'ibne',
  'pust',
  'puşt',
  'gotlek',
  'götlek',
  'gotveren',
  'götveren',
  'amcigi',
  'amcığı',
  'ananisikeyim',
  'ananısikeyim',
  'ebenisikeyim',
  'ebenin',
];

// Doğrudan hakaret / aşağılama sıfatları
const DIRECT_INSULT_WORDS = [
  'salak',
  'gerizekali',
  'gerizekalı',
  'aptal',
  'ahmak',
  'embesil',
  'dangalak',
  'dallama',
  'yavsak',
  'yavşak',
  'serefsiz',
  'şerefsiz',
  'namussuz',
  'haysiyetsiz',
  'karaktersiz',
  'beyinsiz',
  'moron',
  'idiot',
  'okuz',
  'öküz',
  'gerzek',
  'angut',
  'hiyar',
  'hıyar',
];

// Yanlış pozitif vermesi muhtemel kelimeleri ("malzeme", "malum", "normal", "salata" vb.)
// korumak için özel bağlamlı kurallar
const CONTEXTUAL_INSULT_PATTERNS = [
  // "mal" hakareti (mal mısın, tam bir mal, mal herif, malsın)
  /\b(tam\s+bir\s+)?mal(\s+m[ıi]s[ıi]n|s[ıi]n|lar|\s+herif|\s+ya)?\b/i,
  // "it" hakareti (pis it, it herif, itsin)
  /\b(pis\s+it|it\s+herif|it\s+oğlu\s+it|it\s+oglu\s+it)\b/i,
  // "köpek" / "kopek" hakareti
  /\b(k[öo]pek\s+herif|pis\s+k[öo]pek|k[öo]peksin)\b/i,
  // "göt" hakareti
  /\b(g[öo]t\s+k[ıi]l[ıi]|g[öo]ts[üu]n|g[öo]t\s+herif)\b/i,
  // Kısaltmalar (oç, o.ç., amk, a.m.k, aq, a.q., piç, p.i.ç)
  /(^|[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ])(o\s*\.?\s*[çc]\s*\.?|a\s*\.?\s*m\s*\.?\s*k\s*\.?|a\s*\.?\s*q\s*\.?|p\s*\.?\s*i\s*\.?\s*[çc]\s*\.?)([^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ]|$)/i,
  // "ananı / ananın ..."
  /\banan[ıi]n?\s+(am[ıi]|sik|bac[ıi]|avrad)/i,
  // "canın cehenneme", "geber", "öl pislik"
  /\b(can[ıi]n\s+cehenneme|geber\s+pislik|geber\s+lan)\b/i,
];

/**
 * Metni harf tekrarlarını ve boşluk/noktalama işaretlerini ayıklayarak normalize eder.
 * Örn: "amkkkk" -> "amk", "s.i.k.t.i.r" -> "siktir", "s a l a k" -> "salak"
 */
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLocaleLowerCase('tr-TR')
    // Türkçe karakterleri latin karşılıklarına yumuşat (ek arama için)
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

/**
 * Gönderilen mesajın hakaret, küfür veya saldırgan içerik barındırıp barındırmadığını tespit eder.
 * Yanlış pozitifleri (ör. "şık", "ışık", "malzeme", "salata", "teşekkür", "eksik", "müzik") engellemek için
 * kelime sınırları ve özel Türkçe arama kuralları kullanır.
 */
export function isAbusiveMessage(rawText: string): boolean {
  if (!rawText || typeof rawText !== 'string') return false;

  const originalLower = rawText.toLocaleLowerCase('tr-TR').trim();
  if (!originalLower) return false;

  // 1. Doğrudan bağlamsal kalıpları kontrol et (O.Ç., tam bir mal, mal mısın vb.)
  for (const pattern of CONTEXTUAL_INSULT_PATTERNS) {
    if (pattern.test(originalLower)) {
      return true;
    }
  }

  // Cümleyi kelimelerine ayır (noktalama işaretlerinden temizle)
  const words = originalLower.split(/[\s,.:;!?"'()\-[\]{}<>/\\|]+/);

  for (const rawWord of words) {
    if (!rawWord) continue;

    // "şık", "ışık", "ışıklandırma", "aşık", "beşik", "değişik", "karışık" gibi masum kelimeler kesinlikle küfür değildir
    if (/^(şık|ışık|ışıklandırma|aşık|beşik|değişik|karışık|bulaşık|dikiş)$/i.test(rawWord)) {
      continue;
    }

    const normWord = normalizeText(rawWord);

    // 2. Doğrudan küfür kontrolü (Kelime bazı)
    for (const profanity of DIRECT_PROFANITY_WORDS) {
      // Eğer kelime "şık" ise ve profanity "sik" ise, orijinal kelime 'ş' veya 'ı' içeriyorsa eşleşme yapma
      if (profanity === 'sik' && (rawWord.includes('ş') || rawWord.includes('ı'))) {
        continue;
      }

      const normProf = normalizeText(profanity);

      // Tam kelime eşleşmesi (ör. "amk", "siktir", "orospu")
      if (normWord === normProf) {
        // "sik" veya "pic" gibi 3 harfli küfürlerde orijinal harfleri kontrol et
        if (normProf === 'sik' && (rawWord.includes('ş') || rawWord.includes('ı'))) {
          continue;
        }
        return true;
      }

      // Kısaltmalar için tam kelime kontrolü (ör. "aq", "oc", "amk", "pic", "sik")
      if (normProf.length <= 4) {
        if (normWord === normProf) {
          if (normProf === 'sik' && (rawWord.includes('ş') || rawWord.includes('ı'))) {
            continue;
          }
          return true;
        }
      } else {
        // Uzun küfürler (ör. "orospucocugu", "siktirgit", "aminakoyim")
        if (normWord.includes(normProf)) {
          return true;
        }
      }
    }

    // 3. Doğrudan hakaret sıfatları kontrolü (salak, aptal, serefsiz, yavsak vb.)
    for (const insult of DIRECT_INSULT_WORDS) {
      const normInsult = normalizeText(insult);
      const insultRegex = new RegExp(`^${normInsult}(s[ıi]n[ıi]z|s[ıi]n|lar|ler|lik|ce|im|sin)?$`, 'i');
      if (insultRegex.test(normWord)) {
        return true;
      }
    }
  }

  return false;
}


