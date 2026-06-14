import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/app_theme.dart';

// ---------------------------------------------------------------------------
// SharedPreferences keys
// ---------------------------------------------------------------------------

const String _kReaderTheme = 'reader_theme';
const String _kFontSize = 'font_size';
const String _kTtsRate = 'tts_rate';
const String _kOnboardingDone = 'onboarding_done';

// ---------------------------------------------------------------------------
// AppProvider
// ---------------------------------------------------------------------------

class AppProvider extends ChangeNotifier {
  // Exposed so theme-picker widgets can iterate all themes without importing
  // app_theme.dart directly.
  static List<ReaderTheme> get _readerThemes => ReaderTheme.values;

  // ── State ─────────────────────────────────────────────────────────────────

  ReaderTheme _readerTheme = ReaderTheme.sepia;
  double _fontSize = 18.0;
  double _ttsRate = 1.0;
  bool _onboardingDone = false;

  bool _initialized = false;

  // ── Getters ───────────────────────────────────────────────────────────────

  ReaderTheme get readerTheme => _readerTheme;
  double get fontSize => _fontSize;
  double get ttsRate => _ttsRate;
  bool get onboardingDone => _onboardingDone;
  bool get initialized => _initialized;

  /// Drives MaterialApp.themeMode — only dark uses ThemeMode.dark; light and
  /// sepia both use ThemeMode.light (sepia is a custom ThemeData).
  ThemeMode get themeMode =>
      _readerTheme == ReaderTheme.dark ? ThemeMode.dark : ThemeMode.light;

  /// Returns the appropriate ThemeData for the current reader theme.
  ThemeData get currentThemeData {
    switch (_readerTheme) {
      case ReaderTheme.light:
        return AppTheme.light;
      case ReaderTheme.sepia:
        return AppTheme.sepia;
      case ReaderTheme.dark:
        return AppTheme.dark;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();

    // Reader theme
    final storedTheme = prefs.getString(_kReaderTheme);
    if (storedTheme != null) {
      _readerTheme = ReaderTheme.values.firstWhere(
        (e) => e.name == storedTheme,
        orElse: () => ReaderTheme.sepia,
      );
    }

    // Font size (clamp to valid range)
    final storedFontSize = prefs.getDouble(_kFontSize);
    if (storedFontSize != null) {
      _fontSize = storedFontSize.clamp(14.0, 24.0);
    }

    // TTS rate
    final storedRate = prefs.getDouble(_kTtsRate);
    if (storedRate != null) {
      _ttsRate = storedRate;
    }

    // Onboarding
    _onboardingDone = prefs.getBool(_kOnboardingDone) ?? false;

    _initialized = true;
    notifyListeners();
  }

  // ── Setters ───────────────────────────────────────────────────────────────

  Future<void> setReaderTheme(ReaderTheme theme) async {
    if (_readerTheme == theme) return;
    _readerTheme = theme;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kReaderTheme, theme.name);
  }

  /// fontSize must be between 14 and 24, stepping by 1.
  Future<void> setFontSize(double size) async {
    final clamped = size.clamp(14.0, 24.0);
    if (_fontSize == clamped) return;
    _fontSize = clamped;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_kFontSize, _fontSize);
  }

  Future<void> increaseFontSize() => setFontSize(_fontSize + 1.0);
  Future<void> decreaseFontSize() => setFontSize(_fontSize - 1.0);

  Future<void> setTtsRate(double rate) async {
    if (_ttsRate == rate) return;
    _ttsRate = rate;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_kTtsRate, _ttsRate);
  }

  Future<void> completeOnboarding() async {
    if (_onboardingDone) return;
    _onboardingDone = true;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kOnboardingDone, true);
  }
}
