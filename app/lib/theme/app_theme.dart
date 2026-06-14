import 'package:flutter/material.dart';

// ---------------------------------------------------------------------------
// Reader theme enum
// ---------------------------------------------------------------------------

enum ReaderTheme { light, sepia, dark }

// ---------------------------------------------------------------------------
// Palette constants
// ---------------------------------------------------------------------------

class _LightPalette {
  static const Color bg = Color(0xFFFAFAF9);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color fg = Color(0xFF1C1C1A);
  static const Color fg2 = Color(0xFF585854);
  static const Color muted = Color(0xFFA0A09A);
  static const Color accent = Color(0xFF1C1C1A);
  static const Color border = Color(0xFFE7E6E2);
}

class _SepiaPalette {
  static const Color bg = Color(0xFFF4EEE2);
  static const Color surface = Color(0xFFFBF6EC);
  static const Color fg = Color(0xFF2E2A23);
  static const Color fg2 = Color(0xFF6B6357);
  static const Color muted = Color(0xFFA69D8D);
  static const Color accent = Color(0xFF3A342C);
  static const Color border = Color(0xFFE3D9C7);
}

class _DarkPalette {
  static const Color bg = Color(0xFF141414);
  static const Color surface = Color(0xFF1A1A1A);
  static const Color fg = Color(0xFFE4E2DC);
  static const Color fg2 = Color(0xFF9E9C95);
  static const Color muted = Color(0xFF6E6C65);
  static const Color accent = Color(0xFFE4E2DC);
  static const Color border = Color(0xFF2E2E2C);
}

// ---------------------------------------------------------------------------
// AppTheme
// ---------------------------------------------------------------------------

class AppTheme {
  AppTheme._();

  // ── Light ─────────────────────────────────────────────────────────────────

  static ThemeData get light => _build(
        brightness: Brightness.light,
        bg: _LightPalette.bg,
        surface: _LightPalette.surface,
        fg: _LightPalette.fg,
        fg2: _LightPalette.fg2,
        muted: _LightPalette.muted,
        accent: _LightPalette.accent,
        border: _LightPalette.border,
      );

  // ── Sepia ─────────────────────────────────────────────────────────────────

  static ThemeData get sepia => _build(
        brightness: Brightness.light,
        bg: _SepiaPalette.bg,
        surface: _SepiaPalette.surface,
        fg: _SepiaPalette.fg,
        fg2: _SepiaPalette.fg2,
        muted: _SepiaPalette.muted,
        accent: _SepiaPalette.accent,
        border: _SepiaPalette.border,
      );

  // ── Dark ──────────────────────────────────────────────────────────────────

  static ThemeData get dark => _build(
        brightness: Brightness.dark,
        bg: _DarkPalette.bg,
        surface: _DarkPalette.surface,
        fg: _DarkPalette.fg,
        fg2: _DarkPalette.fg2,
        muted: _DarkPalette.muted,
        accent: _DarkPalette.accent,
        border: _DarkPalette.border,
      );

  // ── Shared builder ────────────────────────────────────────────────────────

  static ThemeData _build({
    required Brightness brightness,
    required Color bg,
    required Color surface,
    required Color fg,
    required Color fg2,
    required Color muted,
    required Color accent,
    required Color border,
  }) {
    final isLight = brightness == Brightness.light;

    final colorScheme = ColorScheme(
      brightness: brightness,
      // Primary = accent color used for interactive elements
      primary: accent,
      onPrimary: isLight ? const Color(0xFFFFFFFF) : const Color(0xFF141414),
      primaryContainer: surface,
      onPrimaryContainer: fg,
      // Secondary = subdued tone
      secondary: fg2,
      onSecondary: surface,
      secondaryContainer: border,
      onSecondaryContainer: fg,
      // Surface
      surface: surface,
      onSurface: fg,
      surfaceContainerHighest: bg,
      onSurfaceVariant: fg2,
      // Outline
      outline: border,
      outlineVariant: border.withAlpha(128),
      // Error
      error: const Color(0xFFB00020),
      onError: const Color(0xFFFFFFFF),
      errorContainer: const Color(0xFFFFDAD4),
      onErrorContainer: const Color(0xFF410002),
      // Inverse
      inverseSurface: fg,
      onInverseSurface: surface,
      inversePrimary: muted,
      // Scrim / shadow
      scrim: const Color(0xFF000000),
      shadow: const Color(0xFF000000),
    );

    final textTheme = TextTheme(
      // Display / large headings
      displayLarge: TextStyle(
        fontSize: 32,
        fontWeight: FontWeight.w300,
        letterSpacing: -0.5,
        color: fg,
        height: 1.2,
      ),
      displayMedium: TextStyle(
        fontSize: 28,
        fontWeight: FontWeight.w300,
        letterSpacing: -0.25,
        color: fg,
        height: 1.25,
      ),
      displaySmall: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w400,
        color: fg,
        height: 1.3,
      ),
      // Headline
      headlineLarge: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.15,
        color: fg,
        height: 1.3,
      ),
      headlineMedium: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.1,
        color: fg,
        height: 1.35,
      ),
      headlineSmall: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w500,
        color: fg,
        height: 1.4,
      ),
      // Title
      titleLarge: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.1,
        color: fg,
        height: 1.45,
      ),
      titleMedium: TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.1,
        color: fg,
        height: 1.5,
      ),
      titleSmall: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.1,
        color: fg2,
        height: 1.5,
      ),
      // Body
      bodyLarge: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.05,
        color: fg,
        height: 1.65,
      ),
      bodyMedium: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.05,
        color: fg,
        height: 1.6,
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.1,
        color: fg2,
        height: 1.55,
      ),
      // Label
      labelLarge: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.1,
        color: fg,
        height: 1.4,
      ),
      labelMedium: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.4,
        color: fg2,
        height: 1.4,
      ),
      labelSmall: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.5,
        color: muted,
        height: 1.4,
      ),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      cardColor: surface,
      dividerColor: border,
      textTheme: textTheme,
      primaryTextTheme: textTheme,
      // AppBar
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        foregroundColor: fg,
        iconTheme: IconThemeData(color: fg, size: 22),
        actionsIconTheme: IconThemeData(color: fg2, size: 22),
        titleTextStyle: TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.1,
          color: fg,
        ),
        centerTitle: true,
      ),
      // Card
      cardTheme: CardTheme(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: border, width: 1),
        ),
        margin: EdgeInsets.zero,
      ),
      // Divider
      dividerTheme: DividerThemeData(
        color: border,
        thickness: 1,
        space: 1,
      ),
      // Icon
      iconTheme: IconThemeData(color: fg2, size: 22),
      // Input decoration
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: accent, width: 1.5),
        ),
        hintStyle: TextStyle(color: muted, fontSize: 15),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      // Elevated button
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: isLight ? Colors.white : const Color(0xFF141414),
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      // Text button
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: accent,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        ),
      ),
      // Bottom sheet
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        elevation: 0,
      ),
      // List tile
      listTileTheme: ListTileThemeData(
        tileColor: Colors.transparent,
        iconColor: fg2,
        textColor: fg,
        subtitleTextStyle: TextStyle(color: fg2, fontSize: 13),
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
      ),
      // Slider
      sliderTheme: SliderThemeData(
        activeTrackColor: accent,
        inactiveTrackColor: border,
        thumbColor: accent,
        overlayColor: accent.withAlpha(30),
        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
        trackHeight: 3,
      ),
      // Snack bar
      snackBarTheme: SnackBarThemeData(
        backgroundColor: fg,
        contentTextStyle: TextStyle(color: surface, fontSize: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        behavior: SnackBarBehavior.floating,
      ),
      // Page transitions
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
        },
      ),
    );
  }
}
