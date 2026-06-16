import 'package:flutter_tts/flutter_tts.dart';

// ---------------------------------------------------------------------------
// TtsService
// ---------------------------------------------------------------------------
//
// Wraps flutter_tts for use in the reader.  The service tracks playback state
// and fires callbacks so the UI can react to utterance completion and in-flight
// word highlighting.
// ---------------------------------------------------------------------------

class TtsService {
  // ── Fields ────────────────────────────────────────────────────────────────

  final FlutterTts _tts = FlutterTts();

  bool isPlaying = false;
  bool isPaused = false;

  int currentBlockIndex = 0;
  double rate = 1.0;

  /// Called when an utterance finishes.  Receives the *next* block index so
  /// the reader can advance automatically.
  Function(int nextIndex)? onBlockComplete;

  /// Called on each word boundary with the word text.  Can be used to
  /// highlight the currently spoken word.
  Function(String word)? onWord;

  // ── Init ──────────────────────────────────────────────────────────────────

  Future<void> init() async {
    await _tts.setLanguage('en-US');
    await _tts.setSpeechRate(_normalizeRate(rate));
    await _tts.setVolume(1.0);
    await _tts.setPitch(1.0);

    // Prefer higher-quality voices on iOS (AVSpeechSynthesisVoice).
    await _tts.setSharedInstance(true);

    // Completion handler
    _tts.setCompletionHandler(() {
      isPlaying = false;
      isPaused = false;
      final nextIndex = currentBlockIndex + 1;
      onBlockComplete?.call(nextIndex);
    });

    // Progress / word handler (iOS exposes word ranges)
    _tts.setProgressHandler((String text, int start, int end, String word) {
      onWord?.call(word);
    });

    // Error handler
    _tts.setErrorHandler((dynamic msg) {
      isPlaying = false;
      isPaused = false;
      // ignore: avoid_print
      print('[TtsService] Error: $msg');
    });

    // Cancel handler (e.g. user pressed home)
    _tts.setCancelHandler(() {
      isPlaying = false;
      isPaused = false;
    });
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  /// Speaks [text] after cleaning it.  Optionally overrides [rate].
  Future<void> speak(String text, {double? rate}) async {
    final effectiveRate = rate ?? this.rate;

    if (isPlaying) await _tts.stop();

    await _tts.setSpeechRate(_normalizeRate(effectiveRate));

    final cleaned = cleanForTts(text);
    if (cleaned.trim().isEmpty) {
      // Skip empty blocks and immediately fire completion.
      onBlockComplete?.call(currentBlockIndex + 1);
      return;
    }

    isPlaying = true;
    isPaused = false;

    await _tts.speak(cleaned);
  }

  Future<void> pause() async {
    if (!isPlaying) return;
    await _tts.pause();
    isPlaying = false;
    isPaused = true;
  }

  /// Resumes playback.  Because flutter_tts resume is unreliable on iOS,
  /// callers should re-invoke [speak] with the current block text directly.
  /// This method updates state flags for API completeness.
  Future<void> resume() async {
    if (!isPaused) return;
    isPlaying = true;
    isPaused = false;
    // Callers are expected to call speak() again with the block text.
  }

  Future<void> stop() async {
    await _tts.stop();
    isPlaying = false;
    isPaused = false;
  }

  // ── Rate ──────────────────────────────────────────────────────────────────

  /// The canonical set of TTS rate options exposed to the UI.
  static List<double> get rates => const [0.8, 1.0, 1.2, 1.5, 2.0, 2.5];

  /// Sets the playback rate and persists it for the next utterance.
  Future<void> setRate(double newRate) async {
    rate = newRate;
    await _tts.setSpeechRate(_normalizeRate(newRate));
  }

  /// flutter_tts on iOS expects a rate in [0.0, 1.0] where
  /// AVSpeechUtteranceDefaultSpeechRate ≈ 0.5 (corresponds to our 1.0×).
  /// We map human-readable multipliers: 1.0× → 0.5, 2.0× → 0.75, etc.
  ///   iosRate = 0.5 × humanRate  clamped to [0.1, 1.0]
  double _normalizeRate(double humanRate) {
    return (0.5 * humanRate).clamp(0.1, 1.0);
  }

  // ── Text cleaning ─────────────────────────────────────────────────────────

  /// Removes academic noise that sounds unpleasant when read aloud:
  ///
  ///   • Bracketed numeric citations: [1], [1,2], [1-3], [1, 2, 3], etc.
  ///   • Parenthetical author-year citations: (Smith et al., 2024)
  ///   • Bare URLs starting with https:// or http://
  ///   • DOIs (doi: 10.xxxx/...)
  ///   • Excess whitespace left behind
  String cleanForTts(String text) {
    var cleaned = text;

    // Bracketed citations: [1], [2,3], [1–3], [1, 2, 3], etc.
    // Only strips brackets whose entire content is digits, commas, spaces,
    // hyphens, and en-dashes — avoids stripping [emphasis mine].
    cleaned = cleaned.replaceAll(
      RegExp(r'\[\s*\d+(?:\s*[,–\-]\s*\d+)*\s*\]'),
      '',
    );

    // Parenthetical author-year citations.
    // Matches: (Smith, 2024), (Smith et al., 2024), (Smith & Jones, 2024),
    //          (Smith, 2024; Jones, 2023), etc.
    cleaned = cleaned.replaceAll(
      RegExp(
        r'\(\s*[A-Z][A-Za-zéàü\-]+'
        r'(?:\s+et\s+al\.?)?'
        r'(?:\s*[,&]\s*[A-Z][A-Za-zéàü\-]+)?'
        r'(?:\s*,\s*(?:19|20)\d{2}[a-z]?)'
        r'(?:\s*;\s*[A-Z][A-Za-zéàü\-]+'
        r'(?:\s+et\s+al\.?)?'
        r'(?:\s*,\s*(?:19|20)\d{2}[a-z]?))*\s*\)',
      ),
      '',
    );

    // URLs — https:// or http:// through end-of-word
    cleaned = cleaned.replaceAll(
      RegExp(r'https?://\S+', caseSensitive: false),
      '',
    );

    // DOIs
    cleaned = cleaned.replaceAll(
      RegExp(r'\bdoi:\s*\S+', caseSensitive: false),
      '',
    );

    // Markdown bold/italic markers
    cleaned = cleaned.replaceAll(RegExp(r'\*{1,3}'), '');

    // Collapse newlines to spaces
    cleaned = cleaned.replaceAll(RegExp(r'\n+'), ' ');

    // Collapse multiple spaces and trim
    cleaned = cleaned.replaceAll(RegExp(r' {2,}'), ' ').trim();

    return cleaned;
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  Future<void> dispose() async {
    await _tts.stop();
  }
}
