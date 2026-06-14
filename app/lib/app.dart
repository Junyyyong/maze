import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'providers/app_provider.dart';
import 'theme/app_theme.dart';
import 'screens/splash_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/library_screen.dart';
import 'screens/reader_screen.dart';

// ---------------------------------------------------------------------------
// PaperShelfApp
// ---------------------------------------------------------------------------

class PaperShelfApp extends StatefulWidget {
  /// True when the user has never completed onboarding.
  final bool isFirstLaunch;

  const PaperShelfApp({super.key, required this.isFirstLaunch});

  @override
  State<PaperShelfApp> createState() => _PaperShelfAppState();
}

class _PaperShelfAppState extends State<PaperShelfApp> {
  late final AppProvider _appProvider;

  @override
  void initState() {
    super.initState();
    _appProvider = AppProvider();
    // Load persisted preferences asynchronously; the app starts before they
    // arrive but AppProvider.notifyListeners() triggers a rebuild once done.
    _appProvider.init();
  }

  @override
  void dispose() {
    _appProvider.dispose();
    super.dispose();
  }

  // ── Route factory ─────────────────────────────────────────────────────────

  Route<dynamic> _onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case '/splash':
        return MaterialPageRoute(
          builder: (_) => const SplashScreen(),
          settings: settings,
        );
      case '/onboarding':
        return MaterialPageRoute(
          builder: (_) => const OnboardingScreen(),
          settings: settings,
        );
      case '/library':
        return MaterialPageRoute(
          builder: (_) => const LibraryScreen(),
          settings: settings,
        );
      case '/reader':
        return MaterialPageRoute(
          builder: (_) => const ReaderScreen(),
          settings: settings,
        );
      default:
        // Fallback: always go to the splash which handles routing logic.
        return MaterialPageRoute(
          builder: (_) => const SplashScreen(),
          settings: settings,
        );
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<AppProvider>.value(
      value: _appProvider,
      child: Consumer<AppProvider>(
        builder: (context, provider, _) {
          // Derive the light-mode ThemeData from the reader theme.
          // For sepia we supply a custom ThemeData as the light theme; for
          // dark we supply the dark ThemeData as both darkTheme and flip
          // themeMode to dark.
          final ThemeData lightTheme;
          final ThemeData darkTheme;

          switch (provider.readerTheme) {
            case ReaderTheme.light:
              lightTheme = AppTheme.light;
              darkTheme = AppTheme.dark;
            case ReaderTheme.sepia:
              lightTheme = AppTheme.sepia;
              darkTheme = AppTheme.dark;
            case ReaderTheme.dark:
              lightTheme = AppTheme.dark;
              darkTheme = AppTheme.dark;
          }

          return MaterialApp(
            title: 'Paper Shelf',
            debugShowCheckedModeBanner: false,
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: provider.themeMode,
            initialRoute: '/splash',
            onGenerateRoute: _onGenerateRoute,
            // Pass the first-launch flag so SplashScreen can decide where to go.
            builder: (context, child) {
              return _FirstLaunchScope(
                isFirstLaunch: widget.isFirstLaunch,
                child: child!,
              );
            },
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _FirstLaunchScope
// ---------------------------------------------------------------------------
// Provides the isFirstLaunch flag to descendants via an InheritedWidget so
// SplashScreen can read it without needing a constructor argument.
// ---------------------------------------------------------------------------

class _FirstLaunchScope extends InheritedWidget {
  final bool isFirstLaunch;

  const _FirstLaunchScope({
    required this.isFirstLaunch,
    required super.child,
  });

  static _FirstLaunchScope? of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<_FirstLaunchScope>();
  }

  @override
  bool updateShouldNotify(_FirstLaunchScope oldWidget) {
    return oldWidget.isFirstLaunch != isFirstLaunch;
  }
}

// ---------------------------------------------------------------------------
// Extension so screens can access isFirstLaunch easily
// ---------------------------------------------------------------------------

extension FirstLaunchContext on BuildContext {
  bool get isFirstLaunch => _FirstLaunchScope.of(this)?.isFirstLaunch ?? false;
}
