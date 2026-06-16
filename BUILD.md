# Paper Shelf — 빌드 가이드

## 개발 환경 실행

```bash
npx serve . -p 8901
# http://localhost:8901 에서 확인
```

## Capacitor 초기 설정 (최초 1회)

```bash
npm install
npx cap add ios      # ios/ 폴더 생성 (macOS + Xcode 필요)
npx cap add android  # android/ 폴더 생성 (Android Studio 필요)
```

## iOS 빌드 (macOS + Xcode 필요)

```bash
npx cap sync ios
npx cap open ios     # Xcode 열림 → Product > Archive → App Store Connect 업로드
```

**App Store 제출 체크리스트:**
- [ ] Apple Developer Program 가입 ($99/년)
- [ ] Bundle ID: `com.papershelf.app` (Apple Developer 포털에서 등록)
- [ ] 앱 아이콘: `icons/icon-1024.png` → Xcode Assets에 추가
- [ ] Xcode Signing & Capabilities → Team 설정
- [ ] App Store Connect에서 앱 정보, 스크린샷, 개인정보처리방침 URL 입력
- [ ] 개인정보처리방침 URL: `https://junyyyong.github.io/maze/privacy.html` (또는 배포 도메인)

## Android 빌드 (Android Studio 필요)

```bash
npx cap sync android
npx cap open android  # Android Studio 열림 → Build > Generate Signed APK/Bundle
```

**키스토어 생성 (최초 1회):**
```bash
keytool -genkey -v -keystore papershelf.keystore \
  -alias papershelf -keyalg RSA -keysize 2048 -validity 10000
# papershelf.keystore 파일은 절대 커밋하지 말 것 (gitignore에 포함)
```

**Google Play 제출 체크리스트:**
- [ ] Google Play Console 가입 ($25 일회성)
- [ ] App Bundle (.aab) 생성
- [ ] 앱 아이콘: `icons/icon-512.png`
- [ ] 개인정보처리방침 URL 입력

## e-ink 기기 (Onyx Boox Go 7 등)

앱이 자동으로 e-ink 기기를 감지합니다. 수동 전환은 라이브러리 화면 우상단 **E** 버튼을 누르세요.

e-ink 모드에서는:
- 모든 애니메이션/전환 효과 제거
- 고대비 흑백 색상
- 더 큰 터치 타겟 (52px)
- 글자 크기 자동 증가

## PWA (설치형 웹앱)

Chrome/Safari에서 "홈 화면에 추가"로 설치 가능.
HTTPS 환경에서만 서비스워커(오프라인 캐시) 작동.
