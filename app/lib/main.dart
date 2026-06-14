import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'models/book.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // ── Portrait-only orientation ─────────────────────────────────────────────
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // ── Transparent status bar, dark icons ────────────────────────────────────
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
    ),
  );

  // ── Hive ──────────────────────────────────────────────────────────────────
  await Hive.initFlutter();

  // Register all type adapters (manually written in book.dart).
  if (!Hive.isAdapterRegistered(0)) Hive.registerAdapter(BookAdapter());
  if (!Hive.isAdapterRegistered(1)) Hive.registerAdapter(BookBlockAdapter());
  if (!Hive.isAdapterRegistered(2)) Hive.registerAdapter(HighlightAdapter());

  // Open the books box.
  await Hive.openBox<Book>('books');

  // ── Onboarding check ─────────────────────────────────────────────────────
  final prefs = await SharedPreferences.getInstance();
  final isFirstLaunch = !(prefs.getBool('onboarding_done') ?? false);

  // ── Launch ────────────────────────────────────────────────────────────────
  runApp(PaperShelfApp(isFirstLaunch: isFirstLaunch));
}
