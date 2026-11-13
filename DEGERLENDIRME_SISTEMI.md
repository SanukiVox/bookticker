# Kitap Değerlendirme Sistemi

Kitaplığım'daki puanlamanın temeli. Yeni kitap değerlendirirken (elle, Excel'le ya da bir yapay zekâdan
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
**Ayarlar → Genel uyum puanı ağırlıkları**). Spicy bu hesaba katılmaz; spicy tercihi filtrelerle ayrıca uygulanır.

## Excel / dış kaynak sütun adları

İçe aktarmada şu başlıklar da tanınır: *Kimya → Romantik kimya*, *Evren / Fantastik dünya ve evren → Fantastik
dünya*, *Aksiyon ve olay örgüsü → Aksiyon*, *Edebiyat / Edebî derinlik → Edebi derinlik*, *Akıcılık /
Okunabilirlik / Sürükleyicilik ve okunabilirlik → Sürükleyicilik*, *Spice → Spicy*.
