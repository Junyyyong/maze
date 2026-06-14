import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

// ---------------------------------------------------------------------------
// TtsService
// ---------------------------------------------------------------------------
//
// Thin, reactive wrapper around flutter_tts.  Consumers call speak(), pause(),
// resume(), stop() and observe isPlaying / isPaused via ChangeNotifier.
// An optional onBlockComplete callback fires when the engine finishes speaking
// the current utterance so the reader can advance to the next block.
// ---------------------------------------------------------------------------

class TtsService extends ChangeNotifier {
  TtsService() {
    _init();
  }

  // ── Constants ─────────────────────────────────────────────────────────────

  static const List<double> rates = [0.8, 1.0, 1.2, 1.5, 2.0, 2.5];

  // ── Private state ─────────────────────────────────────────────────────────

  final FlutterTts _tts = FlutterTts();
  bool _isPlaying = false;
  bool _isPaused = false;
  double _rate = 1.0;

  /// Called when the TTS engine finishes the current utterance naturally
  /// (i.e., not because stop() was called).
  VoidCallback? onBlockComplete;

  // ── Getters ───────────────────────────────────────────────────────────────

  bool get isPlaying => _isPlaying;
  bool get isPaused => _isPaused;
  double get rate => _rate;

  // ── Initialisation ────────────────────────────────────────────────────────

  Future<void> _init() async {
    await _tts.setLanguage('ko-KR');
    await _tts.setSpeechRate(_rate);
    await _tts.setVolume(1.0);
    await _tts.setPitch(1.0);

    _tts.setStartHandler(() {
      _isPlaying = true;
      _isPaused = false;
      notifyListeners();
    });

    _tts.setCompletionHandler(() {
      _isPlaying = false;
      _isPaused = false;
      notifyListeners();
      onBlockComplete?.call();
    });

    _tts.setPauseHandler(() {
      _isPaused = true;
      notifyListeners();
    });

    _tts.setContinueHandler(() {
      _isPaused = false;
      notifyListeners();
    });

    _tts.setErrorHandler((message) {
      _isPlaying = false;
      _isPaused = false;
      notifyListeners();
      debugPrint('[TtsService] error: $message');
    });

    _tts.setCancelHandler(() {
      _isPlaying = false;
      _isPaused = false;
      notifyListeners();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  Future<void> speak(String text) async {
    final cleaned = cleanForTts(text);
    if (cleaned.isEmpty) {
      onBlockComplete?.call();
      return;
    }
    await _tts.stop();
    await _tts.speak(cleaned);
  }

  Future<void> pause() async {
    if (!_isPlaying || _isPaused) return;
    await _tts.pause();
  }

  Future<void> resume() async {
    if (!_isPaused) return;
    await _tts.speak(''); // flutter_tts resume is platform-specific
    // On iOS, we re-speak; the state handlers update _isPaused.
  }

  Future<void> stop() async {
    // Nullify the callback before stopping so we don't auto-advance.
    final savedCallback = onBlockComplete;
    onBlockComplete = null;
    await _tts.stop();
    _isPlaying = false;
    _isPaused = false;
    notifyListeners();
    // Restore after stop so caller can re-attach.
    onBlockComplete = savedCallback;
  }

  Future<void> setRate(double rate) async {
    _rate = rate;
    await _tts.setSpeechRate(rate);
    notifyListeners();
  }

  // ── Text cleaning ─────────────────────────────────────────────────────────

  /// Strips markdown-style symbols, footnote markers, URLs, and excess
  /// whitespace so the TTS engine reads natural prose.
  String cleanForTts(String text) {
    var result = text;

    // Remove URLs
    result = result.replaceAll(RegExp(r'https?://\S+'), '');

    // Remove markdown bold/italic markers
    result = result.replaceAll(RegExp(r'\*{1,3}'), '');
    result = result.replaceAll(RegExp(r'_{1,3}'), '');

    // Remove footnote markers like [1], [2,3], (1)
    result = result.replaceAll(RegExp(r'\[\d+(?:,\s*\d+)*\]'), '');
    result = result.replaceAll(RegExp(r'\(\d+\)'), '');

    // Remove standalone numbers that look like footnote refs at word boundary
    result = result.replaceAll(RegExp(r'(?<=\w)\^\d+'), '');

    // Collapse multiple spaces / newlines
    result = result.replaceAll(RegExp(r'\n+'), ' ');
    result = result.replaceAll(RegExp(r'  +'), ' ');

    return result.trim();
  }

  @override
  void dispose() {
    _tts.stop();
    super.dispose();
  }
}
