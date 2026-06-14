import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/book.dart';
import '../providers/app_provider.dart';
import '../services/storage_service.dart';
import '../services/tts_service.dart';
import '../theme/app_theme.dart';

// ---------------------------------------------------------------------------
// ReaderScreen
// ---------------------------------------------------------------------------

class ReaderScreen extends StatefulWidget {
  const ReaderScreen({super.key});

  @override
  State<ReaderScreen> createState() => _ReaderScreenState();
}

class _ReaderScreenState extends State<ReaderScreen>
    with TickerProviderStateMixin {
  // ── Book ──────────────────────────────────────────────────────────────────

  late Book _book;
  bool _bookInitialized = false;

  // ── Scroll ────────────────────────────────────────────────────────────────

  final ScrollController _scrollController = ScrollController();

  /// One GlobalKey per block so we can scroll to them with ensureVisible.
  late List<GlobalKey> _blockKeys;

  // ── UI visibility ─────────────────────────────────────────────────────────

  bool _showUi = true;

  // ── TTS ───────────────────────────────────────────────────────────────────

  late TtsService _tts;

  /// Index of the block currently being spoken; -1 = stopped.
  int _ttsBlockIdx = -1;

  /// Mirrors _tts.isPlaying so setState can trigger redraws.
  bool _ttsIsPlaying = false;
  bool _ttsIsPaused = false;

  /// The rate displayed in the speed chip.
  double _ttsRate = 1.0;

  // ── Panels ────────────────────────────────────────────────────────────────

  bool _showToc = false;
  bool _showHighlights = false;

  // ── Font size ─────────────────────────────────────────────────────────────

  /// Kept in sync with AppProvider on each build; local copy avoids
  /// context.read inside build methods that rebuild frequently.
  double _fontSize = 18.0;

  static const List<double> _fontSizes = [14, 16, 18, 20, 22, 24];

  // ── Selection / highlight ─────────────────────────────────────────────────

  String? _selectionText;
  int? _selectionBlockIndex;

  // ── Services ──────────────────────────────────────────────────────────────

  final StorageService _storage = StorageService();

  // ── Animation – wave bars ─────────────────────────────────────────────────

  late AnimationController _waveController;

  // ── Progress save throttle ────────────────────────────────────────────────

  int _lastProgressSaveMs = 0;
  static const int _progressSaveIntervalMs = 2000;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  @override
  void initState() {
    super.initState();

    _waveController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    )..repeat(reverse: true);

    _tts = TtsService();
    _tts.init();

    _scrollController.addListener(_onScroll);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();

    if (!_bookInitialized) {
      _book = ModalRoute.of(context)!.settings.arguments as Book;
      _blockKeys = List.generate(_book.blocks.length, (_) => GlobalKey());
      _bookInitialized = true;

      final provider = context.read<AppProvider>();
      _fontSize = provider.fontSize;
      _ttsRate = provider.ttsRate;

      // Restore reading position after first frame.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _restoreScrollPosition();
      });
    }
  }

  @override
  void dispose() {
    _waveController.dispose();
    _scrollController.dispose();
    _tts.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Scroll / progress tracking
  // ---------------------------------------------------------------------------

  void _onScroll() {
    if (!mounted) return;

    final idx = _firstVisibleBlockIndex();
    if (idx >= 0 && idx != _book.currentBlockIndex) {
      _book.currentBlockIndex = idx;
    }

    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (nowMs - _lastProgressSaveMs >= _progressSaveIntervalMs) {
      _lastProgressSaveMs = nowMs;
      final visibleIdx = idx >= 0 ? idx : _book.currentBlockIndex;
      final progress = _book.blocks.isEmpty
          ? 0.0
          : (visibleIdx / _book.blocks.length).clamp(0.0, 1.0);
      _storage.updateProgress(_book.id, visibleIdx, progress);
    }
  }

  int _firstVisibleBlockIndex() {
    final screenH = MediaQuery.of(context).size.height;
    for (int i = 0; i < _blockKeys.length; i++) {
      final ctx = _blockKeys[i].currentContext;
      if (ctx == null) continue;
      final box = ctx.findRenderObject() as RenderBox?;
      if (box == null || !box.attached) continue;
      final topY = box.localToGlobal(Offset.zero).dy;
      if (topY >= 0 && topY < screenH * 0.65) return i;
    }
    return -1;
  }

  Future<void> _restoreScrollPosition() async {
    final target = _book.currentBlockIndex;
    if (target <= 0 || target >= _blockKeys.length) return;
    // Give the list time to lay out.
    await Future<void>.delayed(const Duration(milliseconds: 250));
    if (!mounted) return;
    _scrollToBlock(target, animate: false);
  }

  void _scrollToBlock(int idx, {bool animate = true}) {
    if (idx < 0 || idx >= _blockKeys.length) return;
    final ctx = _blockKeys[idx].currentContext;
    if (ctx == null) return;
    if (animate) {
      Scrollable.ensureVisible(
        ctx,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
        alignment: 0.15,
      );
    } else {
      Scrollable.ensureVisible(ctx, alignment: 0.15);
    }
  }

  // ---------------------------------------------------------------------------
  // TTS
  // ---------------------------------------------------------------------------

  Future<void> _ttsPlayFrom(int idx) async {
    if (idx >= _book.blocks.length) {
      await _ttsStopAll();
      return;
    }

    final block = _book.blocks[idx];

    // Skip figure captions silently.
    if (block.type == 'fig') {
      await _ttsPlayFrom(idx + 1);
      return;
    }

    // Stop at references / bibliography heading.
    final lower = block.text.toLowerCase();
    if ((block.type == 'h2' || block.type == 'h3') &&
        (lower.contains('references') ||
            lower.contains('bibliography') ||
            lower.contains('참고문헌'))) {
      await _ttsStopAll();
      return;
    }

    // Wire up the "done with this block → go to next" callback.
    _tts.onBlockComplete = (int nextIdx) {
      if (mounted) {
        setState(() {
          _ttsIsPlaying = _tts.isPlaying;
          _ttsIsPaused = _tts.isPaused;
        });
        _ttsPlayFrom(nextIdx);
      }
    };

    _tts.currentBlockIndex = idx;

    setState(() {
      _ttsBlockIdx = idx;
      _ttsIsPlaying = true;
      _ttsIsPaused = false;
    });

    await _tts.speak(block.text, rate: _ttsRate);

    // Scroll the active block into view after the frame is painted.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _scrollToBlock(idx);
    });
  }

  Future<void> _ttsTogglePlayPause() async {
    if (_ttsBlockIdx < 0) {
      // Not started yet – begin from current reading position.
      await _ttsPlayFrom(_book.currentBlockIndex);
      return;
    }

    if (_ttsIsPaused) {
      // Resume by re-speaking the current block.
      await _tts.resume();
      setState(() {
        _ttsIsPlaying = true;
        _ttsIsPaused = false;
      });
      await _tts.speak(_book.blocks[_ttsBlockIdx].text, rate: _ttsRate);
    } else if (_ttsIsPlaying) {
      await _tts.pause();
      setState(() {
        _ttsIsPlaying = false;
        _ttsIsPaused = true;
      });
    } else {
      // Engine stopped naturally (e.g. error) but index is set; restart block.
      await _ttsPlayFrom(_ttsBlockIdx);
    }
  }

  Future<void> _ttsPrev() async {
    final newIdx = math.max(0, _ttsBlockIdx - 1);
    await _ttsPlayFrom(newIdx);
  }

  Future<void> _ttsNext() async {
    await _ttsPlayFrom(_ttsBlockIdx + 1);
  }

  Future<void> _ttsStopAll() async {
    _tts.onBlockComplete = null;
    await _tts.stop();
    setState(() {
      _ttsBlockIdx = -1;
      _ttsIsPlaying = false;
      _ttsIsPaused = false;
    });
  }

  Future<void> _cycleRate() async {
    final idx = TtsService.rates.indexOf(_ttsRate);
    final nextIdx = (idx + 1) % TtsService.rates.length;
    final newRate = TtsService.rates[nextIdx];
    setState(() => _ttsRate = newRate);
    await _tts.setRate(newRate);
    if (mounted) context.read<AppProvider>().setTtsRate(newRate);
  }

  // ---------------------------------------------------------------------------
  // Font size cycling
  // ---------------------------------------------------------------------------

  void _cycleFontSize() {
    final idx = _fontSizes.indexOf(_fontSize);
    final nextIdx = (idx + 1) % _fontSizes.length;
    final newSize = _fontSizes[nextIdx];
    setState(() => _fontSize = newSize);
    context.read<AppProvider>().setFontSize(newSize);
  }

  // ---------------------------------------------------------------------------
  // Theme cycling
  // ---------------------------------------------------------------------------

  void _cycleTheme() {
    final provider = context.read<AppProvider>();
    final next = ReaderTheme
        .values[(provider.readerTheme.index + 1) % ReaderTheme.values.length];
    provider.setReaderTheme(next);
  }

  // ---------------------------------------------------------------------------
  // Highlight creation
  // ---------------------------------------------------------------------------

  void _commitHighlight() {
    final text = _selectionText;
    final blockIdx = _selectionBlockIndex;
    setState(() => _selectionText = null);

    if (text == null || text.trim().isEmpty || blockIdx == null) return;

    final highlight = Highlight(
      id: '${DateTime.now().millisecondsSinceEpoch}_$blockIdx',
      blockIndex: blockIdx,
      selectedText: text.trim(),
      note: '',
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );

    setState(() {
      _book.highlights = [..._book.highlights, highlight];
    });

    _storage.saveBook(_book);

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('하이라이트가 저장되었습니다',
            style: TextStyle(color: _bgColor(context))),
        backgroundColor: _fgColor(context),
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Back navigation
  // ---------------------------------------------------------------------------

  Future<bool> _onWillPop() async {
    await _ttsStopAll();
    final visibleIdx = _firstVisibleBlockIndex();
    final saveIdx =
        visibleIdx >= 0 ? visibleIdx : _book.currentBlockIndex;
    final progress = _book.blocks.isEmpty
        ? 0.0
        : (saveIdx / _book.blocks.length).clamp(0.0, 1.0);
    await _storage.updateProgress(_book.id, saveIdx, progress);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Theme helpers (pure functions; take context so they watch provider)
  // ---------------------------------------------------------------------------

  ReaderTheme _theme(BuildContext context) =>
      context.watch<AppProvider>().readerTheme;

  Color _bgColor(BuildContext context) {
    switch (_theme(context)) {
      case ReaderTheme.light:
        return const Color(0xFFFFFFFF);
      case ReaderTheme.sepia:
        return const Color(0xFFFBF6EC);
      case ReaderTheme.dark:
        return const Color(0xFF1A1A1A);
    }
  }

  Color _fgColor(BuildContext context) {
    switch (_theme(context)) {
      case ReaderTheme.light:
        return const Color(0xFF1C1C1A);
      case ReaderTheme.sepia:
        return const Color(0xFF2E2A23);
      case ReaderTheme.dark:
        return const Color(0xFFE4E2DC);
    }
  }

  Color _fg2Color(BuildContext context) {
    switch (_theme(context)) {
      case ReaderTheme.light:
        return const Color(0xFF585854);
      case ReaderTheme.sepia:
        return const Color(0xFF6B6357);
      case ReaderTheme.dark:
        return const Color(0xFF9E9C95);
    }
  }

  Color _mutedColor(BuildContext context) {
    switch (_theme(context)) {
      case ReaderTheme.light:
        return const Color(0xFFA0A09A);
      case ReaderTheme.sepia:
        return const Color(0xFFA69D8D);
      case ReaderTheme.dark:
        return const Color(0xFF6E6C65);
    }
  }

  Color _borderColor(BuildContext context) {
    switch (_theme(context)) {
      case ReaderTheme.light:
        return const Color(0xFFE7E6E2);
      case ReaderTheme.sepia:
        return const Color(0xFFE3D9C7);
      case ReaderTheme.dark:
        return const Color(0xFF2E2E2C);
    }
  }

  // accent == fg (monotone minimalism).
  Color _accentColor(BuildContext context) => _fgColor(context);

  Color _toolbarBg(BuildContext context) => _bgColor(context).withOpacity(0.92);

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    // Watch provider so that theme / fontSize changes trigger rebuild.
    final provider = context.watch<AppProvider>();
    _fontSize = provider.fontSize;

    final safeArea = MediaQuery.of(context).padding;
    final screenWidth = MediaQuery.of(context).size.width;
    final ttsBarVisible = _ttsBlockIdx >= 0;

    // Bottom padding for content: toolbar + optional TTS bar + progress bar.
    final double bottomContentPad =
        56.0 + (ttsBarVisible ? 64.0 : 0.0) + 2.0 + safeArea.bottom;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (!didPop) {
          final ok = await _onWillPop();
          if (ok && context.mounted) Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        backgroundColor: _bgColor(context),
        body: Stack(
          children: [
            // ── 1. Main content ─────────────────────────────────────────────
            SelectionArea(
              onSelectionChanged: (value) {
                final text = value?.plainText ?? '';
                if (text != (_selectionText ?? '')) {
                  setState(() {
                    _selectionText = text.isEmpty ? null : text;
                  });
                }
              },
              child: SingleChildScrollView(
                controller: _scrollController,
                physics: const BouncingScrollPhysics(),
                child: Padding(
                  padding: EdgeInsets.only(
                    top: kToolbarHeight + safeArea.top + 16,
                    left: _horizontalPadding(screenWidth),
                    right: _horizontalPadding(screenWidth),
                    bottom: bottomContentPad,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: List.generate(
                      _book.blocks.length,
                      (i) => _buildBlock(context, _book.blocks[i], i),
                    ),
                  ),
                ),
              ),
            ),

            // ── 2. Highlight creation button ────────────────────────────────
            if (_selectionText != null && _selectionText!.trim().isNotEmpty)
              _buildHighlightButton(context),

            // ── 3. Top bar ──────────────────────────────────────────────────
            _buildTopBar(context, safeArea),

            // ── 4. Progress bar (always visible, 2px at very bottom) ────────
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SizedBox(
                height: 2,
                child: LinearProgressIndicator(
                  value: _book.progress,
                  backgroundColor: _borderColor(context),
                  color: _accentColor(context),
                  minHeight: 2,
                ),
              ),
            ),

            // ── 5. Bottom toolbar ───────────────────────────────────────────
            _buildBottomToolbar(context, safeArea, ttsBarVisible),

            // ── 6. TTS bar ──────────────────────────────────────────────────
            if (ttsBarVisible) _buildTtsBar(context, safeArea),

            // ── 7. TOC panel ────────────────────────────────────────────────
            if (_showToc) ...[
              GestureDetector(
                onTap: () => setState(() => _showToc = false),
                child: Container(color: Colors.black.withOpacity(0.35)),
              ),
              _buildTocPanel(context, safeArea),
            ],

            // ── 8. Highlights panel ─────────────────────────────────────────
            if (_showHighlights) ...[
              GestureDetector(
                onTap: () => setState(() => _showHighlights = false),
                child: Container(color: Colors.black.withOpacity(0.35)),
              ),
              _buildHighlightsPanel(context, safeArea),
            ],
          ],
        ),
      ),
    );
  }

  double _horizontalPadding(double screenWidth) {
    if (screenWidth > 700) return (screenWidth - 660) / 2;
    return 24.0;
  }

  // ---------------------------------------------------------------------------
  // Block rendering
  // ---------------------------------------------------------------------------

  Widget _buildBlock(BuildContext context, BookBlock block, int index) {
    final bool active = _ttsBlockIdx == index;
    final fg = _fgColor(context);
    final fg2 = _fg2Color(context);
    final muted = _mutedColor(context);
    final accent = _accentColor(context);

    late Widget content;

    switch (block.type) {
      case 'h2':
        content = Padding(
          padding: const EdgeInsets.only(top: 28, bottom: 8),
          child: SelectableText(
            block.text,
            onSelectionChanged: (sel, _) {
              if (sel.baseOffset != sel.extentOffset) {
                setState(() => _selectionBlockIndex = index);
              }
            },
            style: TextStyle(
              fontSize: _fontSize * 1.26,
              fontWeight: FontWeight.w700,
              fontFamily: 'Georgia',
              color: fg,
              height: 1.3,
            ),
          ),
        );

      case 'h3':
        content = Padding(
          padding: const EdgeInsets.only(top: 20, bottom: 6),
          child: SelectableText(
            block.text,
            onSelectionChanged: (sel, _) {
              if (sel.baseOffset != sel.extentOffset) {
                setState(() => _selectionBlockIndex = index);
              }
            },
            style: TextStyle(
              fontSize: _fontSize * 1.1,
              fontWeight: FontWeight.w700,
              color: fg2,
              height: 1.35,
            ),
          ),
        );

      case 'fig':
        content = Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: SelectableText(
            block.text,
            onSelectionChanged: (sel, _) {
              if (sel.baseOffset != sel.extentOffset) {
                setState(() => _selectionBlockIndex = index);
              }
            },
            style: TextStyle(
              fontSize: _fontSize * 0.875,
              fontStyle: FontStyle.italic,
              color: muted,
              height: 1.6,
            ),
          ),
        );

      default: // 'p'
        content = Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: SelectableText(
            block.text,
            onSelectionChanged: (sel, _) {
              if (sel.baseOffset != sel.extentOffset) {
                setState(() => _selectionBlockIndex = index);
              }
            },
            style: TextStyle(
              fontSize: _fontSize,
              fontWeight: FontWeight.w400,
              color: fg,
              height: 1.85,
              letterSpacing: 0.02,
            ),
          ),
        );
    }

    // Tap on any block toggles the UI overlay.
    final tappable = GestureDetector(
      onTap: () => setState(() => _showUi = !_showUi),
      behavior: HitTestBehavior.translucent,
      child: content,
    );

    // TTS active block gets a subtle highlight background.
    return AnimatedContainer(
      key: _blockKeys[index],
      duration: const Duration(milliseconds: 200),
      decoration: active
          ? BoxDecoration(
              color: accent.withOpacity(0.08),
              borderRadius: BorderRadius.circular(4),
            )
          : null,
      child: tappable,
    );
  }

  // ---------------------------------------------------------------------------
  // Highlight floating button
  // ---------------------------------------------------------------------------

  Widget _buildHighlightButton(BuildContext context) {
    final fg = _fgColor(context);
    final bg = _bgColor(context);

    return Positioned(
      right: 20,
      // Aim roughly for vertical centre of screen.
      top: MediaQuery.of(context).size.height * 0.42,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(22),
          onTap: _commitHighlight,
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: fg,
              borderRadius: BorderRadius.circular(22),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.18),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.format_quote_rounded, color: bg, size: 15),
                const SizedBox(width: 6),
                Text(
                  '하이라이트',
                  style: TextStyle(
                    color: bg,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Top bar
  // ---------------------------------------------------------------------------

  Widget _buildTopBar(BuildContext context, EdgeInsets safeArea) {
    final fg = _fgColor(context);
    final border = _borderColor(context);
    final toolbarBg = _toolbarBg(context);

    return AnimatedOpacity(
      opacity: _showUi ? 1.0 : 0.0,
      duration: const Duration(milliseconds: 200),
      child: IgnorePointer(
        ignoring: !_showUi,
        child: Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: ClipRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
              child: Container(
                height: kToolbarHeight + safeArea.top,
                padding: EdgeInsets.only(top: safeArea.top),
                decoration: BoxDecoration(
                  color: toolbarBg,
                  border: Border(
                    bottom: BorderSide(color: border, width: 1),
                  ),
                ),
                child: Row(
                  children: [
                    IconButton(
                      icon: Icon(Icons.arrow_back_ios_new_rounded,
                          size: 18, color: fg),
                      onPressed: () async {
                        final ok = await _onWillPop();
                        if (ok && context.mounted) {
                          Navigator.of(context).pop();
                        }
                      },
                      tooltip: '뒤로',
                    ),
                    Expanded(
                      child: Text(
                        _book.title,
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: fg,
                        ),
                      ),
                    ),
                    // Symmetry spacer matching the back button.
                    const SizedBox(width: 48),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Bottom toolbar
  // ---------------------------------------------------------------------------

  Widget _buildBottomToolbar(
    BuildContext context,
    EdgeInsets safeArea,
    bool ttsBarVisible,
  ) {
    final border = _borderColor(context);
    final toolbarBg = _toolbarBg(context);
    final bottomOffset = safeArea.bottom + (ttsBarVisible ? 64.0 : 0.0) + 2.0;

    return AnimatedOpacity(
      opacity: _showUi ? 1.0 : 0.0,
      duration: const Duration(milliseconds: 200),
      child: IgnorePointer(
        ignoring: !_showUi,
        child: Positioned(
          left: 0,
          right: 0,
          bottom: bottomOffset,
          child: ClipRect(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
              child: Container(
                height: 56,
                decoration: BoxDecoration(
                  color: toolbarBg,
                  border: Border(
                    top: BorderSide(color: border, width: 1),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    // a. Font size
                    _toolbarBtn(
                      context: context,
                      label: 'Aa',
                      onTap: _cycleFontSize,
                      tooltip: '글꼴 크기  $_fontSize pt',
                    ),
                    // b. Theme
                    _toolbarBtn(
                      context: context,
                      icon: Icons.circle_outlined,
                      onTap: _cycleTheme,
                      tooltip: '테마',
                    ),
                    // c. TTS start / stop
                    _toolbarBtn(
                      context: context,
                      icon: ttsBarVisible
                          ? Icons.stop_rounded
                          : Icons.record_voice_over_rounded,
                      onTap: () {
                        if (ttsBarVisible) {
                          _ttsStopAll();
                        } else {
                          _ttsPlayFrom(_book.currentBlockIndex);
                        }
                      },
                      tooltip: ttsBarVisible ? 'TTS 중지' : 'TTS 시작',
                      active: ttsBarVisible,
                    ),
                    // d. TOC
                    _toolbarBtn(
                      context: context,
                      icon: Icons.format_list_bulleted_rounded,
                      onTap: () => setState(() {
                        _showToc = !_showToc;
                        if (_showToc) _showHighlights = false;
                      }),
                      tooltip: '목차',
                      active: _showToc,
                    ),
                    // e. Highlights
                    _toolbarBtn(
                      context: context,
                      icon: Icons.draw_rounded,
                      onTap: () => setState(() {
                        _showHighlights = !_showHighlights;
                        if (_showHighlights) _showToc = false;
                      }),
                      tooltip: '하이라이트',
                      active: _showHighlights,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _toolbarBtn({
    required BuildContext context,
    IconData? icon,
    String? label,
    VoidCallback? onTap,
    String? tooltip,
    bool active = false,
  }) {
    final color = active ? _accentColor(context) : _fg2Color(context);

    Widget child;
    if (label != null) {
      child = Text(
        label,
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: color,
          letterSpacing: -0.4,
        ),
      );
    } else {
      child = Icon(icon, size: 22, color: color);
    }

    return Tooltip(
      message: tooltip ?? '',
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(width: 52, height: 56, child: Center(child: child)),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // TTS bar
  // ---------------------------------------------------------------------------

  Widget _buildTtsBar(BuildContext context, EdgeInsets safeArea) {
    final border = _borderColor(context);
    final toolbarBg = _toolbarBg(context);
    final fg2 = _fg2Color(context);
    final muted = _mutedColor(context);

    // Preview text of the active block.
    final blockText = (_ttsBlockIdx >= 0 && _ttsBlockIdx < _book.blocks.length)
        ? _book.blocks[_ttsBlockIdx].text
        : '';
    final preview = blockText.length > 60
        ? '${blockText.substring(0, 60)}…'
        : blockText;

    // Format rate label: "1.0×" or "1.2×" etc.
    final rateLabel = _ttsRate == _ttsRate.truncateToDouble()
        ? '${_ttsRate.toInt()}×'
        : '${_ttsRate}×';

    return Positioned(
      left: 0,
      right: 0,
      bottom: safeArea.bottom + 56 + 2.0,
      child: Container(
        height: 64,
        decoration: BoxDecoration(
          color: toolbarBg,
          border: Border(top: BorderSide(color: border, width: 1)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        child: Row(
          children: [
            // Animated wave bars.
            _buildWaveBars(context),
            const SizedBox(width: 10),

            // Block preview text.
            Expanded(
              child: Text(
                preview,
                style: TextStyle(fontSize: 12, color: muted, height: 1.4),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 8),

            // Prev
            _ttsIconBtn(
              context,
              Icons.skip_previous_rounded,
              _ttsPrev,
              size: 20,
            ),
            // Play / Pause
            _ttsIconBtn(
              context,
              _ttsIsPaused
                  ? Icons.play_arrow_rounded
                  : Icons.pause_rounded,
              _ttsTogglePlayPause,
              size: 24,
            ),
            // Next
            _ttsIconBtn(
              context,
              Icons.skip_next_rounded,
              _ttsNext,
              size: 20,
            ),

            const SizedBox(width: 2),

            // Speed chip
            GestureDetector(
              onTap: _cycleRate,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  border: Border.all(color: border),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  rateLabel,
                  style: TextStyle(
                    fontSize: 12,
                    color: fg2,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 2),

            // Stop
            _ttsIconBtn(context, Icons.stop_rounded, _ttsStopAll, size: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildWaveBars(BuildContext context) {
    final accent = _accentColor(context);

    return AnimatedBuilder(
      animation: _waveController,
      builder: (_, __) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: List.generate(4, (i) {
            final phase = i / 3.0;
            final t = _waveController.value;
            final isAnimating = _ttsIsPlaying && !_ttsIsPaused;
            final height = isAnimating
                ? 8.0 +
                    12.0 *
                        ((math.sin((t + phase) * math.pi) + 1) / 2)
                : 4.0;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 100),
              margin: const EdgeInsets.symmetric(horizontal: 1.5),
              width: 3,
              height: height,
              decoration: BoxDecoration(
                color: accent.withOpacity(0.75),
                borderRadius: BorderRadius.circular(2),
              ),
            );
          }),
        );
      },
    );
  }

  Widget _ttsIconBtn(
    BuildContext context,
    IconData icon,
    VoidCallback onTap, {
    double size = 22,
  }) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5),
        child: Icon(icon, size: size, color: _fg2Color(context)),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // TOC panel
  // ---------------------------------------------------------------------------

  Widget _buildTocPanel(BuildContext context, EdgeInsets safeArea) {
    // Only h2 / h3 blocks with their original indices.
    final items = <({int idx, BookBlock block})>[
      for (int i = 0; i < _book.blocks.length; i++)
        if (_book.blocks[i].type == 'h2' || _book.blocks[i].type == 'h3')
          (idx: i, block: _book.blocks[i]),
    ];

    return _sidePanel(
      context: context,
      safeArea: safeArea,
      title: '목차',
      onClose: () => setState(() => _showToc = false),
      child: ListView.builder(
        padding: EdgeInsets.only(top: 4, bottom: safeArea.bottom + 24),
        itemCount: items.length,
        itemBuilder: (_, i) {
          final item = items[i];
          final isH2 = item.block.type == 'h2';
          return GestureDetector(
            onTap: () {
              setState(() => _showToc = false);
              _scrollToBlock(item.idx);
            },
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: EdgeInsets.fromLTRB(isH2 ? 16 : 32, 10, 16, 10),
              child: Text(
                item.block.text,
                style: TextStyle(
                  fontSize: isH2 ? 14 : 13,
                  fontWeight:
                      isH2 ? FontWeight.w600 : FontWeight.w400,
                  color: isH2 ? _fgColor(context) : _fg2Color(context),
                  height: 1.45,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Highlights panel
  // ---------------------------------------------------------------------------

  Widget _buildHighlightsPanel(BuildContext context, EdgeInsets safeArea) {
    final highlights = _book.highlights;
    final fg = _fgColor(context);
    final muted = _mutedColor(context);
    final border = _borderColor(context);

    Widget body;
    if (highlights.isEmpty) {
      body = Center(
        child: Text(
          '하이라이트가 없어요',
          style: TextStyle(fontSize: 14, color: muted),
        ),
      );
    } else {
      body = ListView.separated(
        padding: EdgeInsets.only(top: 4, bottom: safeArea.bottom + 24),
        itemCount: highlights.length,
        separatorBuilder: (_, __) => Divider(color: border, height: 1),
        itemBuilder: (_, i) {
          final hl = highlights[i];
          return GestureDetector(
            onTap: () {
              setState(() => _showHighlights = false);
              _scrollToBlock(hl.blockIndex);
            },
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 6, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.amber.withOpacity(0.30),
                      borderRadius: BorderRadius.circular(3),
                    ),
                    child: Text(
                      hl.selectedText,
                      style: TextStyle(
                        fontSize: 14,
                        color: fg,
                        height: 1.5,
                      ),
                    ),
                  ),
                  if (hl.note.isNotEmpty) ...[
                    const SizedBox(height: 5),
                    Text(
                      hl.note,
                      style: TextStyle(
                        fontSize: 12,
                        color: muted,
                        height: 1.4,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      );
    }

    return _sidePanel(
      context: context,
      safeArea: safeArea,
      title: '하이라이트 · 메모',
      onClose: () => setState(() => _showHighlights = false),
      child: body,
    );
  }

  // ---------------------------------------------------------------------------
  // Shared side-panel shell
  // ---------------------------------------------------------------------------

  Widget _sidePanel({
    required BuildContext context,
    required EdgeInsets safeArea,
    required String title,
    required VoidCallback onClose,
    required Widget child,
  }) {
    final screenWidth = MediaQuery.of(context).size.width;
    final panelWidth = math.min(screenWidth * 0.85, 320.0);
    final fg = _fgColor(context);
    final fg2 = _fg2Color(context);
    final bg = _bgColor(context);
    final border = _borderColor(context);

    return Positioned(
      top: 0,
      right: 0,
      bottom: 0,
      width: panelWidth,
      child: AnimatedSlide(
        offset: Offset.zero,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
        child: Container(
          decoration: BoxDecoration(
            color: bg,
            border: Border(left: BorderSide(color: border, width: 1)),
          ),
          child: Column(
            children: [
              // Header row.
              Container(
                height: kToolbarHeight + safeArea.top,
                padding: EdgeInsets.only(top: safeArea.top, left: 16, right: 8),
                decoration: BoxDecoration(
                  border: Border(bottom: BorderSide(color: border, width: 1)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: fg,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: Icon(Icons.close_rounded, color: fg2, size: 20),
                      onPressed: onClose,
                      tooltip: '닫기',
                    ),
                  ],
                ),
              ),
              // Content.
              Expanded(child: child),
            ],
          ),
        ),
      ),
    );
  }
}
