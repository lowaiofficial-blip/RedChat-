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
 * Yanlış pozitifleri (ör. "malzeme", "salata", "eksik", "müzik", "sıcak") engellemek için
 * kelime sınırları ve özel kontroller kullanır.
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

  // 2. Normalleştirilmiş metin (harf tekrarı ve noktalama temizliği)
  const normalized = normalizeText(originalLower);

  // Noktalama ve boşluksuz kompakt versiyon (ör. "s.i.k", "a-m-k", "s i k t i r")
  const compactWithoutPunctuation = normalized.replace(/[^a-z0-9]/g, '');

  // 3. Tekrarlanan harfleri teke/çifte indirgeme (ör. "salaaaak" -> "salak", "piiiic" -> "pic")
  const deduplicated = normalized.replace(/([a-z])\1{2,}/g, '$1');
  const deduplicatedCompact = compactWithoutPunctuation.replace(/([a-z])\1{2,}/g, '$1');

  // 4. Doğrudan küfür listesi kontrolü
  for (const word of DIRECT_PROFANITY_WORDS) {
    const normWord = normalizeText(word);
    
    // Kelime sınırı ile tam kelime veya kök eşleşmesi
    const wordRegex = new RegExp(`\\b${normWord}\\b`, 'i');
    if (wordRegex.test(normalized) || wordRegex.test(deduplicated)) {
      return true;
    }

    // Kısa kısaltmalar (amk, aq, oç, pic) kompakt metinde tek başına veya başlangıç/bitişte mi?
    if (normWord.length <= 4) {
      if (
        deduplicatedCompact === normWord ||
        deduplicatedCompact.startsWith(normWord) ||
        deduplicatedCompact.endsWith(normWord)
      ) {
        // Ancak çok kısa kelimelerde yanlış pozitif önleme (örn. "aq" normal bir kelimenin içinde olmamalı)
        const strictBoundary = new RegExp(`(^|[^a-z])${normWord}([^a-z]|$)`, 'i');
        if (strictBoundary.test(normalized) || strictBoundary.test(deduplicated)) {
          return true;
        }
      }
    } else {
      // 5 harf veya daha uzun küfürler (orospu, siktir, sikeyim, pezevenk) kompakt metinde geçiyorsa kesin ihlaldir
      if (deduplicatedCompact.includes(normWord)) {
        return true;
      }
    }
  }

  // 5. Doğrudan hakaret sıfatları listesi kontrolü (salak, aptal, serefsiz, yavsak vb.)
  // Burada kelime sınırları esastır; "salata" salak ile eşleşmemeli!
  for (const word of DIRECT_INSULT_WORDS) {
    const normWord = normalizeText(word);
    
    // Sadece tam kelime veya Türkçe ek almış halleri: "salaksın", "aptallar", "şerefsizler", "yavşaksın"
    const insultRegex = new RegExp(`\\b${normWord}(s[ıi]n[ıi]z|s[ıi]n|lar|ler|lik|ce|im|sin)?\\b`, 'i');
    if (insultRegex.test(normalized) || insultRegex.test(deduplicated)) {
      return true;
    }
  }

  return false;
}
