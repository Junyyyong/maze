import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_provider.dart';

// ---------------------------------------------------------------------------
// OnboardingScreen
// ---------------------------------------------------------------------------
//
// Three-page PageView introduction shown on first launch.
//
// Navigation:
//   • Skip (top-right)  → library
//   • Next              → next page
//   • 시작하기 (last page) → library
//
// On complete: AppProvider.completeOnboarding() persists the flag so the
// splash screen routes directly to /library on future launches.
// ---------------------------------------------------------------------------

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  static const int _pageCount = 3;

  // ── Page data ──────────────────────────────────────────────────────────────

  static const List<_PageData> _pages = [
    _PageData(
      icon: '📖',
      title: '논문을 전자책처럼',
      body:
          'PDF를 추가하면 깔끔한 텍스트로 변환해 더 편하게 읽을 수 있어요.',
    ),
    _PageData(
      icon: '🔊',
      title: '음성으로 듣기',
      body:
          'TTS 기능으로 논문을 들으면서 이동 중에도 학습할 수 있어요. '
          '인용 번호는 자동으로 건너뜁니다.',
    ),
    _PageData(
      icon: '✏️',
      title: '하이라이트와 메모',
      body:
          '중요한 부분을 하이라이트하고 메모를 남겨 나만의 독서 노트를 만들어 보세요.',
    ),
  ];

  // ── Helpers ────────────────────────────────────────────────────────────────

  Future<void> _complete() async {
    if (!mounted) return;
    await context.read<AppProvider>().completeOnboarding();
    if (!mounted) return;
    Navigator.of(context).pushReplacementNamed('/library');
  }

  void _nextPage() {
    _pageController.nextPage(
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeInOut,
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final fg = colorScheme.onSurface;
    final muted = colorScheme.onSurfaceVariant;
    final accent = colorScheme.primary;
    final bg = Theme.of(context).scaffoldBackgroundColor;

    final isLastPage = _currentPage == _pageCount - 1;

    return Scaffold(
      backgroundColor: bg,
      // ── Skip button ───────────────────────────────────────────────────────
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        automaticallyImplyLeading: false,
        actions: [
          if (!isLastPage)
            TextButton(
              onPressed: _complete,
              child: Text(
                '건너뛰기',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w400,
                  color: muted,
                ),
              ),
            ),
          const SizedBox(width: 8),
        ],
      ),

      body: SafeArea(
        child: Column(
          children: [
            // ── Page view ─────────────────────────────────────────────────
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: _pageCount,
                onPageChanged: (page) {
                  setState(() => _currentPage = page);
                },
                itemBuilder: (context, index) {
                  return _OnboardingPage(
                    data: _pages[index],
                    fg: fg,
                    muted: muted,
                  );
                },
              ),
            ),

            // ── Bottom nav ────────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 40),
              child: Column(
                children: [
                  // Dot indicators
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(_pageCount, (i) {
                      final isActive = i == _currentPage;
                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        curve: Curves.easeInOut,
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        width: isActive ? 20 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(4),
                          color: isActive
                              ? accent
                              : colorScheme.outline,
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 28),

                  // Action buttons
                  if (isLastPage)
                    // Get started — full width
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton(
                        onPressed: _complete,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: accent,
                          foregroundColor: colorScheme.onPrimary,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          textStyle: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        child: const Text('시작하기'),
                      ),
                    )
                  else
                    // Next — right-aligned
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        SizedBox(
                          height: 48,
                          child: ElevatedButton(
                            onPressed: _nextPage,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: accent,
                              foregroundColor: colorScheme.onPrimary,
                              elevation: 0,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 28,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10),
                              ),
                              textStyle: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            child: const Text('다음'),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _OnboardingPage  — single page content
// ---------------------------------------------------------------------------

class _PageData {
  final String icon;
  final String title;
  final String body;

  const _PageData({
    required this.icon,
    required this.title,
    required this.body,
  });
}

class _OnboardingPage extends StatelessWidget {
  final _PageData data;
  final Color fg;
  final Color muted;

  const _OnboardingPage({
    required this.data,
    required this.fg,
    required this.muted,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 40),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // ── Icon ────────────────────────────────────────────────────────
          Text(
            data.icon,
            style: const TextStyle(fontSize: 64, height: 1),
          ),
          const SizedBox(height: 40),

          // ── Title ───────────────────────────────────────────────────────
          Text(
            data.title,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w600,
              color: fg,
              height: 1.35,
              letterSpacing: -0.1,
            ),
          ),
          const SizedBox(height: 16),

          // ── Body ────────────────────────────────────────────────────────
          Text(
            data.body,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w400,
              color: muted,
              height: 1.7,
              letterSpacing: 0.1,
            ),
          ),
        ],
      ),
    );
  }
}
