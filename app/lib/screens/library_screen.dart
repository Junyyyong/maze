import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/book.dart';
import '../providers/app_provider.dart';
import '../services/pdf_service.dart';
import '../services/storage_service.dart';

// ---------------------------------------------------------------------------
// LibraryScreen
// ---------------------------------------------------------------------------

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  final StorageService _storage = StorageService();
  List<Book> _books = [];

  @override
  void initState() {
    super.initState();
    _loadBooks();
  }

  void _loadBooks() {
    setState(() {
      _books = _storage.getAllBooks();
    });
  }

  // ── Add PDF ───────────────────────────────────────────────────────────────

  Future<void> _pickAndAddPdf() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      withData: true,
    );

    if (result == null || result.files.isEmpty) return;

    final file = result.files.first;
    final bytes = file.bytes;
    if (bytes == null || bytes.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('파일을 읽을 수 없어요.')),
        );
      }
      return;
    }

    await _processAndSavePdf(bytes, file.name);
  }

  Future<void> _processAndSavePdf(Uint8List bytes, String fileName) async {
    if (!mounted) return;

    // Show loading dialog.
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const _LoadingDialog(message: 'PDF 분석 중…'),
    );

    try {
      final blocks = await PdfService.extractBlocks(bytes);
      final pageCount = await PdfService.getPageCount(bytes);
      final title = _titleFromFileName(fileName);

      final book = Book(
        id: const Uuid().v4(),
        title: title,
        fileName: fileName,
        numPages: pageCount > 0 ? pageCount : 1,
        addedAt: DateTime.now().millisecondsSinceEpoch,
        blocks: blocks,
        highlights: [],
        pdfBytes: bytes,
      );

      await _storage.saveBook(book);
    } on PdfExtractionException catch (e) {
      if (mounted) Navigator.of(context, rootNavigator: true).pop();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message)),
        );
      }
      return;
    } catch (e) {
      if (mounted) Navigator.of(context, rootNavigator: true).pop();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('오류가 발생했어요: $e')),
        );
      }
      return;
    }

    if (mounted) Navigator.of(context, rootNavigator: true).pop();
    _loadBooks();
  }

  String _titleFromFileName(String fileName) {
    var name = fileName;
    if (name.toLowerCase().endsWith('.pdf')) {
      name = name.substring(0, name.length - 4);
    }
    return name.replaceAll(RegExp(r'[_\-]+'), ' ').trim();
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  void _showSettings() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ChangeNotifierProvider.value(
        value: context.read<AppProvider>(),
        child: _QuickSettingsSheet(
          onViewFullSettings: () {
            Navigator.of(context).pop();
            Navigator.of(context).pushNamed('/settings');
          },
        ),
      ),
    );
  }

  // ── Book actions ──────────────────────────────────────────────────────────

  Future<void> _deleteBook(Book book) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('삭제하시겠어요?'),
        content: Text('"${book.title}"을(를) 영구적으로 삭제합니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('취소'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('삭제'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await _storage.deleteBook(book.id);
      _loadBooks();
    }
  }

  Future<void> _renameBook(Book book, String newTitle) async {
    if (newTitle.trim().isEmpty) return;
    book.title = newTitle.trim();
    await _storage.saveBook(book);
    _loadBooks();
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bg = Theme.of(context).scaffoldBackgroundColor;
    final border = colorScheme.outline;

    return Scaffold(
      backgroundColor: bg,
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(kToolbarHeight),
        child: _LibraryAppBar(
          onSettings: _showSettings,
          onAdd: _pickAndAddPdf,
          borderColor: border,
        ),
      ),
      body: _books.isEmpty
          ? _EmptyState(onAddTap: _pickAndAddPdf)
          : _BookGrid(
              books: _books,
              onTap: (book) =>
                  Navigator.of(context).pushNamed('/reader', arguments: book),
              onDelete: _deleteBook,
              onRename: _renameBook,
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// _LibraryAppBar
// ---------------------------------------------------------------------------

class _LibraryAppBar extends StatelessWidget {
  final VoidCallback onSettings;
  final VoidCallback onAdd;
  final Color borderColor;

  const _LibraryAppBar({
    required this.onSettings,
    required this.onAdd,
    required this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final fg = colorScheme.onSurface;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        border: Border(bottom: BorderSide(color: borderColor, width: 1)),
      ),
      child: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: true,
        title: Text(
          'Paper Shelf',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: fg,
            fontFamily: 'Georgia',
            fontFamilyFallback: const ['Palatino', 'serif'],
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined, size: 22),
            onPressed: onSettings,
            tooltip: '설정',
            color: colorScheme.onSurfaceVariant,
          ),
          IconButton(
            icon: const Icon(Icons.add, size: 22),
            onPressed: onAdd,
            tooltip: 'PDF 추가',
            color: colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _EmptyState
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  final VoidCallback onAddTap;

  const _EmptyState({required this.onAddTap});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '📚',
              style: TextStyle(fontSize: 48, color: muted.withAlpha(120)),
            ),
            const SizedBox(height: 20),
            Text(
              '논문 PDF를 추가해보세요',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w400,
                color: muted,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              '이북처럼 편하게 읽을 수 있어요',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, color: muted, height: 1.5),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: onAddTap,
              child: const Text('+ PDF 추가'),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _BookGrid
// ---------------------------------------------------------------------------

class _BookGrid extends StatelessWidget {
  final List<Book> books;
  final void Function(Book) onTap;
  final Future<void> Function(Book) onDelete;
  final Future<void> Function(Book, String) onRename;

  const _BookGrid({
    required this.books,
    required this.onTap,
    required this.onDelete,
    required this.onRename,
  });

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: const EdgeInsets.all(20),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.65,
        mainAxisSpacing: 24,
        crossAxisSpacing: 16,
      ),
      itemCount: books.length,
      itemBuilder: (context, index) {
        final book = books[index];
        return BookCard(
          book: book,
          onTap: () => onTap(book),
          onDelete: () => onDelete(book),
          onRename: (newTitle) => onRename(book, newTitle),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// BookCard  — exported so it can be imported in other files if needed
// ---------------------------------------------------------------------------

class BookCard extends StatelessWidget {
  final Book book;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final void Function(String newTitle) onRename;

  const BookCard({
    super.key,
    required this.book,
    required this.onTap,
    required this.onDelete,
    required this.onRename,
  });

  void _showContextMenu(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _BookContextMenu(
        book: book,
        onRename: () {
          Navigator.of(context).pop();
          _showRenameDialog(context);
        },
        onDelete: () {
          Navigator.of(context).pop();
          onDelete();
        },
      ),
    );
  }

  void _showRenameDialog(BuildContext context) {
    final controller = TextEditingController(text: book.title);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('이름 바꾸기'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: '제목을 입력하세요'),
          textInputAction: TextInputAction.done,
          onSubmitted: (val) {
            Navigator.of(ctx).pop();
            onRename(val);
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('취소'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              onRename(controller.text);
            },
            child: const Text('저장'),
          ),
        ],
      ),
    ).then((_) => controller.dispose());
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final fg = colorScheme.onSurface;
    final muted = colorScheme.onSurfaceVariant;
    final border = colorScheme.outline;
    final surface = colorScheme.surface;
    final coverBg = colorScheme.surfaceContainerHighest;

    final initial =
        book.title.isNotEmpty ? book.title.trimLeft().characters.first : '?';
    final pct = (book.progress * 100).round();
    final metaText = '${book.numPages}쪽 · $pct% 읽음';

    return GestureDetector(
      onTap: onTap,
      onLongPress: () => _showContextMenu(context),
      child: Container(
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: border, width: 1),
        ),
        clipBehavior: Clip.hardEdge,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Cover ──────────────────────────────────────────────────────
            Expanded(
              flex: 3,
              child: Container(
                width: double.infinity,
                color: coverBg,
                alignment: Alignment.center,
                child: Text(
                  initial,
                  style: TextStyle(
                    fontSize: 40,
                    fontWeight: FontWeight.w400,
                    color: muted.withAlpha(128),
                    fontFamily: 'Georgia',
                    fontFamilyFallback: const ['Palatino', 'serif'],
                    height: 1,
                  ),
                ),
              ),
            ),

            // ── Info ───────────────────────────────────────────────────────
            Expanded(
              flex: 2,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      book.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w400,
                        color: fg,
                        height: 1.4,
                        fontFamily: 'Georgia',
                        fontFamilyFallback: const ['Palatino', 'serif'],
                      ),
                    ),
                    const Spacer(),
                    Text(
                      metaText,
                      style: TextStyle(
                        fontSize: 11,
                        color: muted,
                        height: 1.4,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(1),
                      child: LinearProgressIndicator(
                        value: book.progress.clamp(0.0, 1.0),
                        minHeight: 2,
                        backgroundColor: border,
                        valueColor: AlwaysStoppedAnimation<Color>(fg),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _BookContextMenu  — long-press bottom sheet
// ---------------------------------------------------------------------------

class _BookContextMenu extends StatelessWidget {
  final Book book;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  const _BookContextMenu({
    required this.book,
    required this.onRename,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final surface = colorScheme.surface;
    final fg = colorScheme.onSurface;
    final border = colorScheme.outline;

    return Container(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        border: Border(top: BorderSide(color: border, width: 1)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle
            Container(
              width: 36,
              height: 4,
              margin: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            // Book title
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Text(
                book.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            Divider(color: border, height: 1),
            // Rename
            ListTile(
              leading: Icon(Icons.edit_outlined, size: 20, color: colorScheme.onSurfaceVariant),
              title: Text('이름 바꾸기', style: TextStyle(fontSize: 15, color: fg)),
              onTap: onRename,
            ),
            // Delete
            ListTile(
              leading: const Icon(Icons.delete_outline, size: 20, color: Color(0xFFB00020)),
              title: const Text('삭제', style: TextStyle(fontSize: 15, color: Color(0xFFB00020))),
              onTap: onDelete,
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _LoadingDialog
// ---------------------------------------------------------------------------

class _LoadingDialog extends StatelessWidget {
  final String message;

  const _LoadingDialog({required this.message});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Dialog(
      backgroundColor: colorScheme.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 28),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: colorScheme.primary,
              ),
            ),
            const SizedBox(width: 20),
            Text(
              message,
              style: TextStyle(fontSize: 15, color: colorScheme.onSurface),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _QuickSettingsSheet  — minimal bottom sheet from appbar gear icon
// ---------------------------------------------------------------------------

class _QuickSettingsSheet extends StatelessWidget {
  final VoidCallback onViewFullSettings;

  const _QuickSettingsSheet({required this.onViewFullSettings});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final colorScheme = Theme.of(context).colorScheme;
    final surface = colorScheme.surface;
    final fg = colorScheme.onSurface;
    final muted = colorScheme.onSurfaceVariant;
    final border = colorScheme.outline;

    return Container(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        border: Border(top: BorderSide(color: border, width: 1)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Handle
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.symmetric(vertical: 10),
                  decoration: BoxDecoration(
                    color: border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                '화면 설정',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: fg,
                ),
              ),
              const SizedBox(height: 20),

              // Theme label
              Text('테마', style: TextStyle(fontSize: 13, color: muted)),
              const SizedBox(height: 10),

              // Theme picker
              _ThemeSegment(
                current: provider.readerTheme,
                onChanged: (t) => context.read<AppProvider>().setReaderTheme(t),
                border: border,
                fg: fg,
                surface: surface,
              ),
              const SizedBox(height: 20),

              // Font size
              Row(
                children: [
                  Text('글자 크기', style: TextStyle(fontSize: 13, color: muted)),
                  const Spacer(),
                  Text(
                    '${provider.fontSize.round()}px',
                    style: TextStyle(fontSize: 13, color: fg, fontWeight: FontWeight.w500),
                  ),
                ],
              ),
              Slider(
                value: provider.fontSize,
                min: 14,
                max: 24,
                divisions: 10,
                onChanged: (v) => context.read<AppProvider>().setFontSize(v),
              ),
              const SizedBox(height: 12),

              // Full settings link
              GestureDetector(
                onTap: onViewFullSettings,
                child: Text(
                  '더 많은 설정 →',
                  style: TextStyle(
                    fontSize: 13,
                    color: muted,
                    decoration: TextDecoration.underline,
                    decorationColor: muted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _ThemeSegment  — shared segmented control for theme selection
// ---------------------------------------------------------------------------

class _ThemeSegment extends StatelessWidget {
  final dynamic current; // ReaderTheme — imported from theme/app_theme.dart
  final void Function(dynamic) onChanged;
  final Color border;
  final Color fg;
  final Color surface;

  const _ThemeSegment({
    required this.current,
    required this.onChanged,
    required this.border,
    required this.fg,
    required this.surface,
  });

  @override
  Widget build(BuildContext context) {
    // Local import of ReaderTheme via provider
    final provider = context.read<AppProvider>();
    // We use the provider to cycle through the ReaderTheme enum values.
    // ReaderTheme is re-exported through AppProvider's import chain.
    // Using dynamic to avoid a direct cross-file import cycle here;
    // the actual values are compared via == which works with enums.
    const labels = ['Light', 'Sepia', 'Dark'];

    return Row(
      children: List.generate(labels.length, (i) {
        // Map label index to ReaderTheme ordinal.
        // We resolve the enum value from the provider's current theme.
        final allThemes = AppProvider._readerThemes;
        final theme = allThemes[i];
        final isSelected = current == theme;
        return Expanded(
          child: GestureDetector(
            onTap: () => onChanged(theme),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              height: 38,
              margin: const EdgeInsets.symmetric(horizontal: 3),
              decoration: BoxDecoration(
                color: isSelected ? fg : surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: border, width: 1),
              ),
              alignment: Alignment.center,
              child: Text(
                labels[i],
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                  color: isSelected ? surface : fg,
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}
