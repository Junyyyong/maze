import 'package:flutter/material.dart';

// ---------------------------------------------------------------------------
// ReaderScreen — placeholder
// ---------------------------------------------------------------------------
// Replace this with the full block-by-block reader UI.
// Receives a 'bookId' String argument via Navigator.pushNamed settings.
// ---------------------------------------------------------------------------

class ReaderScreen extends StatelessWidget {
  const ReaderScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final bookId = ModalRoute.of(context)?.settings.arguments as String?;
    return Scaffold(
      appBar: AppBar(title: const Text('Reader')),
      body: Center(
        child: Text(bookId != null ? 'Reading: $bookId' : 'No book selected'),
      ),
    );
  }
}
