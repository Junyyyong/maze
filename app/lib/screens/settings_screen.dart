import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/app_provider.dart';
import '../services/tts_service.dart';
import '../theme/app_theme.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('설정'),
        scrolledUnderElevation: 0,
      ),
      body: ListView(
        children: [
          _SectionHeader(label: '읽기 설정'),
          _ThemeRow(),
          _FontSizeRow(),
          _TtsRateRow(),
          const Divider(height: 32),
          _SectionHeader(label: '앱 정보'),
          ListTile(
            title: const Text('버전'),
            trailing: Text(
              '1.0.0',
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontSize: 14,
              ),
            ),
          ),
          ListTile(
            title: const Text('개인정보 처리방침'),
            trailing: const Icon(Icons.open_in_new, size: 16),
            onTap: () {
              // TODO: open privacy policy URL
            },
          ),
          ListTile(
            title: const Text('오픈소스 라이선스'),
            onTap: () => showLicensePage(
              context: context,
              applicationName: 'Paper Shelf',
              applicationVersion: '1.0.0',
            ),
          ),
          ListTile(
            title: const Text('앱 리뷰 남기기'),
            trailing: const Icon(Icons.star_outline_rounded, size: 18),
            onTap: () {
              // TODO: open App Store review URL
            },
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }
}

// ── Section header ────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String label;
  const _SectionHeader({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.6,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

// ── Theme row ─────────────────────────────────────────────────────────────────

class _ThemeRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final current = provider.readerTheme;
    final fg = Theme.of(context).colorScheme.onSurface;
    final surface = Theme.of(context).colorScheme.surface;
    final border = Theme.of(context).colorScheme.outline;
    const labels = ['Light', 'Sepia', 'Dark'];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('테마', style: TextStyle(fontSize: 15, color: fg)),
          const SizedBox(height: 12),
          Row(
            children: List.generate(ReaderTheme.values.length, (i) {
              final theme = ReaderTheme.values[i];
              final selected = current == theme;
              return Expanded(
                child: GestureDetector(
                  onTap: () => context.read<AppProvider>().setReaderTheme(theme),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    height: 40,
                    margin: EdgeInsets.only(right: i < 2 ? 8 : 0),
                    decoration: BoxDecoration(
                      color: selected ? fg : surface,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: border),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      labels[i],
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w400,
                        color: selected ? surface : fg,
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}

// ── Font size row ─────────────────────────────────────────────────────────────

class _FontSizeRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final fg = Theme.of(context).colorScheme.onSurface;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('글자 크기', style: TextStyle(fontSize: 15, color: fg)),
              const Spacer(),
              Text(
                '${provider.fontSize.round()}px',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: muted,
                ),
              ),
            ],
          ),
          Slider(
            value: provider.fontSize,
            min: 14,
            max: 24,
            divisions: 10,
            activeColor: fg,
            inactiveColor: Theme.of(context).colorScheme.outline,
            onChanged: (v) => context.read<AppProvider>().setFontSize(v),
          ),
        ],
      ),
    );
  }
}

// ── TTS rate row ──────────────────────────────────────────────────────────────

class _TtsRateRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<AppProvider>();
    final current = provider.ttsRate;
    final fg = Theme.of(context).colorScheme.onSurface;
    final surface = Theme.of(context).colorScheme.surface;
    final border = Theme.of(context).colorScheme.outline;
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('읽기 속도', style: TextStyle(fontSize: 15, color: fg)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: TtsService.rates.map((r) {
              final selected = current == r;
              final label =
                  r == r.truncateToDouble() ? '${r.toInt()}×' : '${r}×';
              return GestureDetector(
                onTap: () => context.read<AppProvider>().setTtsRate(r),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: selected ? fg : surface,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: border),
                  ),
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight:
                          selected ? FontWeight.w600 : FontWeight.w400,
                      color: selected ? surface : muted,
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
