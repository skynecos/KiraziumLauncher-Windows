Kirazium Windows Launcher 0.6.0

- Microsoft hesabıyla tarayıcı üzerinden cihaz kodu girişi, Java lisansı ve Minecraft profil doğrulaması.
- Hesap yenileme bilgisi Windows safeStorage ile şifreli saklanır; tokenlar arayüze gönderilmez.
- Oyuncu adının yanında logo yerine skin kafası gösterilir. Çevrimiçi hesapta ad ve UUID doğrulanmış profilden alınır.
- Mobil KiraziumClient ile aynı mevcut legacy Microsoft sağlayıcısı kullanılır. Gerçek hesapla giriş ve online-mode sunucu bağlantısı kullanıcı doğrulaması bekler.

- Mobil sürümle aynı güncel logo ve sade, yuvarlatılmış HUD tasarımı.
- Modrinth içerikleri panel açılınca görselleriyle otomatik listelenir.
- Her Minecraft sürümü ve Vanilla/Fabric profili ayrı mod, kaynak paketi ve oyun klasörü kullanır.
- Mod sürümü ve zorunlu bağımlılıkları birlikte doğrulanır. Gerekirse önceki uyumlu sürüm seçilir; değiştirilen dosyalar profil içindeki `.content-backups` klasörüne yedeklenir.
- Fabric profilleri resmî profil API'sinden alınır; 0.0.0 temel sürüm hatası giderildi.
- Minecraft sürüm dosyaları SHA-1 ile doğrulanır ve bozuk önbellek onarılır.
- Java ana sürümü doğrulanır; erken oyun kapanmaları ve oyun çıktısı günlüklerde tutulur.
- Eşzamanlı ayar kayıtları ve kaynak paketi güncellemesinde etkinlik kaydı düzeltildi.

Doğrulama: otomatik testler, 26.1.2 / 26.2 / 1.21.11 için Vanilla ve Fabric kurulumları, 26.2 Vanilla/Fabric ve 26.1 Iris/Sodium ile yerel oyun/render kontrolleri.
