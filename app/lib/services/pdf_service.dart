import 'dart:typed_data';
import 'package:flutter/services.dart';
import '../models/book.dart';

// ---------------------------------------------------------------------------
// PdfService
// ---------------------------------------------------------------------------
//
// Communicates with the native iOS side via a MethodChannel.  The native
// implementation uses PDFKit / PDFDocument to extract structured text and
// reports it back as a list of maps [{'type': 'h2'|'h3'|'p'|'fig', 'text': '...'}].
//
// The channel name must match AppDelegate / Swift registration exactly.
// ---------------------------------------------------------------------------

class PdfService {
  PdfService._();

  static const MethodChannel _channel = MethodChannel('com.papershelf/pdf');

  // ── Block extraction ──────────────────────────────────────────────────────

  /// Sends [pdfBytes] to the native layer and returns the parsed list of
  /// [BookBlock] objects that represent the book's structured content.
  ///
  /// Throws a [PdfExtractionException] if the channel call fails or if the
  /// native side returns unexpected data.
  static Future<List<BookBlock>> extractBlocks(Uint8List pdfBytes) async {
    if (pdfBytes.isEmpty) {
      throw const PdfExtractionException('PDF bytes must not be empty.');
    }

    List<dynamic>? raw;
    try {
      raw = await _channel.invokeListMethod<dynamic>(
        'extractText',
        {'bytes': pdfBytes},
      );
    } on PlatformException catch (e) {
      throw PdfExtractionException(
        'Native extractText call failed: [${e.code}] ${e.message}',
      );
    } catch (e) {
      throw PdfExtractionException('Unexpected error during text extraction: $e');
    }

    if (raw == null) {
      throw const PdfExtractionException(
        'Native extractText returned null – PDF may be corrupted or encrypted.',
      );
    }

    final blocks = <BookBlock>[];
    for (int i = 0; i < raw.length; i++) {
      final item = raw[i];
      if (item is! Map) {
        throw PdfExtractionException(
          'Item at index $i is not a Map; got ${item.runtimeType}.',
        );
      }

      final type = item['type'];
      final text = item['text'];

      if (type == null || type is! String) {
        throw PdfExtractionException(
          'Item at index $i has missing or invalid "type" field.',
        );
      }
      if (text == null || text is! String) {
        throw PdfExtractionException(
          'Item at index $i has missing or invalid "text" field.',
        );
      }

      const validTypes = {'h2', 'h3', 'p', 'fig'};
      final normalizedType = validTypes.contains(type) ? type : 'p';

      if (text.trim().isNotEmpty) {
        blocks.add(BookBlock(type: normalizedType, text: text));
      }
    }

    if (blocks.isEmpty) {
      throw const PdfExtractionException(
        'No readable text blocks found in the PDF. '
        'The document may be image-based or DRM-protected.',
      );
    }

    return blocks;
  }

  // ── Page count ────────────────────────────────────────────────────────────

  /// Returns the number of pages in the PDF represented by [bytes].
  ///
  /// Returns 0 if the native call fails rather than throwing, so callers can
  /// gracefully display an unknown page count.
  static Future<int> getPageCount(Uint8List bytes) async {
    if (bytes.isEmpty) return 0;

    try {
      final result = await _channel.invokeMethod<int>(
        'getPageCount',
        {'bytes': bytes},
      );
      return result ?? 0;
    } on PlatformException catch (e) {
      // Log but don't crash – page count is supplemental information.
      // ignore: avoid_print
      print('[PdfService] getPageCount failed: [${e.code}] ${e.message}');
      return 0;
    } catch (e) {
      // ignore: avoid_print
      print('[PdfService] getPageCount unexpected error: $e');
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// PdfExtractionException
// ---------------------------------------------------------------------------

class PdfExtractionException implements Exception {
  final String message;

  const PdfExtractionException(this.message);

  @override
  String toString() => 'PdfExtractionException: $message';
}
