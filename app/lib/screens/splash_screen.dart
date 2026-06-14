import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ---------------------------------------------------------------------------
// SplashScreen
// ---------------------------------------------------------------------------
//
// Entry point of the app.  Shown for ~2.2 s while we read SharedPreferences
// to decide whether to go to onboarding or straight to the library.
//
// Animation: the logo group fades in and translates upward (+16 px → 0) over
// 600 ms with a 200 ms delay, producing a gentle "lift" effect.
// ---------------------------------------------------------------------------

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fadeAnimation;
  late final Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );

    _fadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    );

    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.06), // 16 px / ~270 px screen ≈ 0.06
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOut));

    // Start animation after a brief initial delay.
    Future.delayed(const Duration(milliseconds: 200), () {
      if (mounted) _controller.forward();
    });

    // Navigate after 2.2 s total.
    Future.delayed(const Duration(milliseconds: 2200), _navigate);
  }

  Future<void> _navigate() async {
    if (!mounted) return;
    final prefs = await SharedPreferences.getInstance();
    final onboardingDone = prefs.getBool('onboarding_done') ?? false;
    if (!mounted) return;
    Navigator.of(context).pushReplacementNamed(
      onboardingDone ? '/library' : '/onboarding',
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bg = Theme.of(context).scaffoldBackgroundColor;
    final fg = colorScheme.onSurface;
    final muted = colorScheme.onSurfaceVariant;

    return Scaffold(
      backgroundColor: bg,
      body: Center(
        child: FadeTransition(
          opacity: _fadeAnimation,
          child: SlideTransition(
            position: _slideAnimation,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // ── Book icon placeholder ────────────────────────────────────
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: colorScheme.outline, width: 1),
                    color: colorScheme.surface,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    'P',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w500,
                      color: fg,
                      height: 1,
                      // Serif font on platforms that support it.
                      fontFamily: 'Georgia',
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // ── App name ─────────────────────────────────────────────────
                Text(
                  'Paper Shelf',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w500,
                    color: fg,
                    height: 1.2,
                    fontFamily: 'Georgia',
                    fontFamilyFallback: const ['Palatino', 'serif'],
                  ),
                ),
                const SizedBox(height: 6),
                // ── Subtitle ─────────────────────────────────────────────────
                Text(
                  'PDF Reader',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w400,
                    color: muted,
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
