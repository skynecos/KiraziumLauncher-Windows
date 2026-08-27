# Kirazium Launcher — Windows

Kirazium Survival için hazırlanan Windows Minecraft başlatıcısı.

## Özellikler

- Güvenli Electron ana süreç / renderer ayrımı
- Türkçe Kirazium arayüzü
- Mobil Kirazium Launcher ile aynı kedili uygulama logosu
- Koyu, yatay menülü özgün Kirazium arayüzü
- İstenilen resmi Minecraft sürümünü seçme ve ilk açılışta otomatik indirme
- Her sürüm için ayrı Vanilla/Fabric profili
- Ana ekrandaki HUD üzerinden uyumlu mod ve kaynak paketi indirme
- Aynı HUD üzerinden yüklü modları ve kaynak paketlerini etkinleştirme/devre dışı bırakma
- Oyuncu adı ve bellek ayarlarının güvenli kaydı
- Minecraft `26.1.2` dosyalarının resmi Mojang kaynaklarından kurulması
- Fabric Loader `0.19.3` kurulumu
- Minecraft metadata’sının istediği Java sürümünün otomatik kurulması
- `play.kirazium.com` sunucusuna otomatik bağlantı
- İndirme ve başlatma durumunun arayüzde gösterilmesi
- Geçici ağ/bozuk dosya hatalarında otomatik yeniden deneme
- Son başlatma hatasını kullanıcıya açan yerel hata kaydı
- Tek örnek uygulama kilidi
- Windows NSIS `.exe` üretimi
- GitHub Actions üzerinde otomatik doğrulama ve paketleme

Oyun dosyaları launcher verileri altında ayrı bir dizinde tutulur; kullanıcının mevcut `.minecraft` klasörüne dokunulmaz.

## Yerel geliştirme

```powershell
npm ci
npm run verify
npm start
```

Windows kurulum dosyası:

```powershell
npm run dist:win
```

Çıktı `release/KiraziumLauncher-Setup-0.5.0.exe` yolunda oluşur.
