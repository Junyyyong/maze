# Paper Shelf — Flutter iOS 셋업 가이드

## 사전 준비
- Flutter SDK 3.22+
- Xcode 15+ (Mac 필수)
- CocoaPods (`sudo gem install cocoapods`)
- Apple Developer Program 계정 ($99/년)

## 빌드 순서

```bash
# 1. app 디렉토리에서 Flutter 프로젝트 스캐폴드 생성
cd app
flutter create --project-name paper_shelf --org com.papershelf --platforms ios .

# 2. 의존성 설치
flutter pub get

# 3. iOS 네이티브 PDF 브릿지 복사
cp ios_config/AppDelegate.swift ios/Runner/AppDelegate.swift

# 4. iOS 의존성 설치
cd ios && pod install && cd ..

# 5. 시뮬레이터 또는 실기기 실행
flutter run -d <device-id>
```

## 릴리즈 빌드 (App Store 제출)

```bash
flutter build ipa --release
# 결과물: build/ios/ipa/paper_shelf.ipa
# Xcode Organizer 또는 Transporter 앱으로 App Store Connect에 업로드
```

## 주요 파일 구조

```
lib/
  main.dart              # 앱 진입점, Hive 초기화
  app.dart               # MaterialApp + 라우팅
  theme/app_theme.dart   # Light / Sepia / Dark 테마
  models/book.dart       # Book, BookBlock, Highlight (Hive)
  providers/app_provider.dart  # 테마·폰트·TTS 상태
  services/
    pdf_service.dart     # Swift PDFKit MethodChannel 호출
    storage_service.dart # Hive CRUD
    tts_service.dart     # flutter_tts 래퍼 + 인용 필터
  screens/
    splash_screen.dart   # 스플래시 (2.2초)
    onboarding_screen.dart  # 첫 실행 온보딩 3페이지
    library_screen.dart  # 서재 그리드
    reader_screen.dart   # 텍스트 리더 (TTS·목차·하이라이트)
    settings_screen.dart # 설정

ios_config/AppDelegate.swift  # PDFKit 텍스트 추출 (ios/ 에 복사)
```

## App Store 심사 체크리스트
- [ ] Info.plist: Privacy - Photo Library Usage Description (불필요 시 생략)
- [ ] `NSPhotoLibraryUsageDescription` 미사용 (파일 앱에서만 PDF 접근)
- [ ] 개인정보 처리방침 URL 등록 (App Store Connect)
- [ ] 테스트 계정 제공 (로그인 없으므로 불필요)
- [ ] 스크린샷 6.7″ / 5.5″ 2종 이상
