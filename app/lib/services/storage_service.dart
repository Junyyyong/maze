import 'package:hive/hive.dart';
import '../models/book.dart';

// ---------------------------------------------------------------------------
// StorageService
// ---------------------------------------------------------------------------
//
// Thin wrapper around the Hive 'books' box.  All methods are synchronous
// where Hive allows it; only mutations that write to disk are async.
// ---------------------------------------------------------------------------

class StorageService {
  // The box is opened once in main.dart before the app starts.
  static const String _boxName = 'books';

  Box<Book> get _box => Hive.box<Book>(_boxName);

  // ── Read ──────────────────────────────────────────────────────────────────

  /// Returns all books sorted by [lastReadAt] DESC (most recently read first),
  /// then by [addedAt] DESC for books that have never been opened.
  List<Book> getAllBooks() {
    final books = _box.values.toList();

    books.sort((a, b) {
      // Sort by lastReadAt desc (null treated as oldest)
      final aTime = a.lastReadAt ?? 0;
      final bTime = b.lastReadAt ?? 0;

      if (bTime != aTime) return bTime.compareTo(aTime);

      // Tie-break by addedAt desc
      return b.addedAt.compareTo(a.addedAt);
    });

    return books;
  }

  /// Returns the book with the given [id], or null if not found.
  Book? getBook(String id) {
    try {
      return _box.values.firstWhere((b) => b.id == id);
    } catch (_) {
      return null;
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /// Persists [book] to the box, using [book.id] as the key.
  Future<void> saveBook(Book book) async {
    await _box.put(book.id, book);
  }

  /// Removes the book with the given [id] from the box.
  /// No-op if the book doesn't exist.
  Future<void> deleteBook(String id) async {
    await _box.delete(id);
  }

  /// Updates the reading progress of a book in place and persists the change.
  ///
  /// [blockIndex] – the 0-based index of the block the reader is currently on.
  /// [progress]   – a value in [0.0, 1.0] representing overall completion.
  Future<void> updateProgress(
    String id,
    int blockIndex,
    double progress,
  ) async {
    final book = getBook(id);
    if (book == null) return;

    book.currentBlockIndex = blockIndex;
    book.progress = progress.clamp(0.0, 1.0);
    book.lastReadAt = DateTime.now().millisecondsSinceEpoch;

    await book.save(); // HiveObject convenience method – uses existing key
  }
}
