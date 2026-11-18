# Kitap Değerlendirme Sistemi

Kitaplığım'daki puanlamanın temeli. İki ayrı puan vardır: **💗 Romantizm puanı** (kişisel zevke uyum; eski adıyla "genel uyum puanı") ve **⭐ Genel puan** (türden bağımsız kalite). Yeni kitap değerlendirirken (elle, Excel'le ya da bir yapay zekâdan
toplu değerlendirme alırken) bu tanımlar kullanılır. Uygulamada **Ayarlar → 📏 Puanlama rehberi** ve
**Düzenle → Puanlar → 📏 Rehber** aynı içeriği gösterir (`js/store.js` → `CRITERIA`, `SPICY_LABELS`).

## Kriterler (1–5, buçuklu verilebilir)

Kriterler birbirinden bağımsızdır; her biri kitabın farklı bir yönünü ölçer.

| # | Kriter | Uygulamadaki alan | Ne ölçer |
|---|---|---|---|
| 1 | Romantik kimya | `chemistry` | Ana karakterler arasındaki çekim, elektrik, duygusal/fiziksel uyum, karşılıklı gerilim, okura hissettirilen romantik heyecan |
| 2 | Erkek karakter | `male` | Kişilik ve özgünlük, karizma, duygusal derinlik, gelişim ve geçmiş, tutarlılık, ilişkideki tutumu |
| 3 | Kadın karakter | `female` | Karakter derinliği, güçlü/zayıf yön dengesi, bağımsızlık ve karar verme, gelişim, hikâyeye katkı, okurla bağ |
| 4 | Fantastik dünya ve evren | `world` | Dünya inşası, büyü/güç sistemleri, ırklar ve mitoloji, iç tutarlılık, atmosfer. **Fantastik olmayan kitaplarda: kitabın geçtiği dünyanın ve atmosferin inandırıcılığı** |
| 5 | Aksiyon ve olay örgüsü | `action` | Örgünün tutarlılığı, çatışma ve gerilim, aksiyon sahneleri, sürprizler, tempo, okuru içine çekmesi |
| 6 | Romantizm | `romance` | Romantizmin hikâyedeki ağırlığı, ilişkinin gelişimi, duygusal yakınlaşma, aşkın hikâyeye etkisi, romantik sahneler |
| 7 | Edebî derinlik | `literary` | Yazım ve anlatım kalitesi, psikolojik derinlik, diyalogların doğallığı, betimlemeler, temalar |
| 8 | Sürükleyicilik ve okunabilirlik | `pace` | Akıcılık, bölüm uzunluğu ve tempo, gereksiz uzatma olmaması, anlaşılır dil, okuma isteğini canlı tutması |

**Önemli ayrım:** *Romantik kimya* karakterler arasındaki çekimi; *romantizm* ise ilişkinin hikâye içindeki
gelişimini ve duygusal derinliğini ölçer.

## Spicy / +18 içerik (0–5, tam sayı)

Diğer kriterlerden ayrıdır; yalnızca açık yetişkin sahnelerin varlığını ve yoğunluğunu ölçer. Güçlü bir aşk
hikâyesi açık sahne içermeyebilir; spicy puanı ilişkinin kalitesini ya da kitabın başarısını göstermez.

| Puan | Açıklama |
|---|---|
| 0 | Açık yetişkin sahnesi bulunmaz. |
| 1 | Çok hafif, örtük veya ima edilen yetişkin içerik. |
| 2 | Az sayıda, sınırlı detay içeren açık sahne. |
| 3 | Orta yoğunlukta, belirgin ve detaylı yetişkin sahneler. |
| 4 | Sık karşılaşılan, açık ve detaylı yetişkin sahneler. |
| 5 | Çok yoğun, sık ve oldukça açık yetişkin içerik. |

## Genel okuyucu uyumu (1–5)

Kitabın bu özellikleriyle okuyucunun beklentileri arasındaki uyum. Özellikle: güçlü romantik ilişki ve kimya,
etkileyici ana karakterler, romantizmin yeterli ağırlığı, varsa fantastik dünyanın ve olay örgüsünün başarısı,
akıcı anlatım ve tercih edilen yetişkin içerik yoğunluğu.

Uygulamada **Uyum puanı** 8 kriterin ağırlıklı ortalaması olarak otomatik hesaplanır (ağırlıklar
**Ayarlar → Romantizm puanı ağırlıkları**). Spicy bu hesaba katılmaz; spicy tercihi filtrelerle ayrıca uygulanır.

## Excel / dış kaynak sütun adları

İçe aktarmada şu başlıklar da tanınır: *Kimya → Romantik kimya*, *Evren / Fantastik dünya ve evren → Fantastik
dünya*, *Aksiyon ve olay örgüsü → Aksiyon*, *Edebiyat / Edebî derinlik → Edebi derinlik*, *Akıcılık /
Okunabilirlik / Sürükleyicilik ve okunabilirlik → Sürükleyicilik*, *Spice → Spicy*.

## ⭐ Genel puan (türden bağımsız kalite)

"Bu kitap, kişisel zevkten ve türünden bağımsız olarak iyi bir kitap mı?" sorusunu ölçer. Goodreads'in 5 yıldızına
benzer ama daha ayırt edicidir: **3 = iyi bir kitap**. Kriterler 1–5 arası, çeyrek puanlarla (3,25 · 3,5 · 3,75) verilir.
Ağırlıklar sabittir (`js/store.js` → `QUALITY`).

| Kriter | Ağırlık | Neye bakar |
|---|---|---|
| Yazım ve anlatım | %20 | Dil ve üslup, cümle kalitesi, diyaloglar, anlatım tekniği, betimlemeler |
| Karakterler | %20 | Tüm karakterlerin inandırıcılığı, derinliği, motivasyonları ve gelişimi |
| Kurgu ve yapı | %20 | Tutarlılık, mantık boşlukları, giriş–gelişme–sonuç dengesi, final |
| Tempo ve okunabilirlik | %15 | Sürükleyicilik, gereksiz uzatma / aceleye getirme olmaması |
| Özgünlük | %10 | Klişeleri aşabilmesi, yeni bir fikir ya da ses getirmesi |
| Tema ve derinlik | %10 | Söylediği bir şey olması, akılda kalması |
| Duygusal etki | %5 | Okuru ne kadar etkilediği |

| Puan | Anlamı |
|---|---|
| 1 | Zayıf — tavsiye edilmez |
| 2 | Vasat — ciddi sorunları var |
| 3 | İyi — türünün sağlam bir örneği |
| 4 | Çok iyi — türünün üstünde |
| 5 | Başyapıt — türünü aşan |

Güven: **Ön değerlendirme** (bilinen eleştiri ve okur yorumlarına dayalı tahmin), **Otomatik tahmin** (romantizm
kriterlerinden türetilmiş, 3'e doğru sıkıştırılmış kaba tahmin; okununca düzeltilmeli).

## ℹ️ Puanların dayanağı

Her kitabın sayfasında **Puanların dayanağı** bölümü, puanların neye dayandığını gösterir: romantizm puanının
güven etiketi (+ isteğe bağlı not), spicy'nin dayanağı (`spicyNote`, örn. "Romance.io 3/5, 2 açık sahne"),
genel puanın kaynağı (`qualityConf`) ve Goodreads oy sayısı. Dayanağı yazılmamış spicy "tahmin" olarak görünür.
Her kriterin 1–5 seviye tablosu `js/store.js` → `LEVELS`, güven etiketleri `BASIS` içindedir ve
📏 Puanlama rehberinde açılır tablolar olarak gösterilir.

## 🔎 Metinden değerlendirme (ücretsiz, çevrimdışı)

Kitaba PDF/EPUB eklenince `js/analyze.js` metni telefonda tarar (yapay zekâ değil, kurallarla):
spicy (açık sahne sayısı, detay ve yoğunluk), sürükleyicilik (diyalog oranı, paragraf uzunluğu),
romantizm ağırlığı ve aksiyon (ilgili kelime yoğunluğu). Yalnızca **boş** alanları doldurur
(spicy dayanağı "Metin", diğerleri "Otomatik"). **🔎 Yeniden değerlendir** önerileri şimdiki değerlerle
yan yana gösterir; yalnızca seçilen kriterler değişir. Kimya, karakterler, edebî derinlik gibi kriterler önerilmez.
