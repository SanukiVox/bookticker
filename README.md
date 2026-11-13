# 📚 Kitaplığım

iPhone'a kurulan, internetsiz çalışan kişisel kitap okuma listesi.
Bütün veriler (kitaplar, kapaklar, notlar) **sadece telefonunda** saklanır.

## Özellikler

- **Kitaplık:** Kitaplar / Yazarlar / Seriler sekmeleri, kapaklı veya liste görünümü
- **Arama:** Hangi alanda arayacağını seç (Kitap adı, Orijinal ad, Yazar, Seri, Notlar). Türkçe karakter fark etmez.
- **Filtreler:** Okuma durumu, tür, çeviri, yayınevi, spicy, uyum puanı, içerik uyarısı… Filtreleri kaydedebilirsin.
- **Kitap sayfası:** Türkçe + orijinal kapak, özet, puanlar, serinin ve yazarın diğer kitapları
- **Ekleme formu:** Açılır seçenekler (listeleri kendin düzenlersin), yazar/seri otomatik tamamlama, kameradan/galeriden kapak
- **Okuma:** Sıradaki kitap önerisi, sürükle-bırak öncelik sırası, okuma kuralları, istatistik, yıllık hedef
- **Veriler:** Excel'den içe aktarma, Excel'e dışa aktarma, kapaklar dahil yedek alma/geri yükleme

## iPhone'a kurulum

1. Safari'de uygulamanın adresini aç (aşağıdaki "Yayınlama" bölümüne bak).
2. Alttaki **Paylaş** düğmesine (kare + yukarı ok) dokun.
3. **Ana Ekrana Ekle**'yi seç → **Ekle**.
4. Artık ana ekrandaki **Kitaplığım** ikonundan aç. İnternet olmadan da çalışır.
5. İlk açılışta **Ayarlar → Excel'den içe aktar** ile mevcut listeni yükleyebilirsin (isteğe bağlı).

> ⚠️ Uygulamayı her zaman ana ekrandaki ikondan aç. Safari sekmesindeki kopya ayrı bir depolama kullanır.
> Ara sıra **Ayarlar → Yedek al** ile yedeği iCloud Drive'a kaydetmeni öneririm.

## Yayınlama (GitHub Pages)

1. GitHub'da depo → **Settings → General → Danger Zone → Change visibility → Public**
   (Herkes sadece uygulamanın kodunu görebilir; kitapların telefonunda kalır.)
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**
3. Branch olarak bu kodun olduğu dalı ve **/ (root)** klasörünü seç → **Save**
4. 1–2 dakika sonra adres sayfanın üstünde görünür: `https://<kullanıcı-adın>.github.io/bookticker/`

## Güncelleme

Kod değiştiğinde `sw.js` içindeki `VERSION` değerini artır. Uygulama bir sonraki açılışta
(internet varken) yeni sürümü indirir, ikinci açılışta kullanır. Verilerin silinmez.

## Teknik

Saf HTML/CSS/JavaScript, derleme adımı yok. Veriler IndexedDB'de, çevrimdışı çalışma service worker ile.
Excel okuma/yazma için [SheetJS](https://sheetjs.com) (`vendor/`, Apache 2.0) kullanılır.
