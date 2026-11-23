# SFX objective QA (2026-11-21, nobody listened; numbers only)

> 기술 참고: 음원 파일의 측정 기록이다. 게임 안 타격음의 청감 검수 결과는 아니다. [위키 홈](wiki/README.md)
Tooling: decode via ffmpeg, numpy analysis (`analyze.py`, `process.py` in /workspace/aster-survivors/sfx on the box).

Take selection (2 takes each, picked on measurements):
| sound | pick | reason |
|---|---|---|
| engine_loop | take 1 | steady (100 ms envelope std 0.8 dB), 6 dB hotter than take 2 |
| afterburner_loop | take 2 | steadiest (std 0.4 dB), seam RMS Δ 0.3 dB vs 2.1 dB |
| wind_loop | take 1, 1.2–5.9 s section | both takes were one-off whooshes (std 4.6 / 8.0 dB, 30 dB swing) -> used the calm section of take 1, flattened with a 300 ms RMS follower |
| hit | take 1 | smaller onset discontinuity than take 2 |
| explosion | take 1 | 0.4 ms lead vs 25 ms |
| graze | take 1 | take 2 had 289 ms of leading silence |
| parry | take 2 | 3 dB louder, cleaner tail |
| roll | take 2 | take 1 had 46 ms lead and was 2 dB quieter |
| warning | take 1 | take 2 hit 0 dBFS (1 clipped sample) and did not decay |
| ace_alert | take 1 | louder, consistent |

Processing:
- One-shots: trim leading/trailing silence below -50 dBFS, 2 ms fade-in, 15 ms fade-out, peak-normalised to -1.5 dBFS.
- Loops: last 250 ms equal-power crossfaded into the head (loop = x[F:] with tail blended into x[:F]), RMS-normalised (engine -24, afterburner -20, wind -24 dBFS), peak <= -1.5 dBFS.
- Encoded mono 44.1 kHz MP3 (loops 80 kbps, one-shots 64 kbps), LAME gapless header present. Total 220 KB.

Post-encode checks (decoded):
- Clipping: 0 samples >= -0.1 dBFS in every file; peaks -1.0 to -12.7 dBFS.
- Leading silence: 0 samples on decode (ffmpeg honours LAME gapless); decoded length == manifest `samples` exactly.
- Loop seams (wrap step vs within-file sample-step distribution; RMS of 40 ms across the wrap vs all 40 ms windows):
  - engine: wrap step at 11th pct, seam RMS at 57th pct, envelope std 0.84 dB
  - afterburner: wrap step at 99th pct (noisy crackle, within normal range), seam RMS 0.7 dB below median, std 0.35 dB
  - wind: wrap step at 95th pct, seam RMS at 87th pct, std 0.59 dB
- Runtime must still guard against decoders that ignore the gapless header (Safari): see manifest.json `samples`.
