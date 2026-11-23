# XP 밸런스 비교 결과 — Candidate E

## 범위와 재현 정보

- 공통 설정: `from=1`, `heat=0`, desktop cap **200**, mobile cap **120**. Mobile 결과는 mobile-cap 시뮬레이션이며 실제 기기 성능이나 터치 조작 검증이 아니다.
- 최종 공통 곡선: `xpEarlyCosts=[3,23,26,28,28]`, `xpLateStartLevel=8`, `xpLateGrowth=0.8`, `xpEndRunStartLevel=42`, `xpEndRunGrowth=24`, `xpBase=14`, `xpPerLevel=2.4`. `runXpCost(level)`은 early array의 값(없으면 `14 + round(2.4 * level)`)에 `round(0.8 * max(0, level - 8))`와 `round(24 * max(0, level - 42))`를 더한다. E는 D에서 `xpEndRunGrowth`만 **12 → 24**로 바꿨고, end-run 추가 비용은 level 43부터 발생한다.
- E10은 생략했다. D10 gate가 통과했고 E의 유일한 차이는 level 42 이후이므로 첫 1분 진행은 바뀌지 않는다. 지정된 대로 E는 D10 재실행 대신 곧바로 여섯 개의 100-seed job으로 검증했다.
- A/B/C/D의 10-seed 보고서와 D100 원자료는 보존했다. E는 seed 1–100의 profile/platform별 6개 job을 직접 실행했다. baseline100은 `/home/ubuntu/attachments/28ec6001-1554-4279-b1bd-2b3724d11b53/density-handoff-data.tar.gz`의 `newbase-final-*100-from-1-heat-0-*` JSON에서 왔다. 61개 archive member를 먼저 열거한 뒤 6개 baseline JSON만 읽었고, JSON은 extracted snapshot 및 `density-handoff-metadata.json`의 SHA-256과 모두 일치했다. 기준 report head는 `421ae441979bff5783eaef4d2603b9834046e9dd`다.
- 재실행(각 명령은 JSON/CSV를 `sim-out/`에 저장):
  ```sh
  npm run sim -- --profile skilled --seeds 100 --from 1 --heat 0
  npm run sim -- --profile skilled --seeds 100 --from 1 --heat 0 --mobile
  npm run sim -- --profile average --seeds 100 --from 1 --heat 0
  npm run sim -- --profile average --seeds 100 --from 1 --heat 0 --mobile
  npm run sim -- --profile weak --seeds 100 --from 1 --heat 0
  npm run sim -- --profile weak --seeds 100 --from 1 --heat 0 --mobile
  ```
  각 명령은 `sim-out/<profile>-100-from-1-heat-0-{desktop,mobile}.{json,csv}`를 쓴다.
- `actualDurationSeconds`는 실제 종료 시간이다. `normalizedSurvivalSeconds`는 승리를 600초 생존으로 계산하고, 패배는 실제 경과시간으로 계산한다. 두 값은 서로 다른 의미다.

## 초기 진행과 후보 비교

@60의 distribution은 각 profile의 skilled/average/weak 순서다. Compliance는 해당 구간을 만족한 run 수 / 관측 run 수다.

| 집합 | 첫 level-up median; ≤10초 | @60 median PC / phone | @60의 3–4 compliance PC / phone |
|---|---|---|---|
| baseline100 | 24.58–27.75초; 각 0/100 | 4/4/3 · 4/3/3 | 75/100, 84/100, 84/100 · 94/100, 96/100, 63/100 |
| A10 | 5.00–5.07초; 각 10/10 | 4/4/3 · 4/3/3 | 10/10, 8/10, 6/10 · 9/10, 7/10, 6/10 |
| B10 | 5.00–5.07초; 각 10/10 | 4/4/3 · 3/3/3 | 9/10, 9/10, 10/10 · 9/10, 10/10, 8/10 |
| C10 | 5.00–5.07초; 각 10/10 | 4/4/3 · 3/3/3 | 9/10, 9/10, 10/10 · 9/10, 10/10, 8/10 |
| D10 | 5.00–5.07초; 각 10/10 | 4/4/3 · 3/3/3 | 9/10, 9/10, 10/10 · 9/10, 10/10, 8/10 |
| E100 | 5.09–5.11초; 각 100/100 | 4/4/3 · 4/4/3 | 84/100, 91/100, 94/100 · 93/100, 99/100, 83/100 |

C10은 `xpLateGrowth=0.8` runtime-only screen이며 shipped override가 아니다. 후보별·cell별 n과 rate, timing, outcome은 `docs/xp-balance-results.json`에 있다.

### Terminal run-end level-ups

아래 값은 run 종료 시점의 terminal count이며 정확한 600초 값으로 해석하지 않는다.

| 집합 | PC skilled / average / weak | Phone skilled / average / weak |
|---|---:|---:|
| baseline100 | 53 / 54 / 54 | 48 / 48 / 49 |
| A10 | 54 / 53 / 56 | 47.5 / 48 / 50 |
| B10 | 56.5 / 55 / 53.5 | 48.5 / 46.5 / 49 |
| C10 | 49 / 50.5 / 47.5 | 43.5 / 43 / 42.5 |
| D10 | 47.5 / 47.5 / 45 | 43.5 / 43 / 42.5 |
| D100 | 47 / 48 / 47 | 43 / 44 / 43 |
| E100 | 46 / 47 / 46 | 43 / 43 / 43 |

E100의 terminal 42–48 per-run rates는 PC **84/100, 74/100, 73/100**, phone **74/100, 77/100, 71/100**이다. 여섯 terminal medians는 목표 범위다.

## E100 exact-600과 build/outcome 진단

`levelUpsAt600Seconds`는 실제 tick 36,000을 관측한 subset만 포함한다(같은 tick의 modal pick 포함). `n=0`은 unobserved이며 0 level-ups가 아니다.

| Platform / profile | D100 exact-600 median (n; in-band) | E100 exact-600 median (n; in-band) |
|---|---:|---:|
| PC / skilled | null (0) | null (0) |
| PC / average | 49 (2; 1/2) | null (0) |
| PC / weak | 49 (25; 12/25) | 46 (24; 17/24) |
| Phone / skilled | null (0) | null (0) |
| Phone / average | 44 (3; 2/3) | 44 (3; 2/3) |
| Phone / weak | 45 (20; 16/20) | 45 (16; 13/16) |

E에서 PC weak의 관측 exact-600 median은 49에서 46으로 이동했다. PC average는 E에서 관측 run이 없어 목표 달성 여부를 판정할 수 없다. Phone average/weak 결과도 표본 수가 작다.

| Platform / profile | Strict full-build median; n/100 | Kills median | Boss / timeout / death | Actual duration median (s) | Normalized survival median (s) |
|---|---:|---:|---:|---:|---:|
| PC / skilled | 526.83; 12/100 | 3258 | 99% / 0% / 1% | 531.79 | 600 |
| PC / average | 529.90; 15/100 | 3244 | 68% / 0% / 32% | 542.79 | 600 |
| PC / weak | 547.98; 29/100 | 3173 | 2% / 24% / 74% | 559.70 | 559.70 |
| Phone / skilled | 515.82; 15/100 | 2581.5 | 100% / 0% / 0% | 529.93 | 600 |
| Phone / average | 521.47; 10/100 | 2531 | 64% / 3% / 33% | 539.30 | 600 |
| Phone / weak | 534.95; 26/100 | 2448.5 | 5% / 16% / 79% | 549.91 | 549.91 |

Strict full-build는 정확히 **4 equipped Lv7 weapons + 4 Lv3 buffs**다. E의 모든 observed full-build median이 480초를 넘으므로 **전체 task acceptance로 주장하지 않는다**. Fresh sim profile은 score 0이 첫 threshold를 만족해 rank 1이며 rank 0이 아니다. `buffUnlockRank: 3` 미만이므로 3 buff slots로 시작하고, 네 번째는 480초 Ace 때 열린다. slot/build/chest 규칙은 바꾸지 않았다.

E100 normalized-survival medians의 observed 순서는 skilled/average/weak 기준 PC **600/600/559.70초**, phone **600/600/549.91초**다. 이는 100-seed 결과의 기술 통계이며 임의의 3-seed 표본에 보장되는 gameplay invariant가 아니다. 결정성 테스트는 각 profile의 run별 normalized survival과 그 profile 요약 median의 정확성만 검증한다.

보관 baseline100의 phone-weak kills median은 **2462**(2500보다 38 부족)였고, E100은 **2448.5**(51.5 부족, baseline보다 13.5 낮음)다. E의 XP 진행 median은 목표 범위지만 이 outcome과 full-build 지연은 남은 caveat다. 적/생존 보정은 하지 않았다.

## 검증 상태

- E100 6개 job 완료; raw JSON은 `/home/ubuntu/xp-progression-screen/candidate-e-100-{skilled,average,weak}-{desktop,mobile}.json`.
- E 시뮬레이션 후 `npm run build`가 119 modules로 성공했다. 이 build는 마지막 tests/docs-only 수정 전에 실행됐고, runtime 코드는 그 후 바뀌지 않아 반복하지 않았다. Focused progression/run/Bills/recovery tests: 37/37 통과.
- 마지막 tests/docs 수정 뒤 실행한 최종 `npm test`: 579/579 통과, 실패 0, `duration_ms 101251.099774`, exit 0.
- `tests/bot-sim.test.mjs`는 cross-profile survival 순위 가정 대신 각 run의 normalized-survival 계산과 profile별 sorted median의 일치를 검증한다. 반복 run hash/report, outcome/cap/XP/CSV, 새 observation의 CSV 노출과 관측 수 bounds도 유지/확장했다. 생존 순위는 표본 결과로만 보고한다.
- Survivors replay는 `stage.phase === 'clear'`까지 통과했다. 기대 hash를 원래 baseline `1cede4023fb8ad248a8eef93bc7dc79f0da81989555e3f74a4f1be948f0e5905`에서 최종 E `929d9d57b8802a1d2167752073c4bf053829232b1bdf50fa3ee8a72c0ee32ad8`로 갱신했고 legacy hash는 유지했다. 전체 task acceptance는 strict full-build 시간이 480초를 넘으므로 주장하지 않는다.

상세 per-run compliance, n, exact-600 observation flags, source provenance, survival/duration semantics는 이 문서와 JSON을 함께 참조한다. Baseline archive에는 strict full-build telemetry가 없다: `recorded=false`, `n=0`, median/rate `null`은 미계측 상태이며 관측된 completion rate 0%가 아니다. 반대로 `recorded=true, n=0, rate=0`은 계측된 표본에서 완료가 없었다는 뜻이다.
