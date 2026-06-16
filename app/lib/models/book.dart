import 'dart:typed_data';
import 'package:hive/hive.dart';

part 'book.g.dart';

// ---------------------------------------------------------------------------
// BookBlock
// ---------------------------------------------------------------------------

@HiveType(typeId: 1)
class BookBlock {
  @HiveField(0)
  final String type; // 'h2' | 'h3' | 'p' | 'fig'

  @HiveField(1)
  final String text;

  const BookBlock({required this.type, required this.text});

  @override
  String toString() => 'BookBlock(type: $type, text: ${text.length > 40 ? '${text.substring(0, 40)}…' : text})';
}

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

@HiveType(typeId: 2)
class Highlight {
  @HiveField(0)
  final String id;

  @HiveField(1)
  final int blockIndex;

  @HiveField(2)
  final String selectedText;

  @HiveField(3)
  final String note;

  @HiveField(4)
  final int createdAt; // millisecondsSinceEpoch

  const Highlight({
    required this.id,
    required this.blockIndex,
    required this.selectedText,
    this.note = '',
    required this.createdAt,
  });
}

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

@HiveType(typeId: 0)
class Book extends HiveObject {
  @HiveField(0)
  String id;

  @HiveField(1)
  String title;

  @HiveField(2)
  String fileName;

  @HiveField(3)
  int numPages;

  @HiveField(4)
  int addedAt; // millisecondsSinceEpoch

  @HiveField(5)
  int? lastReadAt;

  @HiveField(6)
  List<BookBlock> blocks;

  @HiveField(7)
  int currentBlockIndex;

  @HiveField(8)
  double progress; // 0.0–1.0

  @HiveField(9)
  List<Highlight> highlights;

  @HiveField(10)
  Uint8List pdfBytes;

  Book({
    required this.id,
    required this.title,
    required this.fileName,
    required this.numPages,
    required this.addedAt,
    this.lastReadAt,
    required this.blocks,
    this.currentBlockIndex = 0,
    this.progress = 0.0,
    required this.highlights,
    required this.pdfBytes,
  });
}

// ---------------------------------------------------------------------------
// Manually written TypeAdapters (no build_runner needed)
// ---------------------------------------------------------------------------

class BookBlockAdapter extends TypeAdapter<BookBlock> {
  @override
  final int typeId = 1;

  @override
  BookBlock read(BinaryReader reader) {
    final numOfFields = reader.readByte();
    final fields = <int, dynamic>{
      for (int i = 0; i < numOfFields; i++) reader.readByte(): reader.read(),
    };
    return BookBlock(
      type: fields[0] as String,
      text: fields[1] as String,
    );
  }

  @override
  void write(BinaryWriter writer, BookBlock obj) {
    writer
      ..writeByte(2)
      ..writeByte(0)
      ..write(obj.type)
      ..writeByte(1)
      ..write(obj.text);
  }

  @override
  int get hashCode => typeId.hashCode;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is BookBlockAdapter &&
          runtimeType == other.runtimeType &&
          typeId == other.typeId;
}

class HighlightAdapter extends TypeAdapter<Highlight> {
  @override
  final int typeId = 2;

  @override
  Highlight read(BinaryReader reader) {
    final numOfFields = reader.readByte();
    final fields = <int, dynamic>{
      for (int i = 0; i < numOfFields; i++) reader.readByte(): reader.read(),
    };
    return Highlight(
      id: fields[0] as String,
      blockIndex: fields[1] as int,
      selectedText: fields[2] as String,
      note: fields[3] as String? ?? '',
      createdAt: fields[4] as int,
    );
  }

  @override
  void write(BinaryWriter writer, Highlight obj) {
    writer
      ..writeByte(5)
      ..writeByte(0)
      ..write(obj.id)
      ..writeByte(1)
      ..write(obj.blockIndex)
      ..writeByte(2)
      ..write(obj.selectedText)
      ..writeByte(3)
      ..write(obj.note)
      ..writeByte(4)
      ..write(obj.createdAt);
  }

  @override
  int get hashCode => typeId.hashCode;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is HighlightAdapter &&
          runtimeType == other.runtimeType &&
          typeId == other.typeId;
}

class BookAdapter extends TypeAdapter<Book> {
  @override
  final int typeId = 0;

  @override
  Book read(BinaryReader reader) {
    final numOfFields = reader.readByte();
    final fields = <int, dynamic>{
      for (int i = 0; i < numOfFields; i++) reader.readByte(): reader.read(),
    };
    return Book(
      id: fields[0] as String,
      title: fields[1] as String,
      fileName: fields[2] as String,
      numPages: fields[3] as int,
      addedAt: fields[4] as int,
      lastReadAt: fields[5] as int?,
      blocks: (fields[6] as List).cast<BookBlock>(),
      currentBlockIndex: fields[7] as int? ?? 0,
      progress: (fields[8] as num?)?.toDouble() ?? 0.0,
      highlights: (fields[9] as List).cast<Highlight>(),
      pdfBytes: fields[10] as Uint8List,
    );
  }

  @override
  void write(BinaryWriter writer, Book obj) {
    writer
      ..writeByte(11)
      ..writeByte(0)
      ..write(obj.id)
      ..writeByte(1)
      ..write(obj.title)
      ..writeByte(2)
      ..write(obj.fileName)
      ..writeByte(3)
      ..write(obj.numPages)
      ..writeByte(4)
      ..write(obj.addedAt)
      ..writeByte(5)
      ..write(obj.lastReadAt)
      ..writeByte(6)
      ..write(obj.blocks)
      ..writeByte(7)
      ..write(obj.currentBlockIndex)
      ..writeByte(8)
      ..write(obj.progress)
      ..writeByte(9)
      ..write(obj.highlights)
      ..writeByte(10)
      ..write(obj.pdfBytes);
  }

  @override
  int get hashCode => typeId.hashCode;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is BookAdapter &&
          runtimeType == other.runtimeType &&
          typeId == other.typeId;
}
